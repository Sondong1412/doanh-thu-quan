// Khởi động app và điều hướng giữa các tab.

const Views = { revenue: RevenueView, payroll: PayrollView, settings: SettingsView };

let started = false;

// Dòng nhắc phía trên mọi màn hình khi phần đồng bộ đám mây cần người dùng để ý.
function cloudNotice() {
  const s = Cloud.status();
  const lines = [];
  if (s.error) {
    lines.push(`<p class="notice error">${esc(s.error)} <button type="button" class="link" data-action="cloud-dismiss">Đóng</button></p>`);
  }
  if (s.configured && s.available && !s.signedIn) {
    lines.push('<p class="notice">Chưa đăng nhập — dữ liệu nhập lúc này chỉ lưu trên máy này. <button type="button" class="link" data-action="cloud-login">Đăng nhập</button></p>');
  } else if (s.busy || s.loading) {
    lines.push(`<p class="notice">${esc(s.busy || 'Đang tải dữ liệu từ đám mây…')}</p>`);
  }
  return lines.join('');
}

// `keepDrafts`: giữ lại nội dung đang nhập dở trong các form (dùng khi vẽ lại vì dữ liệu đổi từ nơi khác).
function render(keepDrafts = false) {
  if (!started) return;
  // Báo cho phần đồng bộ biết kỳ đang xem để tải đúng phần dữ liệu đó.
  const scope = UI[UI.tab];
  if (scope) Cloud.need(scope.date.slice(0, scope.mode === 'year' ? 4 : 7));
  const view = document.getElementById('view');
  const drafts = keepDrafts
    ? [...view.querySelectorAll('form[data-submit] [name]')].map(el => [`form[data-submit="${el.form.dataset.submit}"] [name="${el.name}"]`, el.value])
    : [];
  view.innerHTML = cloudNotice() + Views[UI.tab].render();
  for (const [selector, value] of drafts) {
    const el = view.querySelector(selector);
    // Ô trống thì giữ giá trị mặc định mới; ô chọn chỉ khôi phục khi lựa chọn đó còn tồn tại.
    if (!el || value === '' || (el.options && ![...el.options].some(o => o.value === value))) continue;
    el.value = value;
  }
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
  if (!busy) render(true);
}

Store.onChange = renderIfIdle;
Cloud.onStatus = renderIfIdle;

Actions['cloud-login'] = () => openModal({
  title: 'Đăng nhập',
  body: `
    <div class="form-grid">
      ${field('Tên đăng nhập', '<input type="text" name="username" required autocapitalize="none" autocomplete="username">', 'wide')}
      ${field('Mật khẩu', '<input type="password" name="password" required autocomplete="current-password">', 'wide')}
    </div>
    <p class="hint">Chủ quán không cần tên đăng nhập:
      <button type="button" class="link" data-action="cloud-google">Đăng nhập bằng Google</button></p>`,
  submitLabel: 'Đăng nhập',
  onSubmit: form => {
    const f = form.elements;
    Cloud.signInPassword(f.username.value, f.password.value)
      .then(() => document.getElementById('modal').close(), err => toast(authError(err), true));
    return false;
  },
});

Actions['cloud-google'] = () => {
  document.getElementById('modal').close();
  Cloud.signIn();
};

Actions['cloud-dismiss'] = () => {
  Cloud.clearError();
  render();
};

Actions['cloud-logout'] = async () => {
  if (await confirmBox('Đăng xuất? App sẽ quay lại dùng dữ liệu lưu riêng trên máy này.', 'Đăng xuất')) {
    UI.tab = 'revenue';
    Cloud.signOut();
  }
};

Store.load().then(() => Cloud.start()).then(() => {
  started = true;
  render();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
