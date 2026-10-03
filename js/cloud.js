// Đồng bộ đám mây bằng Firebase: đăng nhập Google, dữ liệu nằm trong Firestore và tự cập nhật giữa các máy.
// Khi chưa đăng nhập (hoặc chưa cấu hình), app vẫn lưu dữ liệu trên máy như thường.
//
// Cấu trúc trên Firestore (mỗi ngày một tài liệu để mỗi lần thay đổi chỉ tải lại phần nhỏ):
//   shops/main/meta/catalog        { employees: { id: … }, services: { id: … } }
//   shops/main/days/{YYYY-MM-DD}   { entries: { id: … }, deductions: { id: … }, attendance: { employeeId: 1 | 0.5 | 0 } }
const Cloud = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';
  const onWeb = location.protocol.startsWith('http');
  const configured = Boolean(FIREBASE_CONFIG) && onWeb;

  let auth, db, catalogRef, daysRef;
  let user = null;
  let error = '';
  let pending = false;
  let onStatus = () => {};

  // Dữ liệu đang nghe từ Firestore.
  let catalog = {};
  let catalogKey = '';
  let days = new Map();
  let listeners = [];
  let local = null;   // bản dữ liệu trên máy tại lúc đăng nhập, dùng khi cần đưa lên đám mây lần đầu

  const loadScript = src => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = reject;
    document.head.append(el);
  });

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
    firebase.initializeApp(config);
    auth = firebase.auth();
    db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true, merge: true });
    if (emulator) {
      auth.useEmulator(emulator.auth, { disableWarnings: true });
      db.useEmulator(...emulator.firestore);
    }
    // Giữ bản sao trên máy để mở app và nhập liệu được cả khi mất mạng.
    await db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    const shop = db.collection('shops').doc('main');
    catalogRef = shop.collection('meta').doc('catalog');
    daysRef = shop.collection('days');

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
    const byId = map => Object.values(map ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1));
    const state = { employees: byId(catalog.employees), services: byId(catalog.services), entries: [], deductions: [], attendance: {} };
    for (const [date, day] of days) {
      state.entries.push(...Object.values(day.entries ?? {}));
      state.deductions.push(...Object.values(day.deductions ?? {}));
      if (Object.keys(day.attendance ?? {}).length) state.attendance[date] = day.attendance;
    }
    return state;
  }

  const hasData = s => s.employees.length || s.services.length || s.entries.length || s.deductions.length || Object.keys(s.attendance).length;

  function attach() {
    local = Store.state;
    Store.attachRemote({ push });
    Store.adopt({});
    return new Promise(resolve => {
      const got = { catalog: null, days: null };   // metadata của lần nhận gần nhất
      let catalogExists = false;
      let offered = false;

      const apply = changed => {
        if (!got.catalog || !got.days) return;
        if (changed) Store.adopt(buildState());
        const wasPending = pending;
        pending = got.catalog.hasPendingWrites || got.days.hasPendingWrites;
        if (pending !== wasPending) onStatus();
        resolve();
        // Đám mây còn trống hoàn toàn (đã xác nhận với máy chủ) mà máy này có sẵn dữ liệu: hỏi đưa lên.
        if (!offered && !got.catalog.fromCache && !got.days.fromCache) {
          offered = true;
          if (!catalogExists && !days.size && hasData(local)) offerUpload();
        }
      };

      const fail = err => {
        resolve();
        denied(err);
      };

      const opts = { includeMetadataChanges: true };
      listeners = [
        catalogRef.onSnapshot(opts, snap => {
          const key = JSON.stringify(snap.data() ?? {});
          const changed = key !== catalogKey || !got.catalog;
          catalog = snap.data() ?? {};
          catalogKey = key;
          catalogExists = snap.exists;
          got.catalog = snap.metadata;
          apply(changed);
        }, fail),
        daysRef.onSnapshot(opts, snap => {
          const changes = snap.docChanges();
          for (const c of changes) {
            if (c.type === 'removed') days.delete(c.doc.id);
            else days.set(c.doc.id, c.doc.data());
          }
          const changed = changes.length > 0 || !got.days;
          got.days = snap.metadata;
          apply(changed);
        }, fail),
      ];
    });
  }

  async function detach() {
    for (const stop of listeners) stop();
    listeners = [];
    catalog = {};
    catalogKey = '';
    days = new Map();
    pending = false;
    await Store.detachRemote();
  }

  function denied(err) {
    if (!user) return;
    error = err?.code === 'permission-denied'
      ? `Tài khoản ${user?.email ?? ''} chưa được cấp quyền xem dữ liệu của quán. Hãy thêm địa chỉ này vào quy tắc (Rules) của Firestore rồi đăng nhập lại.`
      : `Lỗi đồng bộ đám mây: ${err?.message ?? err}`;
    if (err?.code === 'permission-denied') auth.signOut();
    else onStatus();
  }

  async function offerUpload() {
    const ok = await confirmBox('Đám mây chưa có dữ liệu. Đưa toàn bộ dữ liệu đang có trên máy này lên đám mây?', 'Đưa lên');
    if (ok && user) replaceAll(local);
  }

  /* ---------- Gửi dữ liệu ---------- */

  // Ghi (hoặc xóa, khi value là undefined) đúng một mục trong tài liệu, không đụng tới các mục khác.
  function setField(batch, ref, field, key, value) {
    const { FieldPath, FieldValue } = firebase.firestore;
    batch.set(ref, { [field]: { [key]: value === undefined ? FieldValue.delete() : value } },
      { mergeFields: [new FieldPath(field, key)] });
  }

  function push(change) {
    if (change.all) {
      replaceAll(Store.state);
      return;
    }
    const batch = db.batch();
    if (change.catalog) {
      setField(batch, catalogRef, change.catalog, change.id, change.value);
    } else if (change.record) {
      if (change.oldDate && change.oldDate !== change.date) setField(batch, daysRef.doc(change.oldDate), change.record, change.id);
      setField(batch, daysRef.doc(change.date), change.record, change.id, change.value);
    } else {
      setField(batch, daysRef.doc(change.attendance), 'attendance', change.empId, change.value);
    }
    batch.commit().catch(denied);
  }

  // Thay toàn bộ dữ liệu trên đám mây bằng `state` (khôi phục từ file, xóa tất cả, đưa dữ liệu máy lên lần đầu).
  function replaceAll(state) {
    const toMap = list => Object.fromEntries(list.map(x => [x.id, x]));
    const next = new Map();
    const day = date => next.get(date) ?? next.set(date, { entries: {}, deductions: {}, attendance: {} }).get(date);
    for (const e of state.entries) day(e.date).entries[e.id] = e;
    for (const d of state.deductions) day(d.date).deductions[d.id] = d;
    for (const [date, marks] of Object.entries(state.attendance)) day(date).attendance = marks;

    const ops = [b => b.set(catalogRef, { employees: toMap(state.employees), services: toMap(state.services) })];
    for (const [date, data] of next) ops.push(b => b.set(daysRef.doc(date), data));
    for (const date of days.keys()) if (!next.has(date)) ops.push(b => b.delete(daysRef.doc(date)));
    // Không chờ từng lô: khi mất mạng lệnh ghi chỉ hoàn tất lúc có mạng lại, nhưng vẫn được xếp hàng đủ.
    for (let i = 0; i < ops.length; i += 200) {
      const batch = db.batch();
      for (const op of ops.slice(i, i + 200)) op(batch);
      batch.commit().catch(denied);
    }
  }

  /* ---------- Đăng nhập ---------- */

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

  const signOut = () => auth.signOut();

  return {
    set onStatus(fn) { onStatus = fn; },
    start, signIn, signOut,
    status: () => ({ configured, onWeb, available: Boolean(auth), email: user?.email ?? null, pending, error }),
  };
})();
