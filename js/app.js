// Khởi động app và điều hướng giữa các tab.

const Views = { revenue: RevenueView, payroll: PayrollView, settings: SettingsView };

let started = false;

// Dòng nhắc phía trên mọi màn hình khi phần đồng bộ đám mây cần người dùng để ý.
function cloudNotice() {
  const s = Cloud.status();
  if (!s.error && (!s.configured || s.email)) return '';
  const login = s.available && !s.email
    ? ' <button type="button" class="link" data-action="cloud-login">Đăng nhập bằng Google</button>' : '';
  const text = s.error || 'Chưa đăng nhập đồng bộ — dữ liệu nhập lúc này chỉ lưu trên máy này.';
  return `<p class="notice ${s.error ? 'error' : ''}">${esc(text)}${login}</p>`;
}

function render() {
  if (!started) return;
  document.getElementById('view').innerHTML = cloudNotice() + Views[UI.tab].render();
  for (const btn of document.querySelectorAll('.app-header [data-tab]')) {
    btn.classList.toggle('active', btn.dataset.tab === UI.tab);
  }
}

Actions['tab'] = el => {
  UI.tab = el.dataset.tab;
  render();
  window.scrollTo(0, 0);
};

Actions['set-mode'] = el => {
  UI[el.dataset.scope].mode = el.dataset.mode;
  render();
};

Actions['nav-step'] = el => {
  const s = UI[el.dataset.scope];
  s.date = shiftDate(s.date, s.mode, Number(el.dataset.step));
  render();
};

Actions['nav-today'] = el => {
  UI[el.dataset.scope].date = todayStr();
  render();
};

// Nhảy tới một kỳ cụ thể (bấm vào cột biểu đồ hoặc dòng trong bảng).
Actions['goto'] = el => {
  const { tab, mode, date } = el.dataset;
  UI.tab = tab;
  Object.assign(UI[tab], { mode, date });
  render();
  window.scrollTo(0, 0);
};

Changes['nav-date'] = el => {
  if (!el.value) return;
  UI[el.dataset.scope].date = el.value;
  render();
};

Changes['nav-part'] = el => {
  const s = UI[el.dataset.scope];
  const p = parseYmd(s.date);
  p[el.dataset.part] = Number(el.value);
  s.date = clampDay(p.y, p.m, p.d);
  render();
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el) Actions[el.dataset.action]?.(el);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el) Changes[el.dataset.change]?.(el);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  Submits[form.dataset.submit]?.(form);
});

// Ô nhập tiền tự thêm dấu chấm phân cách hàng nghìn.
document.addEventListener('input', e => {
  if (!e.target.classList?.contains('money')) return;
  const n = parseMoney(e.target.value);
  e.target.value = n ? fmtNum(n) : '';
});

Store.onError = () => toast('Không lưu được dữ liệu vào máy. Hãy sao lưu ra file trong Cài đặt.', true);

// Dữ liệu vừa đổi từ nơi khác (tab khác, máy khác qua đám mây): vẽ lại, trừ khi đang nhập dở để không xóa mất nội dung đang gõ.
function renderIfIdle() {
  const busy = document.getElementById('modal').open || document.activeElement?.matches('input, select');
  if (!busy) render();
}

Store.onChange = renderIfIdle;
Cloud.onStatus = renderIfIdle;

Actions['cloud-login'] = () => Cloud.signIn();
Actions['cloud-logout'] = async () => {
  if (await confirmBox('Đăng xuất khỏi đồng bộ đám mây? App sẽ quay lại dùng dữ liệu lưu riêng trên máy này.', 'Đăng xuất')) Cloud.signOut();
};

Store.load().then(() => Cloud.start()).then(() => {
  started = true;
  render();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
