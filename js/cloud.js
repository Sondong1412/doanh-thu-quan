// Đồng bộ đám mây bằng Firebase: dữ liệu nằm trong Firestore, tự cập nhật giữa các máy và chia quyền theo vai trò.
// Chủ quán đăng nhập bằng Google; quản lý và nhân viên dùng tên đăng nhập + mật khẩu do chủ quán tạo.
// Khi chưa đăng nhập (hoặc chưa cấu hình), app vẫn lưu dữ liệu trên máy như thường.
//
// Cấu trúc trên Firestore (tách theo người để quy tắc bảo mật chặn được từng phần, xem firestore.rules):
//   shops/main/meta/services             { items: { id: dịch vụ } }
//   shops/main/employees/{id}            nhân viên (tên, lương cứng, % riêng)
//   shops/main/sales/{ngày}_{nhân viên}  { date, employeeId, entries: { id: khoản doanh thu } }   (không gắn nhân viên: {ngày}_shop)
//   shops/main/hr/{tháng}_{nhân viên}    { month, employeeId, deductions: { id: … }, attendance: { 'DD': 1 | 0.5 | 0 } }
//   shops/main/members/{uid}             { username, role: 'manager' | 'staff' | 'blocked', employeeId }
const Cloud = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';
  const onWeb = location.protocol.startsWith('http');
  const configured = Boolean(FIREBASE_CONFIG) && onWeb;
  const SERVER = { source: 'server' };

  let auth, db, shop, servicesRef, employeesRef, salesRef, hrRef, membersRef;
  let user = null;
  let role = null;          // 'owner' | 'manager' | 'staff' khi đã đăng nhập
  let myEmployee = null;    // nhân viên gắn với tài khoản đang đăng nhập
  let error = '';
  let busy = '';            // việc đang chạy cần báo cho người dùng (chuyển dữ liệu…)
  let pending = false;
  let onStatus = () => {};

  // Dữ liệu đang nghe từ Firestore.
  let services = {};
  let servicesKey = '';
  const employees = new Map();
  const sales = new Map();
  const hr = new Map();
  let members = [];
  let local = null;           // bản dữ liệu trên máy tại lúc đăng nhập, dùng khi chủ quán đưa lên đám mây lần đầu
  let stops = [];
  const periods = new Set();  // các kỳ ('YYYY' hoặc 'YYYY-MM') đã nghe doanh thu và chấm công
  const waiting = new Set();  // các luồng nghe chưa có dữ liệu lần đầu
  const unsent = new Map();   // luồng nghe -> còn thay đổi chưa gửi lên

  const saleKey = x => `${x.date}_${x.employeeId || 'shop'}`;
  const hrKey = (month, employeeId) => `${month}_${employeeId}`;
  const emailOf = username => `${username}@${FIREBASE_CONFIG.authDomain}`;

  const loadScript = src => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = reject;
    document.head.append(el);
  });

  function connect(app) {
    const { emulator } = FIREBASE_CONFIG;
    const a = app.auth();
    if (emulator) a.useEmulator(emulator.auth, { disableWarnings: true });
    return a;
  }

  // Khởi động: trả về khi đã biết có đăng nhập hay không và (nếu có) đã có dữ liệu đám mây để hiển thị.
  async function start() {
    if (!configured) return;
    try {
      for (const lib of ['app', 'auth', 'firestore']) await loadScript(`${SDK}firebase-${lib}-compat.js`);
    } catch {
      error = 'Không tải được phần đồng bộ đám mây. Kiểm tra mạng rồi mở lại app; dữ liệu nhập lúc này chỉ lưu trên máy.';
      return;
    }
    const { emulator, ...config } = FIREBASE_CONFIG;
    auth = connect(firebase.initializeApp(config));
    db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true, merge: true });
    if (emulator) db.useEmulator(...emulator.firestore);
    // Giữ bản sao trên máy để mở app và nhập liệu được cả khi mất mạng.
    await db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    shop = db.collection('shops').doc('main');
    servicesRef = shop.collection('meta').doc('services');
    employeesRef = shop.collection('employees');
    salesRef = shop.collection('sales');
    hrRef = shop.collection('hr');
    membersRef = shop.collection('members');

    await new Promise(resolve => {
      auth.onAuthStateChanged(async next => {
        const was = user;
        user = next;
        if (next) {
          error = '';
          await attach();
        } else if (was) {
          await detach();
        }
        resolve();
        onStatus();
      });
    });
  }

  /* ---------- Nhận dữ liệu ---------- */

  function buildState() {
    const byId = list => list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const state = { employees: byId([...employees.values()]), services: byId(Object.values(services)), entries: [], deductions: [], attendance: {} };
    for (const doc of sales.values()) state.entries.push(...Object.values(doc.entries ?? {}));
    for (const doc of hr.values()) {
      state.deductions.push(...Object.values(doc.deductions ?? {}));
      for (const [day, value] of Object.entries(doc.attendance ?? {})) {
        (state.attendance[`${doc.month}-${day}`] ??= {})[doc.employeeId] = value;
      }
    }
    return state;
  }

  // Nghe một tài liệu hoặc truy vấn. `apply(snap)` chép dữ liệu vào bộ nhớ và trả về true nếu có gì đổi.
  // Promise trả về hoàn tất khi có dữ liệu lần đầu.
  function listen(key, ref, apply) {
    waiting.add(key);
    return new Promise(resolve => {
      stops.push(ref.onSnapshot({ includeMetadataChanges: true }, snap => {
        const first = waiting.delete(key);
        const changed = apply(snap);
        unsent.set(key, snap.metadata.hasPendingWrites);
        const wasPending = pending;
        pending = [...unsent.values()].some(Boolean);
        if (changed || first) Store.adopt(buildState());
        if (first || pending !== wasPending) onStatus();
        resolve();
      }, err => {
        waiting.delete(key);
        resolve();
        kick(err);
      }));
    });
  }

  const intoMap = map => snap => {
    const changes = snap.docChanges();
    for (const c of changes) {
      if (c.type === 'removed') map.delete(c.doc.id);
      else map.set(c.doc.id, c.doc.data());
    }
    return changes.length > 0;
  };

  // Chủ quán và quản lý chỉ nghe kỳ đang xem ('YYYY' hoặc 'YYYY-MM') để không phải tải toàn bộ lịch sử mỗi lần mở app.
  function need(period) {
    if (!role || role === 'staff' || periods.has(period) || periods.has(period.slice(0, 4))) return [];
    periods.add(period);
    const [from, to] = period.length === 4 ? [`${period}-01`, `${period}-12`] : [period, period];
    return [
      listen(`sales ${period}`, salesRef.where('date', '>=', `${from}-01`).where('date', '<=', `${to}-31`), intoMap(sales)),
      listen(`hr ${period}`, hrRef.where('month', '>=', from).where('month', '<=', to), intoMap(hr)),
    ];
  }

  // Tài khoản tên đăng nhập + mật khẩu: vai trò nằm trong tài liệu members/{uid}.
  function watchMembership() {
    return new Promise(resolve => {
      let known = false;
      // Mất mạng mà máy chưa từng lưu quyền của tài khoản này: không chờ mãi, báo lỗi và nạp lại khi có câu trả lời.
      let gaveUp = false;
      const timer = setTimeout(() => {
        gaveUp = true;
        error = 'Chưa kết nối được máy chủ để kiểm tra quyền của tài khoản. Hãy kiểm tra mạng.';
        resolve(false);
      }, 15000);
      stops.push(membersRef.doc(user.uid).onSnapshot(snap => {
        if (snap.metadata.hasPendingWrites) return;   // chỉ tin dữ liệu máy chủ đã chấp nhận
        const me = snap.data();
        const valid = me && (me.role === 'manager' || (me.role === 'staff' && me.employeeId));
        if (!valid) {
          if (snap.metadata.fromCache && !snap.exists) return;   // chưa có câu trả lời từ máy chủ
          clearTimeout(timer);
          resolve(false);
          kick(null, me?.role === 'staff'
            ? 'Tài khoản này chưa được gắn với nhân viên nào. Hãy báo chủ quán.'
            : 'Tài khoản này đã bị khóa hoặc chưa được cấp quyền. Hãy báo chủ quán.');
        } else if (gaveUp) {
          location.reload();
        } else if (!known) {
          known = true;
          clearTimeout(timer);
          role = me.role;
          myEmployee = me.employeeId ?? null;
          resolve(true);
        } else if (me.role !== role || (me.employeeId ?? null) !== myEmployee) {
          location.reload();   // chủ quán vừa đổi quyền: nạp lại app theo quyền mới
        }
      }, err => {
        clearTimeout(timer);
        resolve(false);
        kick(err);
      }));
    });
  }

  async function attach() {
    local = Store.state;
    Store.attachRemote({ push });
    Store.adopt({});
    const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
    if (isGoogle) {
      role = 'owner';
      await migrateV1();
    } else if (!(await watchMembership())) {
      return;
    }
    if (!user) return;

    const base = [
      listen('services', servicesRef, snap => {
        const key = JSON.stringify(snap.data()?.items ?? {});
        const changed = key !== servicesKey;
        services = snap.data()?.items ?? {};
        servicesKey = key;
        return changed;
      }),
    ];
    if (role === 'staff') {
      base.push(
        listen('me', employeesRef.doc(myEmployee), snap => {
          const before = JSON.stringify(employees.get(snap.id));
          if (snap.exists) employees.set(snap.id, snap.data());
          else employees.delete(snap.id);
          return JSON.stringify(employees.get(snap.id)) !== before;
        }),
        listen('sales', salesRef.where('employeeId', '==', myEmployee), intoMap(sales)),
        listen('hr', hrRef.where('employeeId', '==', myEmployee), intoMap(hr)),
      );
    } else {
      base.push(listen('employees', employeesRef, intoMap(employees)), ...need(todayStr().slice(0, 7)));
    }
    if (role === 'owner') {
      listen('members', membersRef, snap => {
        members = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.username.localeCompare(b.username));
        onStatus();
        return false;
      });
    }
    await Promise.all(base);
    if (role === 'owner') offerUpload();
  }

  async function detach() {
    for (const stop of stops) stop();
    stops = [];
    services = {};
    servicesKey = '';
    for (const map of [employees, sales, hr, unsent]) map.clear();
    periods.clear();
    waiting.clear();
    members = [];
    role = null;
    myEmployee = null;
    pending = false;
    await Store.detachRemote();
  }

  // Không đọc được dữ liệu: báo lý do rồi đăng xuất, app quay về dữ liệu riêng trên máy.
  function kick(err, message) {
    if (!user) return;
    if (message) error = message;
    else if (err?.code === 'permission-denied') {
      error = `Tài khoản ${user.email} chưa được cấp quyền xem dữ liệu của quán. Hãy thêm địa chỉ này vào quy tắc (Rules) của Firestore rồi đăng nhập lại.`;
    } else {
      error = `Lỗi đồng bộ đám mây: ${err?.message ?? err}`;
      onStatus();
      return;
    }
    auth.signOut();
  }

  // Một lệnh ghi bị từ chối: Firestore tự bỏ thay đổi đó, app hiển thị lại dữ liệu đúng.
  function writeFailed(err) {
    error = err?.code === 'permission-denied'
      ? 'Tài khoản của bạn không có quyền thực hiện thao tác vừa rồi nên thay đổi không được lưu.'
      : `Không lưu được lên đám mây: ${err?.message ?? err}`;
    if (user) Store.adopt(buildState());
    onStatus();
  }

  /* ---------- Gửi dữ liệu ---------- */

  // Ghi (hoặc xóa, khi value là undefined) đúng một mục trong tài liệu, không đụng tới các mục khác.
  // `head` là các trường nhận diện của tài liệu (ngày, nhân viên) dùng cho truy vấn và quy tắc bảo mật.
  function setField(batch, ref, head, field, key, value) {
    const { FieldPath, FieldValue } = firebase.firestore;
    batch.set(ref, { ...head, [field]: { [key]: value === undefined ? FieldValue.delete() : value } },
      { mergeFields: [...Object.keys(head), new FieldPath(field, key)] });
  }

  function push(change) {
    if (change.all) {
      replaceAll(Store.state).catch(err => writeFailed(err?.code === 'unavailable'
        ? { message: 'cần có mạng để thay toàn bộ dữ liệu trên đám mây.' } : err));
      return;
    }
    const batch = db.batch();
    const { id, value, prev } = change;
    if (change.catalog === 'services') {
      setField(batch, servicesRef, {}, 'items', id, value);
    } else if (change.catalog === 'employees') {
      if (value) batch.set(employeesRef.doc(id), value);
      else batch.delete(employeesRef.doc(id));
    } else if (change.record === 'entries') {
      const head = x => ({ date: x.date, employeeId: x.employeeId ?? null });
      if (prev && (!value || saleKey(prev) !== saleKey(value))) setField(batch, salesRef.doc(saleKey(prev)), head(prev), 'entries', id);
      if (value) setField(batch, salesRef.doc(saleKey(value)), head(value), 'entries', id, value);
    } else if (change.record === 'deductions') {
      const ref = x => hrRef.doc(hrKey(x.date.slice(0, 7), x.employeeId));
      const head = x => ({ month: x.date.slice(0, 7), employeeId: x.employeeId });
      if (prev && (!value || ref(prev).id !== ref(value).id)) setField(batch, ref(prev), head(prev), 'deductions', id);
      if (value) setField(batch, ref(value), head(value), 'deductions', id, value);
    } else {
      const month = change.attendance.slice(0, 7);
      setField(batch, hrRef.doc(hrKey(month, change.empId)), { month, employeeId: change.empId },
        'attendance', change.attendance.slice(8), value);
    }
    batch.commit().catch(writeFailed);
  }

  // Thay toàn bộ dữ liệu trên đám mây bằng `state` (khôi phục từ file, xóa tất cả, đưa dữ liệu máy lên lần đầu).
  // Chỉ chủ quán làm được, và cần có mạng để biết đang có những tài liệu nào phải xóa.
  // `extraOps` là các lệnh ghi thêm cần đi cùng lô đầu tiên.
  async function replaceAll(state, extraOps = []) {
    const [oldSales, oldHr, oldEmployees] = await Promise.all([salesRef.get(SERVER), hrRef.get(SERVER), employeesRef.get(SERVER)]);
    const nextSales = new Map();
    const nextHr = new Map();
    const hrDoc = (month, employeeId) => {
      const key = hrKey(month, employeeId);
      return nextHr.get(key) ?? nextHr.set(key, { month, employeeId, deductions: {}, attendance: {} }).get(key);
    };
    for (const e of state.entries) {
      const key = saleKey(e);
      const doc = nextSales.get(key) ?? nextSales.set(key, { date: e.date, employeeId: e.employeeId ?? null, entries: {} }).get(key);
      doc.entries[e.id] = e;
    }
    for (const d of state.deductions) hrDoc(d.date.slice(0, 7), d.employeeId).deductions[d.id] = d;
    for (const [date, marks] of Object.entries(state.attendance)) {
      for (const [employeeId, value] of Object.entries(marks)) hrDoc(date.slice(0, 7), employeeId).attendance[date.slice(8)] = value;
    }

    const ops = [...extraOps, b => b.set(servicesRef, { items: Object.fromEntries(state.services.map(s => [s.id, s])) })];
    const sync = (ref, next, old) => {
      for (const [id, data] of next) ops.push(b => b.set(ref.doc(id), data));
      old.forEach(doc => { if (!next.has(doc.id)) ops.push(b => b.delete(doc.ref)); });
    };
    sync(employeesRef, new Map(state.employees.map(e => [e.id, e])), oldEmployees);
    sync(salesRef, nextSales, oldSales);
    sync(hrRef, nextHr, oldHr);

    const commits = [];
    for (let i = 0; i < ops.length; i += 200) {
      const batch = db.batch();
      for (const op of ops.slice(i, i + 200)) op(batch);
      commits.push(batch.commit());
    }
    await Promise.all(commits);
  }

  const hasData = s => s.employees.length || s.services.length || s.entries.length || s.deductions.length || Object.keys(s.attendance).length;

  // Đám mây còn trống hoàn toàn (hỏi thẳng máy chủ) mà máy này có sẵn dữ liệu: hỏi chủ quán có đưa lên không.
  async function offerUpload() {
    if (!hasData(local)) return;
    try {
      const [svc, emps] = await Promise.all([servicesRef.get(SERVER), employeesRef.limit(1).get(SERVER)]);
      if (svc.exists || !emps.empty) return;
    } catch {
      return;
    }
    const ok = await confirmBox('Đám mây chưa có dữ liệu. Đưa toàn bộ dữ liệu đang có trên máy này lên đám mây?', 'Đưa lên');
    if (ok && user) replaceAll(local).catch(writeFailed);
  }

  // Dữ liệu lưu theo cấu trúc cũ (trước khi có phân quyền): chép sang cấu trúc mới.
  // Bản cũ được giữ nguyên làm dự phòng, chỉ đánh dấu là đã chuyển để không chép lại lần nữa.
  async function migrateV1() {
    const oldCatalog = shop.collection('meta').doc('catalog');
    let catalog;
    try {
      catalog = await oldCatalog.get(SERVER);
    } catch {
      const cached = await oldCatalog.get({ source: 'cache' }).catch(() => null);
      if (cached?.exists) error = 'Cần có mạng để hoàn tất nâng cấp dữ liệu. Hãy kết nối mạng rồi mở lại app.';
      return;
    }
    if (!catalog.exists || catalog.data().migratedAt) return;
    busy = 'Đang chuyển dữ liệu sang cấu trúc mới, vui lòng chờ…';
    onStatus();
    try {
      const oldDays = await shop.collection('days').get(SERVER);
      const c = catalog.data();
      const state = { employees: Object.values(c.employees ?? {}), services: Object.values(c.services ?? {}), entries: [], deductions: [], attendance: {} };
      oldDays.forEach(doc => {
        const d = doc.data();
        state.entries.push(...Object.values(d.entries ?? {}));
        state.deductions.push(...Object.values(d.deductions ?? {}));
        if (Object.keys(d.attendance ?? {}).length) state.attendance[doc.id] = d.attendance;
      });
      await replaceAll(state, [b => b.update(oldCatalog, { migratedAt: Date.now() })]);
    } catch (err) {
      error = `Chưa chuyển được dữ liệu sang cấu trúc mới: ${err?.message ?? err}`;
    }
    busy = '';
  }

  /* ---------- Đăng nhập & tài khoản ---------- */

  async function signIn() {
    try {
      await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (err) {
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err.code)) {
        error = `Không đăng nhập được: ${err.message}`;
        onStatus();
      }
    }
  }

  const signInPassword = (username, password) => auth.signInWithEmailAndPassword(emailOf(username.trim().toLowerCase()), password);
  const signOut = () => auth.signOut();

  // Chủ quán tạo tài khoản cho người khác. Dùng một kết nối phụ để phiên đăng nhập của chủ quán không bị thay thế.
  async function createAccount({ username, password, role: newRole, employeeId }) {
    const { emulator, ...config } = FIREBASE_CONFIG;
    const app = firebase.initializeApp(config, `tao-tai-khoan-${Date.now()}`);
    try {
      const other = connect(app);
      await other.setPersistence(firebase.auth.Auth.Persistence.NONE);
      const created = await other.createUserWithEmailAndPassword(emailOf(username), password);
      await membersRef.doc(created.user.uid).set({ username, role: newRole, employeeId: employeeId || null, createdAt: Date.now() });
    } finally {
      app.delete();
    }
  }

  const updateAccount = (uid, data) => membersRef.doc(uid).update(data);

  async function changePassword(current, next) {
    await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, current));
    await user.updatePassword(next);
  }

  function status() {
    const viaGoogle = Boolean(user?.providerData.some(p => p.providerId === 'google.com'));
    return {
      configured, onWeb, error, busy, pending,
      available: Boolean(auth),
      loading: waiting.size > 0,
      signedIn: Boolean(user && role),
      name: user ? (viaGoogle ? user.email : user.email.split('@')[0]) : null,
      viaGoogle,
      role: user ? role : null,
    };
  }

  return {
    set onStatus(fn) { onStatus = fn; },
    start, need, signIn, signInPassword, signOut, createAccount, updateAccount, changePassword, status,
    members: () => members,
    // Khi không đăng nhập đồng bộ (dữ liệu riêng trên máy) thì người dùng có toàn quyền như chủ quán.
    // Đã đăng nhập mà chưa biết vai trò thì tạm coi là quyền thấp nhất.
    role: () => (user ? role ?? 'staff' : 'owner'),
    myEmployee: () => myEmployee,
    clearError() { error = ''; },
  };
})();

const ROLE_LABELS = { owner: 'Chủ quán', manager: 'Quản lý', staff: 'Nhân viên', blocked: 'Đã khóa' };

// Quyền theo vai trò; quy tắc bảo mật trong firestore.rules chặn đúng những việc này ở phía máy chủ.
const PERMISSIONS = {
  seeShop: ['owner', 'manager'],   // xem doanh thu cả quán, nhập doanh thu cho mọi nhân viên
  editHr: ['owner', 'manager'],    // chấm công, ứng lương, mua sản phẩm
  manage: ['owner'],               // nhân viên, dịch vụ, tài khoản, sao lưu, xóa dữ liệu
};
const can = permission => PERMISSIONS[permission].includes(Cloud.role());
