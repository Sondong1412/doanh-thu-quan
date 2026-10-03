// Màn hình "Cài đặt": nhân viên, dịch vụ, đồng bộ đám mây, tài khoản đăng nhập và sao lưu dữ liệu.

function cloudCard() {
  const s = Cloud.status();
  let body;
  if (!s.onWeb) {
    body = '<p class="hint">Đồng bộ đám mây chỉ hoạt động khi mở app bằng địa chỉ web, không dùng được khi mở file trực tiếp trên máy.</p>';
  } else if (!s.configured) {
    body = '<p class="hint">Chưa thiết lập. Dữ liệu hiện chỉ lưu trên máy này.</p>';
  } else {
    body = `
      <p>Đang đăng nhập: <strong>${esc(s.name)}</strong> <span class="badge">${ROLE_LABELS[s.role]}</span></p>
      <p class="hint">${s.pending
        ? 'Có thay đổi đang chờ gửi lên, sẽ tự gửi khi có mạng.'
        : 'Mọi thay đổi đã được lưu lên đám mây và tự cập nhật trên các máy khác.'}</p>
      <div class="button-row">
        ${s.viaGoogle ? '' : '<button type="button" class="btn" data-action="cloud-password">Đổi mật khẩu</button>'}
        <button type="button" class="btn" data-action="cloud-logout">Đăng xuất</button>
      </div>`;
  }
  return `<section class="card"><h2>Đồng bộ đám mây</h2>${body}</section>`;
}

// Tài khoản đang được bấm "Xem mật khẩu"; mặc định mật khẩu bị che để người đứng cạnh không nhìn thấy.
const revealed = new Set();

// Chủ quán quản lý mọi tài khoản; quản lý chỉ xem được tài khoản (và mật khẩu) của nhân viên.
function accountsCard() {
  const owner = can('manage');
  const rows = Cloud.members().map(m => {
    const shown = revealed.has(m.uid);
    const password = !m.password ? 'chưa lưu (tài khoản tạo trước khi có tính năng xem mật khẩu)' : shown ? `<code>${esc(m.password)}</code>` : '••••••••';
    return `
      <li class="row">
        <div class="row-main">
          <strong>${esc(m.username)}</strong>
          <span class="sub">${ROLE_LABELS[m.role] ?? esc(m.role)}${m.employeeId ? ` · ${esc(Store.empName(m.employeeId))}` : ''}</span>
          <span class="sub">Mật khẩu: ${password}</span>
        </div>
        <div class="row-actions">
          ${m.password ? `<button type="button" class="btn btn-sm" data-action="acc-reveal" data-uid="${m.uid}">${shown ? 'Ẩn mật khẩu' : 'Xem mật khẩu'}</button>` : ''}
          ${owner ? `
            <button type="button" class="btn btn-sm" data-action="acc-edit" data-uid="${m.uid}">Sửa</button>
            <button type="button" class="btn btn-sm danger" data-action="acc-delete" data-uid="${m.uid}">Xóa</button>` : ''}
        </div>
      </li>`;
  }).join('');
  return `
    <section class="card">
      <div class="card-head">
        <h2>${owner ? 'Tài khoản đăng nhập' : 'Tài khoản nhân viên'}</h2>
        ${owner ? '<button type="button" class="btn btn-primary btn-sm" data-action="acc-add">+ Thêm tài khoản</button>' : ''}
      </div>
      ${owner ? '<p class="hint">Quản lý: nhập doanh thu cho mọi người, chấm công, ứng lương, xem bảng lương và xem mật khẩu của nhân viên. Nhân viên: chỉ nhập doanh thu và xem lương của chính mình.</p>' : ''}
      ${rows ? `<ul class="rows">${rows}</ul>` : `<p class="empty">${owner ? 'Chưa có tài khoản nào ngoài chủ quán.' : 'Chưa có tài khoản nhân viên nào.'}</p>`}
    </section>`;
}

Actions['acc-reveal'] = el => {
  const { uid } = el.dataset;
  if (!revealed.delete(uid)) revealed.add(uid);
  render();
};

const SettingsView = {
  render() {
    const synced = Cloud.status().signedIn;
    const manage = can('manage');
    const nowYm = todayStr().slice(0, 7);
    const emps = Store.employees().map(emp => {
      const own = Store.services().filter(s => emp.rates?.[s.id] !== undefined).length;
      return `
        <li class="row">
          <div class="row-main">
            <strong>${esc(emp.name)}</strong>
            <span class="sub">Lương cứng ${fmtMoney(Store.baseSalaryFor(emp, nowYm))}/tháng${own ? ` · ${own} dịch vụ có % riêng` : ''}</span>
          </div>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" data-action="emp-edit" data-id="${emp.id}">Sửa</button>
            <button type="button" class="btn btn-sm danger" data-action="emp-delete" data-id="${emp.id}">Xóa</button>
          </div>
        </li>`;
    }).join('');
    const svcs = Store.services().map(s => `
      <li class="row">
        <div class="row-main">
          <strong>${esc(s.name)}</strong>
          <span class="sub">Giá ${fmtMoney(s.price)} · hoa hồng ${s.pct}%</span>
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-sm" data-action="svc-edit" data-id="${s.id}">Sửa</button>
          <button type="button" class="btn btn-sm danger" data-action="svc-delete" data-id="${s.id}">Xóa</button>
        </div>
      </li>`).join('');
    // Nhân viên, dịch vụ, tài khoản và sao lưu chỉ dành cho chủ quán.
    return `
      ${manage ? `
        <section class="card">
          <div class="card-head">
            <h2>Nhân viên</h2>
            <button type="button" class="btn btn-primary btn-sm" data-action="emp-edit">+ Thêm nhân viên</button>
          </div>
          ${emps ? `<ul class="rows">${emps}</ul>` : '<p class="empty">Chưa có nhân viên nào.</p>'}
        </section>
        <section class="card">
          <div class="card-head">
            <h2>Dịch vụ</h2>
            <button type="button" class="btn btn-primary btn-sm" data-action="svc-edit">+ Thêm dịch vụ</button>
          </div>
          ${svcs ? `<ul class="rows">${svcs}</ul>` : '<p class="empty">Chưa có dịch vụ nào.</p>'}
        </section>` : ''}
      ${can('editHr') ? `
        <section class="card">
          <h2>Nhập liệu</h2>
          <label class="check">
            <input type="checkbox" data-change="set-shorthand"${Store.settings().shorthand ? ' checked' : ''}>
            <span>
              <strong>Nhập tiền rút gọn theo nghìn</strong>
              <small>Gõ 150 là 150.000 ₫, gõ 20 là 20.000 ₫, gõ 1000 là 1.000.000 ₫. Áp dụng cho mọi ô nhập tiền${synced ? ', trên mọi máy và mọi tài khoản của quán' : ''}; cạnh ô nhập luôn hiện số tiền đầy đủ để kiểm tra.</small>
            </span>
          </label>
        </section>` : ''}
      ${cloudCard()}
      ${synced && can('seeShop') ? accountsCard() : ''}
      ${manage ? `
        <section class="card">
          <h2>Dữ liệu</h2>
          <p class="hint">${synced
            ? 'Dữ liệu đang được lưu trên đám mây. Khôi phục từ file hoặc xóa toàn bộ sẽ áp dụng cho mọi máy đang dùng chung dữ liệu này.'
            : 'Dữ liệu được lưu trong trình duyệt của riêng máy này. Hãy sao lưu ra file định kỳ để không mất dữ liệu khi đổi máy hoặc xóa dữ liệu trình duyệt.'}</p>
          <div class="button-row">
            <button type="button" class="btn" data-action="data-export">Sao lưu ra file</button>
            <label class="btn">Khôi phục từ file<input type="file" accept=".json,application/json" data-change="data-import" hidden></label>
            <button type="button" class="btn danger" data-action="data-reset">Xóa toàn bộ dữ liệu</button>
          </div>
        </section>` : ''}`;
  },
};

Changes['set-shorthand'] = el => {
  Store.setSetting('shorthand', el.checked);
  render();
};

/* ---------- Tài khoản đăng nhập ---------- */

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Tên đăng nhập này đã có người dùng, hãy chọn tên khác.',
  'auth/weak-password': 'Mật khẩu quá yếu, hãy đặt dài và khó đoán hơn.',
  'auth/operation-not-allowed': 'Chưa bật kiểu đăng nhập Email/Password trong Firebase Console (Authentication > Sign-in method).',
  'auth/invalid-credential': 'Sai tên đăng nhập hoặc mật khẩu.',
  'auth/wrong-password': 'Sai mật khẩu.',
  'auth/user-not-found': 'Sai tên đăng nhập hoặc mật khẩu.',
  'auth/invalid-email': 'Tên đăng nhập không hợp lệ.',
  'auth/too-many-requests': 'Thử sai quá nhiều lần, hãy chờ một lúc rồi thử lại.',
  'auth/network-request-failed': 'Không kết nối được máy chủ, hãy kiểm tra mạng.',
};
const authError = err => AUTH_ERRORS[err?.code] ?? `Có lỗi: ${err?.message ?? err}`;

// Chạy một việc cần máy chủ trả lời rồi mới đóng hộp thoại; lỗi thì báo và giữ nguyên nội dung đang nhập.
function submitAsync(task, done) {
  task.then(() => {
    document.getElementById('modal').close();
    toast(done);
    render();
  }, err => toast(authError(err), true));
  return false;
}

function accountFields(m) {
  const roles = m ? ['manager', 'staff', 'blocked'] : ['staff', 'manager'];
  return `
    ${field('Vai trò', `<select name="role">${roles.map(r =>
      `<option value="${r}"${m?.role === r ? ' selected' : ''}>${r === 'blocked' ? 'Khóa, không cho đăng nhập' : ROLE_LABELS[r]}</option>`).join('')}</select>`)}
    ${field('Là nhân viên nào', `<select name="employeeId">${selectOptions(Store.pick('employees', m?.employeeId), m?.employeeId, 'Không gắn với nhân viên')}</select>`)}`;
}

function readAccountForm(form) {
  const f = form.elements;
  const data = { role: f.role.value, employeeId: f.employeeId.value || null };
  if (data.role === 'staff' && !data.employeeId) {
    toast('Tài khoản nhân viên phải gắn với một người trong danh sách nhân viên', true);
    return null;
  }
  return data;
}

Actions['acc-add'] = () => openModal({
  title: 'Thêm tài khoản',
  body: `
    <div class="form-grid">
      ${field('Tên đăng nhập', '<input type="text" name="username" required pattern="[a-z0-9._\\-]{3,30}" autocapitalize="none" autocomplete="off" title="3 đến 30 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch ngang">')}
      ${field('Mật khẩu (ít nhất 8 ký tự)', '<input type="text" name="password" required minlength="8" autocomplete="off">')}
      ${accountFields()}
    </div>
    <p class="hint">Chủ quán xem lại được mật khẩu trong danh sách tài khoản (quản lý xem được của nhân viên). Tên đăng nhập đã tạo thì không đổi được.</p>`,
  submitLabel: 'Tạo tài khoản',
  onSubmit: form => {
    const data = readAccountForm(form);
    if (!data) return false;
    const username = form.elements.username.value;
    return submitAsync(Cloud.createAccount({ ...data, username, password: form.elements.password.value }), `Đã tạo tài khoản ${username}`);
  },
});

Actions['acc-edit'] = el => {
  const m = Cloud.members().find(x => x.uid === el.dataset.uid);
  openModal({
    title: `Tài khoản ${m.username}`,
    body: `
      <div class="form-grid">${accountFields(m)}</div>
      <p class="hint">${m.password
        ? 'Quên mật khẩu: đóng hộp này rồi bấm nút "Xem mật khẩu" cạnh tài khoản trong mục Tài khoản đăng nhập.'
        : 'Tài khoản này được tạo trước khi app lưu mật khẩu nên chưa xem lại được. Khi người dùng tự đổi mật khẩu (Cài đặt → Đổi mật khẩu) thì mật khẩu mới sẽ xem được ở đây. Nếu họ đã quên mật khẩu, hãy xóa tài khoản này và tạo tài khoản mới với tên đăng nhập khác.'}</p>`,
    onSubmit: form => {
      const data = readAccountForm(form);
      if (!data) return false;
      return submitAsync(Cloud.updateAccount(m.uid, data), `Đã cập nhật tài khoản ${m.username}`);
    },
  });
};

Actions['acc-delete'] = async el => {
  const m = Cloud.members().find(x => x.uid === el.dataset.uid);
  const ok = await confirmBox(`Xóa tài khoản "${m.username}"? Người này sẽ bị đăng xuất và không đăng nhập được nữa. Số liệu doanh thu, lương đã nhập vẫn giữ nguyên. Tên đăng nhập "${m.username}" sẽ không tạo lại được.`);
  if (!ok) return;
  Cloud.deleteAccount(m.uid).then(() => toast(`Đã xóa tài khoản ${m.username}`), err => toast(authError(err), true));
};

Actions['cloud-password'] = () => openModal({
  title: 'Đổi mật khẩu',
  body: `
    <div class="form-grid">
      ${field('Mật khẩu hiện tại', '<input type="password" name="current" required autocomplete="current-password">', 'wide')}
      ${field('Mật khẩu mới (ít nhất 8 ký tự)', '<input type="password" name="next" required minlength="8" autocomplete="new-password">', 'wide')}
    </div>
    <p class="hint">Chủ quán${Cloud.role() === 'staff' ? ' và quản lý' : ''} xem được mật khẩu này, nên đừng dùng mật khẩu bạn đang dùng ở nơi khác.</p>`,
  submitLabel: 'Đổi mật khẩu',
  onSubmit: form => submitAsync(Cloud.changePassword(form.elements.current.value, form.elements.next.value), 'Đã đổi mật khẩu'),
});

/* ---------- Nhân viên ---------- */

Actions['emp-edit'] = el => {
  const emp = Store.employee(el.dataset.id);
  const now = parseYmd(todayStr());
  const services = Store.services();
  const rates = services.map(s => field(`${s.name} (mặc định ${s.pct}%)`,
    `<input type="number" name="rate-${s.id}" min="0" max="100" step="any" placeholder="${s.pct}" value="${emp?.rates?.[s.id] ?? ''}">`)).join('');
  openModal({
    title: emp ? 'Sửa nhân viên' : 'Thêm nhân viên',
    body: `
      <div class="form-grid">
        ${field('Tên nhân viên', `<input type="text" name="name" required autocomplete="off" value="${esc(emp?.name)}">`, 'wide')}
        ${field(`Lương cứng mỗi tháng (${moneyUnit()})`, moneyInput('baseSalary', emp ? Store.baseSalaryFor(emp, todayStr().slice(0, 7)) : 0), emp ? '' : 'wide')}
        ${emp ? field('Mức lương này áp dụng từ', `<span class="inline-selects"><select name="fromMonth">${monthOptions(now.m)}</select><select name="fromYear">${yearOptions(now.y)}</select></span>`) : ''}
      </div>
      <h3>% hoa hồng riêng theo dịch vụ</h3>
      ${services.length
        ? `<p class="hint">Để trống nếu nhân viên hưởng % mặc định của dịch vụ.</p><div class="form-grid">${rates}</div>`
        : '<p class="hint">Chưa có dịch vụ nào. Thêm dịch vụ trước rồi quay lại đặt % riêng nếu cần.</p>'}`,
    onSubmit: form => {
      const f = form.elements;
      const ownRates = {};
      for (const s of services) {
        const v = f[`rate-${s.id}`].value;
        if (v !== '') ownRates[s.id] = clampPct(v);
      }
      Store.saveEmployee({
        id: emp?.id,
        name: f.name.value.trim(),
        baseSalary: parseMoney(f.baseSalary.value),
        from: emp ? `${f.fromYear.value}-${pad2(f.fromMonth.value)}` : null,
        rates: ownRates,
      });
      render();
    },
  });
};

Actions['emp-delete'] = async el => {
  const emp = Store.employee(el.dataset.id);
  if (!(await confirmBox(`Xóa nhân viên "${emp.name}"? Số liệu doanh thu và lương các tháng trước vẫn được giữ lại.`))) return;
  Store.removeItem('employees', emp.id);
  render();
};

/* ---------- Dịch vụ ---------- */

Actions['svc-edit'] = el => {
  const svc = Store.service(el.dataset.id);
  openModal({
    title: svc ? 'Sửa dịch vụ' : 'Thêm dịch vụ',
    body: `
      <div class="form-grid">
        ${field('Tên dịch vụ', `<input type="text" name="name" required autocomplete="off" value="${esc(svc?.name)}">`, 'wide')}
        ${field(`Giá mặc định (${moneyUnit()})`, moneyInput('price', svc?.price))}
        ${field('% hoa hồng nhân viên', `<input type="number" name="pct" min="0" max="100" step="any" required value="${svc?.pct ?? ''}">`)}
      </div>
      <p class="hint">Giá và % được điền sẵn khi nhập doanh thu, vẫn sửa được cho từng lượt khách. Đổi ở đây không làm thay đổi các khoản đã nhập.</p>`,
    onSubmit: form => {
      const f = form.elements;
      Store.saveService({ id: svc?.id, name: f.name.value.trim(), price: parseMoney(f.price.value), pct: clampPct(f.pct.value) });
      render();
    },
  });
};

Actions['svc-delete'] = async el => {
  const svc = Store.service(el.dataset.id);
  if (!(await confirmBox(`Xóa dịch vụ "${svc.name}"? Các khoản doanh thu đã nhập vẫn được giữ lại.`))) return;
  Store.removeItem('services', svc.id);
  render();
};

/* ---------- Sao lưu ---------- */

Actions['data-export'] = async () => {
  let json;
  try {
    json = Cloud.status().signedIn ? await Cloud.exportData() : Store.exportData();
  } catch {
    toast('Cần có mạng để sao lưu toàn bộ dữ liệu trên đám mây', true);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `doanh-thu-quan-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

Changes['data-import'] = async el => {
  const file = el.files[0];
  if (!file) return;
  const text = await file.text();
  el.value = '';
  const scope = Cloud.status().signedIn ? ' trên đám mây (mọi máy đang dùng chung)' : '';
  if (!(await confirmBox(`Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại${scope} bằng dữ liệu trong file. Tiếp tục?`, 'Khôi phục'))) return;
  try {
    Store.importData(text);
    toast('Đã khôi phục dữ liệu');
    render();
  } catch {
    toast('File sao lưu không hợp lệ', true);
  }
};

Actions['data-reset'] = async () => {
  const scope = Cloud.status().signedIn ? ' trên đám mây, ở mọi máy đang dùng chung' : '';
  if (!(await confirmBox(`Xóa toàn bộ nhân viên, dịch vụ, doanh thu và bảng lương${scope}? Không thể hoàn tác.`, 'Xóa tất cả'))) return;
  Store.reset();
  toast('Đã xóa toàn bộ dữ liệu');
  render();
};
