// Tab "Lương nhân viên": bảng lương, bảng công, ứng lương và nhân viên mua sản phẩm.

const SECTIONS = {
  payroll: { label: 'Bảng lương', modes: ['month', 'year'] },
  attendance: { label: 'Bảng công', modes: ['day', 'month', 'year'] },
  advance: { label: 'Ứng lương', modes: ['month'] },
  purchase: { label: 'Mua sản phẩm', modes: ['month'] },
};

const ATT = {
  1: { sym: '✓', cls: 'att-full', label: 'Đi làm' },
  0.5: { sym: '½', cls: 'att-half', label: 'Nửa ngày' },
  0: { sym: '✗', cls: 'att-off', label: 'Nghỉ' },
};
const ATT_ORDER = [undefined, 1, 0.5, 0];

const NO_EMPLOYEE = `<section class="card"><p class="empty">Chưa có nhân viên. <button type="button" class="link" data-action="tab" data-tab="settings">Mở Cài đặt</button> để thêm nhân viên.</p></section>`;

const PayrollView = {
  render() {
    const s = UI.payroll;
    const sec = SECTIONS[s.section];
    if (!sec.modes.includes(s.mode)) s.mode = 'month';
    const tabs = Object.entries(SECTIONS).map(([key, v]) =>
      `<button type="button" class="${key === s.section ? 'active' : ''}" data-action="pay-section" data-section="${key}">${v.label}</button>`).join('');
    let body;
    if (s.section === 'payroll') body = s.mode === 'month' ? payrollMonth(s.date) : payrollYear(s.date);
    else if (s.section === 'attendance') body = AttendanceView[s.mode](s.date);
    else body = deductionView(s.section, s.date);
    return `<div class="subtabs">${tabs}</div>` + toolbar('payroll', s.mode, s.date, sec.modes) + body;
  },
};

Actions['pay-section'] = el => {
  UI.payroll.section = el.dataset.section;
  render();
};

/* ---------- Bảng lương ---------- */

const payTotals = rows => ({
  gross: sumBy(rows, r => r.gross),
  commission: sumBy(rows, r => r.commission),
  deducted: sumBy(rows, r => r.advance + r.purchase),
  net: sumBy(rows, r => r.net),
});

const minus = n => (n ? `−${fmtMoney(n)}` : fmtMoney(0));

function payrollMonth(date) {
  const ym = date.slice(0, 7);
  const rows = Store.payroll(ym);
  if (!rows.length) return NO_EMPLOYEE;
  const t = payTotals(rows);
  const cards = rows.map(r => `
    <article class="card pay-card">
      <header>
        <h3>${esc(r.emp.name)}</h3>
        <span class="badge ${r.byCommission ? 'badge-accent' : ''}">${r.byCommission ? 'Tính theo hoa hồng' : 'Tính theo lương cứng'}</span>
      </header>
      <dl class="pay-lines">
        <div class="${r.byCommission ? 'dim' : ''}"><dt>Lương cứng</dt><dd>${fmtMoney(r.base)}</dd></div>
        <div class="${r.byCommission ? '' : 'dim'}"><dt>Hoa hồng <small>${r.count} lượt · doanh thu ${fmtMoney(r.revenue)}</small></dt><dd>${fmtMoney(r.commission)}</dd></div>
        <div class="line-strong"><dt>Lương tháng <small>lấy mức cao hơn</small></dt><dd>${fmtMoney(r.gross)}</dd></div>
        <div><dt>Ứng lương</dt><dd>${minus(r.advance)}</dd></div>
        <div><dt>Mua sản phẩm</dt><dd>${minus(r.purchase)}</dd></div>
        <div class="line-total"><dt>Thực lĩnh</dt><dd class="${r.net < 0 ? 'neg' : ''}">${fmtMoney(r.net)}</dd></div>
      </dl>
      <footer>
        <span class="sub">${fmtDays(r.workDays)} ngày công</span>
        <button type="button" class="btn btn-sm" data-action="pay-detail" data-id="${r.emp.id}">Xem chi tiết</button>
      </footer>
    </article>`).join('');
  return `
    <section class="stats">
      ${statTile(`Tổng lương ${fmtMonth(ym).toLowerCase()}`, fmtMoney(t.gross), `${rows.length} nhân viên`)}
      ${statTile('Đã ứng và mua sản phẩm', fmtMoney(t.deducted))}
      ${statTile('Còn phải trả', fmtMoney(t.net))}
    </section>
    ${ym === todayStr().slice(0, 7) ? '<p class="hint">Tháng chưa kết thúc — số liệu tạm tính đến hôm nay.</p>' : ''}
    <div class="card-grid">${cards}</div>`;
}

function payrollYear(date) {
  const year = date.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${pad2(i + 1)}`;
    return { m: i + 1, ym, rows: Store.payroll(ym) };
  });
  const all = months.flatMap(x => x.rows);
  if (!all.length) return NO_EMPLOYEE;
  const t = payTotals(all);

  const monthRows = months.map(x => {
    const mt = payTotals(x.rows);
    return {
      cells: x.rows.length
        ? [`Tháng ${x.m}`, fmtMoney(mt.gross), fmtMoney(mt.deducted), fmtMoney(mt.net)]
        : [`Tháng ${x.m}`, '—', '—', '—'],
      attrs: `class="clickable" data-action="goto" data-tab="payroll" data-mode="month" data-date="${x.ym}-01"`,
    };
  });

  const byEmp = new Map();
  for (const r of all) {
    if (!byEmp.has(r.emp.id)) byEmp.set(r.emp.id, []);
    byEmp.get(r.emp.id).push(r);
  }
  const empRows = [...byEmp.values()].map(rows => {
    const et = payTotals(rows);
    return { cells: [esc(rows[0].emp.name), fmtMoney(et.commission), fmtMoney(et.gross), fmtMoney(et.deducted), fmtMoney(et.net)] };
  });

  return `
    <section class="stats">
      ${statTile(`Tổng lương năm ${year}`, fmtMoney(t.gross))}
      ${statTile('Đã ứng và mua sản phẩm', fmtMoney(t.deducted))}
      ${statTile('Thực lĩnh cả năm', fmtMoney(t.net))}
    </section>
    <section class="card">
      <h2>Theo tháng</h2>
      ${table(['Tháng', 'Tổng lương', 'Ứng + mua SP', 'Thực lĩnh'], monthRows, ['Cả năm', fmtMoney(t.gross), fmtMoney(t.deducted), fmtMoney(t.net)])}
    </section>
    <section class="card">
      <h2>Theo nhân viên</h2>
      ${table(['Nhân viên', 'Hoa hồng', 'Tổng lương', 'Ứng + mua SP', 'Thực lĩnh'], empRows)}
    </section>`;
}

Actions['pay-detail'] = el => {
  const empId = el.dataset.id;
  const ym = UI.payroll.date.slice(0, 7);
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const entries = Store.inPeriod('entries', ym).filter(e => e.employeeId === empId).sort(byDate);
  const deds = Store.inPeriod('deductions', ym).filter(d => d.employeeId === empId).sort(byDate);
  const dedTable = (type, label) => {
    const list = deds.filter(d => d.type === type);
    if (!list.length) return '';
    return `<h3>${label}</h3>` + table(['Ngày', 'Nội dung', 'Số tiền'],
      list.map(d => ({ cells: [fmtDate(d.date), esc([d.product, d.note].filter(Boolean).join(' · ')) || '—', fmtMoney(d.amount)] })),
      ['Tổng', '', fmtMoney(sumBy(list, d => d.amount))], 2);
  };
  openModal({
    title: `${Store.empName(empId)} — ${fmtMonth(ym)}`,
    body: `
      <h3>Dịch vụ đã làm</h3>
      ${entries.length
        ? table(['Ngày', 'Dịch vụ', 'Tiền thu', '%', 'Hoa hồng'],
            entries.map(e => ({ cells: [fmtDate(e.date).slice(0, 5), esc(Store.svcName(e.serviceId)), fmtNum(e.amount), e.pct, fmtNum(Store.commissionOf(e))] })),
            ['Tổng', `${entries.length} lượt`, fmtNum(sumBy(entries, e => e.amount)), '', fmtNum(sumBy(entries, Store.commissionOf))], 2)
        : '<p class="empty">Chưa làm dịch vụ nào trong tháng.</p>'}
      ${dedTable('advance', 'Ứng lương')}
      ${dedTable('purchase', 'Mua sản phẩm')}`,
  });
};

/* ---------- Bảng công ---------- */

// Nhân viên đang làm, hoặc đã xóa nhưng còn làm trong kỳ đang xem.
const attEmployees = prefix => Store.state.employees.filter(e => !e.deletedAt || e.deletedAt.slice(0, prefix.length) >= prefix);

const AttendanceView = {
  day(date) {
    const emps = attEmployees(date);
    if (!emps.length) return NO_EMPLOYEE;
    const entries = Store.inPeriod('entries', date);
    const list = emps.map(emp => {
      const mine = entries.filter(e => e.employeeId === emp.id);
      const cur = Store.attendanceOf(date, emp.id);
      const buttons = [1, 0.5, 0].map(v =>
        `<button type="button" class="${cur === v ? `active ${ATT[v].cls}` : ''}" data-action="att-set" data-emp="${emp.id}" data-val="${v}">${ATT[v].sym} ${ATT[v].label}</button>`).join('');
      return `
        <li class="row">
          <div class="row-main">
            <strong>${esc(emp.name)}</strong>
            <span class="sub">${mine.length} lượt · doanh thu ${fmtMoney(sumBy(mine, e => e.amount))} · hoa hồng ${fmtMoney(sumBy(mine, Store.commissionOf))}</span>
          </div>
          <div class="segmented att-buttons">${buttons}</div>
        </li>`;
    }).join('');
    return `
      <section class="card">
        <div class="card-head">
          <h2>Chấm công ${WEEKDAYS[weekdayOf(date)]} ${fmtDate(date)}</h2>
          <button type="button" class="btn btn-sm" data-action="att-all">Tất cả đi làm</button>
        </div>
        <ul class="rows">${list}</ul>
      </section>`;
  },

  month(date) {
    const { y, m } = parseYmd(date);
    const ym = date.slice(0, 7);
    const emps = attEmployees(ym);
    if (!emps.length) return NO_EMPLOYEE;
    const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
    const today = todayStr();
    const head = days.map(d => {
      const wd = weekdayOf(d);
      return `<th class="${wd === 0 ? 'sunday' : ''} ${d === today ? 'today' : ''}"><small>${WEEKDAYS[wd]}</small>${Number(d.slice(8))}</th>`;
    }).join('');
    const body = emps.map(emp => `
      <tr>
        <th>${esc(emp.name)}</th>
        ${days.map(d => {
          const a = ATT[Store.attendanceOf(d, emp.id)];
          return `<td><button type="button" class="att-cell ${a?.cls ?? ''}" data-action="att-cycle" data-emp="${emp.id}" data-date="${d}" aria-label="${esc(emp.name)} ngày ${fmtDate(d)}">${a?.sym ?? ''}</button></td>`;
        }).join('')}
        <td class="att-total">${fmtDays(Store.workDays(emp.id, ym))}</td>
      </tr>`).join('');
    return `
      <section class="card">
        <h2>Bảng công ${fmtMonth(ym).toLowerCase()}</h2>
        <div class="table-wrap"><table class="att-grid">
          <thead><tr><th>Nhân viên</th>${head}<th>Công</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>
        <p class="hint">Bấm vào ô để đổi lần lượt: ✓ đi làm → ½ nửa ngày → ✗ nghỉ → trống (chưa chấm).</p>
      </section>`;
  },

  year(date) {
    const year = date.slice(0, 4);
    const emps = attEmployees(year);
    if (!emps.length) return NO_EMPLOYEE;
    const rows = emps.map(emp => {
      const perMonth = Array.from({ length: 12 }, (_, i) => Store.workDays(emp.id, `${year}-${pad2(i + 1)}`));
      return { cells: [esc(emp.name), ...perMonth.map(n => (n ? fmtDays(n) : '—')), `<strong>${fmtDays(sumBy(perMonth, n => n))}</strong>`] };
    });
    return `
      <section class="card">
        <h2>Số ngày công năm ${year}</h2>
        ${table(['Nhân viên', ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`), 'Cả năm'], rows)}
      </section>`;
  },
};

Actions['att-set'] = el => {
  const { emp, val } = el.dataset;
  const value = Number(val);
  const date = UI.payroll.date;
  Store.setAttendance(date, emp, Store.attendanceOf(date, emp) === value ? undefined : value);
  render();
};

Actions['att-all'] = () => {
  const date = UI.payroll.date;
  for (const emp of attEmployees(date)) Store.setAttendance(date, emp.id, 1);
  render();
};

// Cập nhật ngay tại ô để bảng không bị cuộn về đầu.
Actions['att-cycle'] = el => {
  const { emp, date } = el.dataset;
  const next = ATT_ORDER[(ATT_ORDER.indexOf(Store.attendanceOf(date, emp)) + 1) % ATT_ORDER.length];
  Store.setAttendance(date, emp, next);
  el.textContent = ATT[next]?.sym ?? '';
  el.className = `att-cell ${ATT[next]?.cls ?? ''}`;
  el.closest('tr').querySelector('.att-total').textContent = fmtDays(Store.workDays(emp, date.slice(0, 7)));
};

/* ---------- Ứng lương & mua sản phẩm ---------- */

const DEDUCTIONS = {
  advance: { title: 'Ứng lương', add: 'Thêm khoản ứng', empty: 'Chưa có khoản ứng lương nào trong tháng này.' },
  purchase: { title: 'Nhân viên mua sản phẩm', add: 'Thêm khoản mua', empty: 'Chưa có khoản mua sản phẩm nào trong tháng này.' },
};

function deductionFields(type, d) {
  return `
    ${field('Ngày', `<input type="date" name="date" required value="${d.date}">`)}
    ${field('Nhân viên', `<select name="employeeId" required>${selectOptions(Store.pick('employees', d.employeeId), d.employeeId, 'Chọn nhân viên…')}</select>`)}
    ${type === 'purchase' ? field('Sản phẩm', `<input type="text" name="product" required autocomplete="off" value="${esc(d.product)}">`) : ''}
    ${field('Số tiền (₫)', `<input type="text" inputmode="numeric" class="money" name="amount" required autocomplete="off" value="${d.amount ? fmtNum(d.amount) : ''}">`)}
    ${field('Ghi chú', `<input type="text" name="note" autocomplete="off" value="${esc(d.note)}">`, type === 'advance' ? 'wide' : '')}`;
}

function readDeductionForm(form) {
  const f = form.elements;
  const amount = parseMoney(f.amount.value);
  if (!amount) {
    toast('Hãy nhập số tiền', true);
    return null;
  }
  const data = { date: f.date.value, employeeId: f.employeeId.value, amount, note: f.note.value.trim() };
  if (f.product) data.product = f.product.value.trim();
  return data;
}

function deductionView(type, date) {
  const ym = date.slice(0, 7);
  const cfg = DEDUCTIONS[type];
  if (!Store.state.employees.length) return NO_EMPLOYEE;
  const list = Store.inPeriod('deductions', ym).filter(d => d.type === type)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const today = todayStr();
  const rows = list.map(d => `
    <li class="row">
      <div class="row-main">
        <strong>${esc(Store.empName(d.employeeId))}</strong>
        <span class="sub">${fmtDate(d.date)}${d.product ? ` · ${esc(d.product)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</span>
      </div>
      <div class="row-amount">${fmtMoney(d.amount)}</div>
      <div class="row-actions">
        <button type="button" class="btn btn-sm" data-action="ded-edit" data-id="${d.id}">Sửa</button>
        <button type="button" class="btn btn-sm danger" data-action="ded-delete" data-id="${d.id}">Xóa</button>
      </div>
    </li>`).join('');
  return `
    <section class="stats">
      ${statTile(`${cfg.title} ${fmtMonth(ym).toLowerCase()}`, fmtMoney(sumBy(list, d => d.amount)), `${list.length} khoản · trừ thẳng vào lương tháng`)}
    </section>
    <section class="card">
      <h2>${cfg.add}</h2>
      <form class="form-grid" data-submit="ded-add" data-type="${type}">
        ${deductionFields(type, { date: today.startsWith(ym) ? today : `${ym}-01` })}
        <div class="form-actions"><button type="submit" class="btn btn-primary">${cfg.add}</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Danh sách trong tháng</h2>
      ${list.length ? `<ul class="rows">${rows}</ul>` : `<p class="empty">${cfg.empty}</p>`}
    </section>`;
}

Submits['ded-add'] = form => {
  const data = readDeductionForm(form);
  if (!data) return;
  Store.add('deductions', { ...data, type: form.dataset.type });
  UI.payroll.date = data.date;
  toast(`Đã lưu ${fmtMoney(data.amount)} cho ${Store.empName(data.employeeId)}`);
  render();
};

Actions['ded-edit'] = el => {
  const d = Store.get('deductions', el.dataset.id);
  openModal({
    title: `Sửa — ${DEDUCTIONS[d.type].title.toLowerCase()}`,
    body: `<div class="form-grid">${deductionFields(d.type, d)}</div>`,
    onSubmit: form => {
      const data = readDeductionForm(form);
      if (!data) return false;
      Store.update('deductions', d.id, data);
      render();
    },
  });
};

Actions['ded-delete'] = async el => {
  const d = Store.get('deductions', el.dataset.id);
  if (!(await confirmBox(`Xóa khoản ${fmtMoney(d.amount)} của ${Store.empName(d.employeeId)}?`))) return;
  Store.remove('deductions', d.id);
  render();
};
