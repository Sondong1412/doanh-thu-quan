// Tiện ích dùng chung: ngày tháng, định dạng tiền, thành phần giao diện.

// Bảng xử lý sự kiện, các file view tự đăng ký vào đây.
const Actions = {};   // click  -> [data-action]
const Changes = {};   // change -> [data-change]
const Submits = {};   // submit -> form[data-submit]

/* ---------- Ngày tháng (chuỗi 'YYYY-MM-DD' theo giờ máy) ---------- */

const pad2 = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function todayStr() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function weekdayOf(s) {
  const { y, m, d } = parseYmd(s);
  return new Date(y, m - 1, d).getDay();
}

const clampDay = (y, m, d) => ymd(y, m, Math.min(d, daysInMonth(y, m)));

function shiftDate(s, mode, step) {
  const { y, m, d } = parseYmd(s);
  if (mode === 'day') {
    const dt = new Date(y, m - 1, d + step);
    return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  if (mode === 'month') {
    const dt = new Date(y, m - 1 + step, 1);
    return clampDay(dt.getFullYear(), dt.getMonth() + 1, d);
  }
  return clampDay(y + step, m, d);
}

const prefixOf = (date, mode) => date.slice(0, mode === 'day' ? 10 : mode === 'month' ? 7 : 4);
const fmtDate = s => s.split('-').reverse().join('/');
const fmtMonth = ym => `Tháng ${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`;

/* ---------- Định dạng ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = n => Math.round(n).toLocaleString('vi-VN');
const fmtMoney = n => fmtNum(n) + ' ₫';
const fmtDays = n => n.toLocaleString('vi-VN');
const parseMoney = s => Number(String(s).replace(/\D/g, '')) || 0;
const clampPct = v => Math.min(100, Math.max(0, Number(v) || 0));
const sumBy = (list, fn) => list.reduce((t, x) => t + fn(x), 0);

function fmtShort(n) {
  const f = (v, unit) => v.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + unit;
  if (n >= 1e9) return f(n / 1e9, ' tỷ');
  if (n >= 1e6) return f(n / 1e6, ' tr');
  if (n >= 1e3) return f(n / 1e3, 'k');
  return String(n);
}

/* ---------- Trạng thái giao diện ---------- */

const UI = {
  tab: 'revenue',
  revenue: { mode: 'day', date: todayStr() },
  payroll: { section: 'payroll', mode: 'month', date: todayStr() },
};

const MODE_LABELS = { day: 'Ngày', month: 'Tháng', year: 'Năm' };
const NOW_LABELS = { day: 'Hôm nay', month: 'Tháng này', year: 'Năm nay' };

/* ---------- Thành phần giao diện ---------- */

function yearOptions(selected) {
  const cur = new Date().getFullYear();
  const from = Math.min(Store.minYear(), cur - 1, selected);
  const to = Math.max(cur + 1, selected);
  let html = '';
  for (let y = from; y <= to; y++) html += `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`;
  return html;
}

function monthOptions(selected) {
  let html = '';
  for (let m = 1; m <= 12; m++) html += `<option value="${m}"${m === selected ? ' selected' : ''}>Tháng ${m}</option>`;
  return html;
}

// Thanh chọn kỳ xem: chế độ Ngày/Tháng/Năm + nút lùi/tiến.
function toolbar(scope, mode, date, modes) {
  const { y, m } = parseYmd(date);
  const switcher = modes.length > 1
    ? `<div class="segmented">${modes.map(k =>
        `<button type="button" class="${k === mode ? 'active' : ''}" data-action="set-mode" data-scope="${scope}" data-mode="${k}">${MODE_LABELS[k]}</button>`).join('')}</div>`
    : '';
  let picker;
  if (mode === 'day') {
    picker = `<input type="date" value="${date}" data-change="nav-date" data-scope="${scope}" aria-label="Chọn ngày">`;
  } else {
    picker = (mode === 'month'
      ? `<select data-change="nav-part" data-part="m" data-scope="${scope}" aria-label="Chọn tháng">${monthOptions(m)}</select>` : '')
      + `<select data-change="nav-part" data-part="y" data-scope="${scope}" aria-label="Chọn năm">${yearOptions(y)}</select>`;
  }
  return `
    <div class="toolbar">
      ${switcher}
      <div class="period-nav">
        <button type="button" class="btn nav-arrow" data-action="nav-step" data-scope="${scope}" data-step="-1" aria-label="Kỳ trước">‹</button>
        ${picker}
        <button type="button" class="btn nav-arrow" data-action="nav-step" data-scope="${scope}" data-step="1" aria-label="Kỳ sau">›</button>
        <button type="button" class="btn" data-action="nav-today" data-scope="${scope}">${NOW_LABELS[mode]}</button>
      </div>
    </div>`;
}

const statTile = (label, value, sub = '', valueCls = '') => `
  <div class="stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value ${valueCls}">${esc(value)}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
  </div>`;

const field = (label, control, cls = '') => `<label class="field ${cls}"><span>${esc(label)}</span>${control}</label>`;

function selectOptions(list, selectedId, emptyLabel) {
  return (emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : '')
    + list.map(x => `<option value="${x.id}"${x.id === selectedId ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
}

// Bảng số liệu: `leftCols` cột đầu canh trái, còn lại là số canh phải. Ô đã là HTML an toàn.
function table(headers, rows, foot, leftCols = 1) {
  const tr = (cells, tag, attrs = '') =>
    `<tr ${attrs}>${cells.map((c, i) => `<${tag}${i >= leftCols ? ' class="num"' : ''}>${c}</${tag}>`).join('')}</tr>`;
  return `
    <div class="table-wrap"><table>
      <thead>${tr(headers, 'th')}</thead>
      <tbody>${rows.map(r => tr(r.cells, 'td', r.attrs)).join('')}</tbody>
      ${foot ? `<tfoot>${tr(foot, 'td')}</tfoot>` : ''}
    </table></div>`;
}

// Biểu đồ cột một chuỗi số liệu. items: [{ label, value, tip, attrs }]
function barChart(items) {
  const max = Math.max(0, ...items.map(i => i.value));
  if (!max) return '<p class="empty">Chưa có doanh thu trong kỳ này.</p>';
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].find(k => k * pow >= max) * pow;
  const n = items.length;
  const cols = items.map((it, i) => {
    const side = i < n / 3 ? 'tip-l' : i >= n * 2 / 3 ? 'tip-r' : '';
    return `
      <button type="button" class="bar-col" style="--h:${(it.value / top * 100).toFixed(2)}%" ${it.attrs || ''} aria-label="${esc(it.tip)}: ${fmtMoney(it.value)}">
        <span class="bar${it.value ? '' : ' zero'}"></span>
        <span class="tip ${side}">${esc(it.tip)}<b>${fmtMoney(it.value)}</b></span>
      </button>`;
  }).join('');
  return `
    <div class="chart">
      <div class="chart-y"><span>${fmtShort(top)}</span><span>${fmtShort(top / 2)}</span><span>0</span></div>
      <div class="chart-plot">${cols}</div>
      <div class="chart-x">${items.map(it => `<span>${esc(it.label)}</span>`).join('')}</div>
    </div>`;
}

/* ---------- Modal & thông báo ---------- */

function openModal({ title, body, submitLabel = 'Lưu', danger = false, onSubmit }) {
  const dlg = document.getElementById('modal');
  dlg.innerHTML = `
    <form class="modal-form">
      <h2>${esc(title)}</h2>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="modal-close">${onSubmit ? 'Hủy' : 'Đóng'}</button>
        ${onSubmit ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>` : ''}
      </div>
    </form>`;
  dlg.querySelector('form').onsubmit = e => {
    e.preventDefault();
    if (onSubmit(e.target) !== false) dlg.close();
  };
  if (!dlg.open) dlg.showModal();
}

Actions['modal-close'] = () => document.getElementById('modal').close();

function confirmBox(message, label = 'Xóa') {
  return new Promise(resolve => {
    openModal({ title: 'Xác nhận', body: `<p>${esc(message)}</p>`, submitLabel: label, danger: true, onSubmit: () => resolve(true) });
    document.getElementById('modal').addEventListener('close', () => resolve(false), { once: true });
  });
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2500);
}
