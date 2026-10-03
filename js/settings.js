// Màn hình "Cài đặt": quản lý nhân viên, dịch vụ và sao lưu dữ liệu.

const SettingsView = {
  render() {
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
    return `
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
      </section>
      <section class="card">
        <h2>Dữ liệu</h2>
        <p class="hint">Dữ liệu được lưu trong trình duyệt của riêng máy này. Hãy sao lưu ra file định kỳ để không mất dữ liệu khi đổi máy hoặc xóa dữ liệu trình duyệt.</p>
        <div class="button-row">
          <button type="button" class="btn" data-action="data-export">Sao lưu ra file</button>
          <label class="btn">Khôi phục từ file<input type="file" accept=".json,application/json" data-change="data-import" hidden></label>
          <button type="button" class="btn danger" data-action="data-reset">Xóa toàn bộ dữ liệu</button>
        </div>
      </section>`;
  },
};

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
        ${field('Lương cứng mỗi tháng (₫)', `<input type="text" inputmode="numeric" class="money" name="baseSalary" autocomplete="off" value="${emp ? fmtNum(Store.baseSalaryFor(emp, todayStr().slice(0, 7))) : ''}">`, emp ? '' : 'wide')}
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
        ${field('Giá mặc định (₫)', `<input type="text" inputmode="numeric" class="money" name="price" autocomplete="off" value="${svc?.price ? fmtNum(svc.price) : ''}">`)}
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

Actions['data-export'] = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([Store.exportData()], { type: 'application/json' }));
  a.download = `doanh-thu-quan-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

Changes['data-import'] = async el => {
  const file = el.files[0];
  if (!file) return;
  const text = await file.text();
  el.value = '';
  if (!(await confirmBox('Khôi phục sẽ thay thế toàn bộ dữ liệu hiện tại bằng dữ liệu trong file. Tiếp tục?', 'Khôi phục'))) return;
  try {
    Store.importData(text);
    toast('Đã khôi phục dữ liệu');
    render();
  } catch {
    toast('File sao lưu không hợp lệ', true);
  }
};

Actions['data-reset'] = async () => {
  if (!(await confirmBox('Xóa toàn bộ nhân viên, dịch vụ, doanh thu và bảng lương? Không thể hoàn tác.', 'Xóa tất cả'))) return;
  Store.reset();
  toast('Đã xóa toàn bộ dữ liệu');
  render();
};
