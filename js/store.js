// Dữ liệu của app và các phép tính lương. Mặc định lưu trong IndexedDB của trình duyệt (dự phòng bằng localStorage);
// khi đã đăng nhập đồng bộ thì dữ liệu nằm trên đám mây (xem cloud.js).
//
// state = {
//   employees:  [{ id, name, salary: [{ from: 'YYYY-MM', amount }], defaultPct?, rates: { serviceId: % }, createdAt, deletedAt? }]
//   services:   [{ id, name, price, pct, deletedAt? }]
//   entries:    [{ id, date, serviceId, employeeId, amount, pct, note, createdAt, billId? }]   // doanh thu từ khách;
//               các khoản khách trả chung một lần mang cùng billId
//   deductions: [{ id, type: 'advance' | 'purchase', date, employeeId, amount, product?, note }]
//   attendance: { 'YYYY-MM-DD': { employeeId: 1 | 0.5 | 0 } }
//   settings:   { shorthand }   // tùy chọn chung của quán; shorthand = nhập tiền rút gọn theo nghìn
// }
const Store = (() => {
  const DB_NAME = 'doanh-thu-quan';
  const LS_KEY = 'doanh-thu-quan-state';
  let state = emptyState();
  let db = null;
  let onError = () => {};
  let onChange = () => {};
  // Khi đã đăng nhập đồng bộ đám mây, mỗi thay đổi được gửi cho `remote` thay vì lưu cả bộ dữ liệu vào máy.
  let remote = null;
  // Báo cho các tab khác của app biết dữ liệu vừa đổi, để tab mở sẵn không ghi đè bằng bản cũ.
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DB_NAME);

  function emptyState() {
    return { version: 1, employees: [], services: [], entries: [], deductions: [], attendance: {}, settings: { shorthand: false } };
  }

  const normalize = saved => ({ ...emptyState(), ...saved, settings: { ...emptyState().settings, ...saved?.settings } });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const byId = (list, id) => list.find(x => x.id === id);

  /* ---------- Lưu trữ ---------- */

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function read() {
    if (!db) {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : undefined;
    }
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('state');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Nạp lại bản đã lưu; trả về false nếu bộ nhớ đang giữ đúng bản đó.
  async function refresh() {
    const saved = await read();
    if (saved?.rev && saved.rev === state.rev) return false;
    state = saved ? normalize(saved) : emptyState();
    return true;
  }

  async function sync() {
    if (!remote && await refresh()) onChange();
  }

  async function load() {
    try {
      db = await openDb();
      await refresh();
    } catch {
      db = null;
      await refresh();
    }
    if (channel) channel.onmessage = sync;
    window.addEventListener('storage', e => { if (e.key === LS_KEY) sync(); });
    // Tab bị trình duyệt cho ngủ có thể lỡ thông báo, nên kiểm tra lại mỗi khi quay về tab.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    navigator.storage?.persist?.().catch(() => {});
  }

  function save() {
    state.rev = uid();
    try {
      if (db) {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state, 'state');
        tx.oncomplete = () => channel?.postMessage('changed');
        tx.onerror = tx.onabort = () => onError(tx.error);
      } else {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      }
    } catch (err) {
      onError(err);
    }
  }

  // Ghi nhận một thay đổi: { catalog, id, value } | { record, id, value, prev } | { attendance, empId, value } | { settings } | { all }.
  // `value` là undefined nghĩa là xóa; `prev` là ngày và nhân viên của bản ghi trước khi sửa hoặc xóa.
  function commit(change) {
    if (remote) remote.push(change);
    else save();
  }

  function attachRemote(r) {
    remote = r;
  }

  // Thay toàn bộ dữ liệu trong bộ nhớ bằng bản lấy từ đám mây (không ghi vào bản lưu trên máy).
  function adopt(next) {
    state = normalize(next);
    onChange();
  }

  // Ngừng đồng bộ: quay lại bản dữ liệu lưu trên máy.
  async function detachRemote() {
    remote = null;
    state = emptyState();
    await refresh();
    onChange();
  }

  /* ---------- Nhân viên & dịch vụ ---------- */

  const employees = () => state.employees.filter(e => !e.deletedAt);
  const services = () => state.services.filter(s => !s.deletedAt);
  // Danh sách cho ô chọn: đang dùng + mục đang được chọn dù đã xóa.
  const pick = (kind, selectedId) => state[kind].filter(x => !x.deletedAt || x.id === selectedId);
  const employee = id => byId(state.employees, id);
  const service = id => byId(state.services, id);
  const empName = id => employee(id)?.name ?? '—';
  const svcName = id => service(id)?.name ?? 'Khác';

  function baseSalaryFor(emp, ym) {
    let amount = emp.salary[0]?.amount ?? 0;
    for (const s of emp.salary) if (s.from <= ym) amount = s.amount;
    return amount;
  }

  // Đổi lương cứng kể từ tháng `from`, các tháng trước đó giữ nguyên.
  function setSalary(emp, from, amount) {
    if (baseSalaryFor(emp, from) === amount && !emp.salary.some(s => s.from > from)) return;
    emp.salary = emp.salary.filter(s => s.from < from);
    emp.salary.push({ from, amount });
  }

  function saveEmployee({ id, name, baseSalary, from, rates, defaultPct }) {
    let emp = employee(id);
    if (emp) {
      emp.name = name;
      setSalary(emp, from, baseSalary);
    } else {
      emp = { id: uid(), name, salary: [{ from: todayStr().slice(0, 7), amount: baseSalary }], createdAt: todayStr() };
      state.employees.push(emp);
    }
    emp.rates = rates;
    if (defaultPct === undefined) delete emp.defaultPct;
    else emp.defaultPct = defaultPct;
    commit({ catalog: 'employees', id: emp.id, value: emp });
  }

  function saveService({ id, name, price, pct }) {
    let svc = service(id);
    if (svc) Object.assign(svc, { name, price, pct });
    else state.services.push(svc = { id: uid(), name, price, pct });
    commit({ catalog: 'services', id: svc.id, value: svc });
  }

  // Mục đã có dữ liệu liên quan thì chỉ ẩn đi để số liệu cũ không bị mất tên.
  function removeItem(kind, id) {
    const key = kind === 'employees' ? 'employeeId' : 'serviceId';
    const used = state.entries.some(e => e[key] === id)
      || (kind === 'employees' && (state.deductions.some(d => d.employeeId === id)
        || Object.values(state.attendance).some(day => id in day)));
    const item = byId(state[kind], id);
    if (used) item.deletedAt = todayStr();
    else state[kind] = state[kind].filter(x => x.id !== id);
    commit({ catalog: kind, id, value: used ? item : undefined });
  }

  // % hoa hồng của một nhân viên cho một dịch vụ, theo thứ tự ưu tiên:
  // mức riêng của người đó cho dịch vụ đó -> mức mặc định của người đó -> mức mặc định của dịch vụ.
  function rateFor(empId, svcId) {
    const emp = employee(empId);
    return emp?.rates?.[svcId] ?? emp?.defaultPct ?? service(svcId)?.pct ?? 0;
  }

  // Đặt một ô trong bảng % hoa hồng. `svcId` null là mức mặc định của nhân viên; `value` undefined là xóa ô đó.
  function setRate(empId, svcId, value) {
    const emp = employee(empId);
    if (svcId) {
      emp.rates ??= {};
      if (value === undefined) delete emp.rates[svcId];
      else emp.rates[svcId] = value;
    } else if (value === undefined) {
      delete emp.defaultPct;
    } else {
      emp.defaultPct = value;
    }
    commit({ catalog: 'employees', id: emp.id, value: emp });
  }

  /* ---------- Doanh thu & khoản trừ (kind: 'entries' | 'deductions') ---------- */

  function add(kind, data) {
    const item = { id: uid(), createdAt: Date.now(), ...data };
    state[kind].push(item);
    commit({ record: kind, id: item.id, value: item });
  }

  // Một hóa đơn nhiều dịch vụ: mỗi dòng vẫn là một khoản doanh thu riêng (để tính lương từng người),
  // các dòng mang chung mã hóa đơn và giữ đúng thứ tự nhập.
  function addBill(lines) {
    const billId = lines.length > 1 ? uid() : undefined;
    const now = Date.now();
    lines.forEach((line, i) => add('entries', { ...line, createdAt: now + i, ...(billId && { billId }) }));
  }

  function update(kind, id, data) {
    const item = byId(state[kind], id);
    const prev = { date: item.date, employeeId: item.employeeId };
    Object.assign(item, data);
    commit({ record: kind, id, value: item, prev });
  }

  function remove(kind, id) {
    const item = byId(state[kind], id);
    state[kind] = state[kind].filter(x => x.id !== id);
    commit({ record: kind, id, prev: { date: item.date, employeeId: item.employeeId } });
  }

  const get = (kind, id) => byId(state[kind], id);
  const inPeriod = (kind, prefix) => state[kind].filter(x => x.date.startsWith(prefix));
  const commissionOf = e => (e.employeeId ? Math.round(e.amount * e.pct / 100) : 0);

  /* ---------- Bảng công ---------- */

  const attendanceOf = (date, empId) => state.attendance[date]?.[empId];

  function setAttendance(date, empId, value) {
    const day = state.attendance[date] ??= {};
    if (value === undefined) delete day[empId];
    else day[empId] = value;
    if (!Object.keys(day).length) delete state.attendance[date];
    commit({ attendance: date, empId, value });
  }

  function workDays(empId, prefix) {
    let n = 0;
    for (const [date, day] of Object.entries(state.attendance)) {
      if (date.startsWith(prefix)) n += day[empId] || 0;
    }
    return n;
  }

  /* ---------- Bảng lương ---------- */

  // Lương tháng = mức cao hơn giữa lương cứng và tổng hoa hồng; thực lĩnh = lương tháng − ứng lương − mua sản phẩm.
  function payroll(ym) {
    const entries = inPeriod('entries', ym);
    const deds = inPeriod('deductions', ym);
    const nowYm = todayStr().slice(0, 7);
    const rows = [];
    for (const emp of state.employees) {
      const mine = entries.filter(e => e.employeeId === emp.id);
      const myDeds = deds.filter(d => d.employeeId === emp.id);
      const employed = ym >= emp.createdAt.slice(0, 7) && ym <= (emp.deletedAt?.slice(0, 7) ?? nowYm);
      if (!employed && !mine.length && !myDeds.length) continue;
      const base = baseSalaryFor(emp, ym);
      const commission = sumBy(mine, commissionOf);
      const gross = Math.max(base, commission);
      const advance = sumBy(myDeds.filter(d => d.type === 'advance'), d => d.amount);
      const purchase = sumBy(myDeds.filter(d => d.type === 'purchase'), d => d.amount);
      rows.push({
        emp, base, commission, gross, advance, purchase,
        byCommission: commission > base,
        revenue: sumBy(mine, e => e.amount),
        count: mine.length,
        net: gross - advance - purchase,
        workDays: workDays(emp.id, ym),
      });
    }
    return rows;
  }

  /* ---------- Tùy chọn của quán ---------- */

  const settings = () => state.settings;

  function setSetting(key, value) {
    state.settings[key] = value;
    commit({ settings: state.settings });
  }

  /* ---------- Sao lưu ---------- */

  const exportData = (data = state) => JSON.stringify({ app: DB_NAME, exportedAt: new Date().toISOString(), state: data }, null, 1);

  function importData(json) {
    const data = JSON.parse(json);
    const s = data.state ?? data;
    if (!Array.isArray(s.employees) || !Array.isArray(s.services) || !Array.isArray(s.entries)) {
      throw new Error('Sai định dạng');
    }
    state = normalize(s);
    commit({ all: true });
  }

  function reset() {
    state = emptyState();
    commit({ all: true });
  }

  function minYear() {
    const dates = [...state.entries, ...state.deductions].map(x => x.date).concat(Object.keys(state.attendance));
    return dates.reduce((min, d) => Math.min(min, Number(d.slice(0, 4))), new Date().getFullYear());
  }

  return {
    get state() { return state; },
    set onError(fn) { onError = fn; },
    set onChange(fn) { onChange = fn; },
    load, attachRemote, adopt, detachRemote, employees, services, pick, employee, service, empName, svcName,
    baseSalaryFor, saveEmployee, saveService, removeItem, rateFor, setRate,
    add, addBill, update, remove, get, inPeriod, commissionOf,
    attendanceOf, setAttendance, workDays, payroll, settings, setSetting,
    exportData, importData, reset, minYear,
  };
})();
