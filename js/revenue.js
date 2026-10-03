// Tab "Doanh thu quán": nhập doanh thu hàng ngày, tổng hợp theo ngày / tháng / năm.

// Gom nhóm doanh thu theo khóa -> Map(key => { count, total })
function groupEntries(entries, keyFn) {
  const groups = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    const g = groups.get(key) ?? { count: 0, total: 0 };
    g.count++;
    g.total += e.amount;
    groups.set(key, g);
  }
  return groups;
}

// Form sửa một khoản doanh thu (trong hộp thoại).
function entryFields(e = {}) {
  // Nhân viên chỉ nhập doanh thu cho chính mình, với % hoa hồng do chủ quán đặt sẵn.
  const shopWide = can('seeShop');
  const employeeId = shopWide ? e.employeeId : Cloud.myEmployee();
  return `
    ${field('Dịch vụ', `<select name="serviceId" data-change="entry-sync">${selectOptions(Store.pick('services', e.serviceId), e.serviceId, 'Khác')}</select>`)}
    ${field('Nhân viên làm', `<select name="employeeId" data-change="entry-sync">${selectOptions(Store.pick('employees', employeeId), employeeId, shopWide ? 'Không có (doanh thu quán)' : '')}</select>`)}
    ${field(`Số tiền thu của khách (${moneyUnit()})`, moneyInput('amount', e.amount, true))}
    ${field('% hoa hồng nhân viên', `<input type="number" name="pct" min="0" max="100" step="any" value="${e.pct ?? 0}"${shopWide ? '' : ' readonly'}>`)}
    ${field('Ghi chú', `<input type="text" name="note" autocomplete="off" value="${esc(e.note)}">`, 'wide')}`;
}

/* ---------- Form nhập nhanh: bấm chọn nhân viên và dịch vụ thay cho danh sách thả xuống ---------- */

// Lựa chọn đang bấm dở, giữ qua các lần vẽ lại màn hình. Rỗng là chưa chọn;
// 'shop' là "không gắn nhân viên", 'other' là dịch vụ "Khác".
const quick = { employeeId: '', serviceId: '', filter: '' };
const pickedId = value => (value === 'shop' || value === 'other' ? null : value || null);

// Bỏ dấu tiếng Việt để tìm tên không cần gõ dấu.
const plain = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

function chips(fieldName, items, selected, filter = '') {
  return items.map(x => {
    const key = plain(x.name);
    const hide = filter && x.id !== selected && !key.includes(filter);
    return `<button type="button" class="chip${x.id === selected ? ' active' : ''}" data-action="quick-pick" data-field="${fieldName}" data-value="${x.id}" data-key="${esc(key)}"${hide ? ' hidden' : ''}>${esc(x.name)}</button>`;
  }).join('');
}

// Các mức giá hay nhập cho một dịch vụ (ngoài giá mặc định), để bấm chọn thay vì gõ.
function suggestionChips(serviceId) {
  if (!serviceId) return '';
  const price = Store.service(serviceId)?.price;
  const counts = new Map();
  for (const e of Store.state.entries) {
    if (e.serviceId === serviceId && e.amount !== price) counts.set(e.amount, (counts.get(e.amount) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([amount]) => amount).sort((a, b) => a - b)
    .map(amount => `<button type="button" class="chip chip-sm" data-action="quick-amount" data-amount="${amount}">${fmtNum(amount)}</button>`).join('');
}

function quickEntryForm(date) {
  const shopWide = can('seeShop');
  const employees = Store.employees();
  const services = Store.services();
  if (!shopWide) quick.employeeId = Cloud.myEmployee() ?? '';
  else if (quick.employeeId !== 'shop' && !employees.some(e => e.id === quick.employeeId)) quick.employeeId = '';
  if (quick.serviceId !== 'other' && !services.some(x => x.id === quick.serviceId)) quick.serviceId = '';
  const serviceId = pickedId(quick.serviceId);
  const employeeId = pickedId(quick.employeeId);
  // Người đã được chấm công đi làm hôm nay xếp lên trước.
  const absent = e => (Store.attendanceOf(date, e.id) ? 0 : 1);
  const sorted = [...employees].sort((a, b) => absent(a) - absent(b));
  return `
    <form class="quick" data-submit="entry-add">
      <input type="hidden" name="employeeId" value="${quick.employeeId}">
      <input type="hidden" name="serviceId" value="${quick.serviceId}">
      ${shopWide ? `
        <div class="pick">
          <div class="pick-head">
            <span>Nhân viên làm</span>
            ${employees.length > 8 ? `<input type="search" placeholder="Tìm tên…" data-input="quick-filter" value="${esc(quick.filter)}" aria-label="Tìm nhân viên">` : ''}
          </div>
          <div class="chips">${chips('employeeId', [...sorted, { id: 'shop', name: 'Không gắn nhân viên' }], quick.employeeId, plain(quick.filter.trim()))}</div>
        </div>` : ''}
      <div class="pick">
        <div class="pick-head"><span>Dịch vụ</span></div>
        <div class="chips">${chips('serviceId', [...services, { id: 'other', name: 'Khác' }], quick.serviceId)}</div>
      </div>
      <div class="form-grid">
        <div class="field wide">
          <span>Số tiền thu của khách (${moneyUnit()})</span>
          <div class="amount-row">
            ${moneyInput('amount', Store.service(serviceId)?.price, true)}
            ${shorthand() ? '' : '<button type="button" class="btn" data-action="quick-000" title="Thêm ba số 0">000</button>'}
          </div>
          <div class="chips" data-suggest>${suggestionChips(serviceId)}</div>
        </div>
        ${field('% hoa hồng', `<input type="number" name="pct" min="0" max="100" step="any" value="${employeeId ? Store.rateFor(employeeId, serviceId) : 0}"${shopWide ? '' : ' readonly'}>`)}
        ${field('Ghi chú', '<input type="text" name="note" autocomplete="off">')}
        <div class="form-actions"><button type="submit" class="btn btn-primary">Thêm doanh thu</button></div>
      </div>
    </form>`;
}

// Chọn dịch vụ / nhân viên thì tự điền giá và % hoa hồng tương ứng.
function syncEntryForm(form, changed) {
  const f = form.elements;
  const serviceId = pickedId(f.serviceId.value);
  const employeeId = can('seeShop') ? pickedId(f.employeeId.value) : Cloud.myEmployee();
  const price = Store.service(serviceId)?.price;
  if (changed === 'serviceId' && price) setMoney(f.amount, price);
  f.pct.value = employeeId ? Store.rateFor(employeeId, serviceId) : 0;
  const suggest = form.querySelector('[data-suggest]');
  if (suggest && changed === 'serviceId') suggest.innerHTML = suggestionChips(serviceId);
}

Changes['entry-sync'] = el => syncEntryForm(el.form, el.name);

Actions['quick-pick'] = el => {
  const { field: name, value } = el.dataset;
  quick[name] = value;
  el.form.elements[name].value = value;
  for (const chip of el.parentElement.children) chip.classList.toggle('active', chip === el);
  syncEntryForm(el.form, name);
};

Actions['quick-amount'] = el => setMoney(el.form.elements.amount, Number(el.dataset.amount));
Actions['quick-000'] = el => setMoney(el.form.elements.amount, parseMoney(el.form.elements.amount.value) * 1000);

Inputs['quick-filter'] = el => {
  quick.filter = el.value;
  const query = plain(el.value.trim());
  for (const chip of el.closest('.pick').querySelectorAll('.chip')) {
    chip.hidden = Boolean(query) && !chip.classList.contains('active') && !chip.dataset.key.includes(query);
  }
};

function readEntryForm(form) {
  const f = form.elements;
  const amount = parseMoney(f.amount.value);
  if (!amount) {
    toast('Hãy nhập số tiền', true);
    return null;
  }
  // Nhân viên luôn nhập cho chính mình với % đã định sẵn, bất kể form đang hiện gì.
  const shopWide = can('seeShop');
  const serviceId = pickedId(f.serviceId.value);
  const employeeId = shopWide ? pickedId(f.employeeId.value) : Cloud.myEmployee();
  return {
    serviceId,
    employeeId,
    amount,
    pct: shopWide ? clampPct(f.pct.value) : Store.rateFor(employeeId, serviceId),
    note: f.note.value.trim(),
  };
}

function breakdownCards(entries) {
  const rowsOf = (keyFn, nameFn) => [...groupEntries(entries, keyFn)]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, g]) => ({ cells: [esc(nameFn(id)), g.count, fmtMoney(g.total)] }));
  return `
    <section class="card">
      <h2>Theo dịch vụ</h2>
      ${table(['Dịch vụ', 'Lượt', 'Doanh thu'], rowsOf(e => e.serviceId, Store.svcName))}
    </section>
    ${can('seeShop') ? `
      <section class="card">
        <h2>Theo nhân viên</h2>
        ${table(['Nhân viên', 'Lượt', 'Doanh thu'], rowsOf(e => e.employeeId, id => (id ? Store.empName(id) : 'Không gắn nhân viên')))}
      </section>` : ''}`;
}

// Tổng lương phải trả nhân viên trong tháng (mức cao hơn giữa lương cứng và hoa hồng của từng người).
const staffPay = ym => sumBy(Store.payroll(ym), r => r.gross);

// Ô "Doanh thu thực nhận" đặt cạnh ô tổng doanh thu: doanh thu trừ phần trả cho nhân viên.
// Nhân viên chỉ thấy doanh thu của riêng mình nên không có ô này.
function netTile(total, cost, costLabel, provisional = false) {
  if (!can('seeShop')) return '';
  return statTile('Doanh thu thực nhận', fmtMoney(total - cost),
    `Đã trừ ${costLabel} ${fmtMoney(cost)}${provisional ? ' · tạm tính' : ''}`, total < cost ? 'neg' : '');
}

const RevenueView = {
  render() {
    const { mode, date } = UI.revenue;
    return toolbar('revenue', mode, date, ['day', 'month', 'year']) + this[mode](date);
  },

  day(date) {
    const entries = Store.inPeriod('entries', date).sort((a, b) => b.createdAt - a.createdAt);
    const total = sumBy(entries, e => e.amount);
    const missing = [!Store.services().length && 'dịch vụ', !Store.employees().length && 'nhân viên'].filter(Boolean);
    const hint = missing.length && can('manage')
      ? `<p class="hint">Chưa có ${missing.join(' và ')}. <button type="button" class="link" data-action="tab" data-tab="settings">Mở Cài đặt</button> để thêm trước khi nhập doanh thu.</p>`
      : '';
    const list = entries.map(e => `
      <li class="row tight">
        <div class="row-main">
          <strong>${esc(Store.svcName(e.serviceId))}</strong>
          <span class="sub">${e.employeeId
            ? `${esc(Store.empName(e.employeeId))} · hoa hồng ${e.pct}% = ${fmtMoney(Store.commissionOf(e))}`
            : 'Không gắn nhân viên'}${e.note ? ` · ${esc(e.note)}` : ''}</span>
        </div>
        <div class="row-side">
          <div class="row-amount">${fmtMoney(e.amount)}</div>
          <div class="row-actions">
            <button type="button" class="btn btn-sm" data-action="entry-edit" data-id="${e.id}">Sửa</button>
            <button type="button" class="btn btn-sm danger" data-action="entry-delete" data-id="${e.id}">Xóa</button>
          </div>
        </div>
      </li>`).join('');
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu ngày', fmtMoney(total), `${WEEKDAYS[weekdayOf(date)]} ${fmtDate(date)} · ${entries.length} lượt khách`)}
        ${netTile(total, sumBy(entries, Store.commissionOf), 'hoa hồng nhân viên')}
      </section>
      <section class="card">
        <h2>Thêm doanh thu</h2>
        ${hint}
        ${quickEntryForm(date)}
      </section>
      <section class="card">
        <h2>Chi tiết trong ngày</h2>
        ${entries.length ? `<ul class="rows">${list}</ul>` : '<p class="empty">Chưa có doanh thu nào trong ngày này.</p>'}
      </section>`;
  },

  month(date) {
    const { y, m } = parseYmd(date);
    const ym = date.slice(0, 7);
    const entries = Store.inPeriod('entries', ym);
    const total = sumBy(entries, e => e.amount);
    const byDay = groupEntries(entries, e => e.date);
    const gotoDay = d => `data-action="goto" data-tab="revenue" data-mode="day" data-date="${d}"`;
    const bars = Array.from({ length: daysInMonth(y, m) }, (_, i) => {
      const d = ymd(y, m, i + 1);
      return {
        label: i === 0 || (i + 1) % 5 === 0 ? i + 1 : '',
        value: byDay.get(d)?.total ?? 0,
        tip: `${WEEKDAYS[weekdayOf(d)]} ${fmtDate(d)}`,
        attrs: gotoDay(d),
      };
    });
    const dayRows = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, g]) => ({
      cells: [`${WEEKDAYS[weekdayOf(d)]} ${fmtDate(d)}`, g.count, fmtMoney(g.total)],
      attrs: `class="clickable" ${gotoDay(d)}`,
    }));
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu tháng', fmtMoney(total), `${fmtMonth(date)} · ${entries.length} lượt khách`)}
        ${netTile(total, staffPay(ym), 'lương nhân viên', ym === todayStr().slice(0, 7))}
        ${statTile('Trung bình mỗi ngày có khách', fmtMoney(byDay.size ? total / byDay.size : 0), `${byDay.size} ngày có doanh thu`)}
      </section>
      <section class="card">
        <h2>Doanh thu từng ngày</h2>
        ${barChart(bars)}
      </section>
      ${entries.length ? `
        <section class="card">
          <h2>Bảng doanh thu theo ngày</h2>
          ${table(['Ngày', 'Lượt', 'Doanh thu'], dayRows, ['Tổng', entries.length, fmtMoney(total)])}
        </section>
        ${breakdownCards(entries)}` : ''}`;
  },

  year(date) {
    const { y } = parseYmd(date);
    const entries = Store.inPeriod('entries', String(y));
    const total = sumBy(entries, e => e.amount);
    const byMonth = groupEntries(entries, e => e.date.slice(0, 7));
    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = `${y}-${pad2(i + 1)}`;
      return { m: i + 1, ym, g: byMonth.get(ym), pay: staffPay(ym), attrs: `data-action="goto" data-tab="revenue" data-mode="month" data-date="${ym}-01"` };
    });
    const payTotal = sumBy(months, x => x.pay);
    const bars = months.map(x => ({ label: `T${x.m}`, value: x.g?.total ?? 0, tip: fmtMonth(x.ym), attrs: x.attrs }));
    // Hai cột lương và thực nhận chỉ dành cho người xem được số liệu cả quán.
    const cols = can('seeShop') ? 5 : 3;
    const rows = months.map(x => ({
      cells: (x.g || x.pay
        ? [`Tháng ${x.m}`, x.g?.count ?? 0, fmtMoney(x.g?.total ?? 0), fmtMoney(x.pay), fmtMoney((x.g?.total ?? 0) - x.pay)]
        : [`Tháng ${x.m}`, '—', '—', '—', '—']).slice(0, cols),
      attrs: `class="clickable" ${x.attrs}`,
    }));
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu năm', fmtMoney(total), `Năm ${y} · ${entries.length} lượt khách`)}
        ${netTile(total, payTotal, 'lương nhân viên', y === new Date().getFullYear())}
        ${statTile('Trung bình mỗi tháng có khách', fmtMoney(byMonth.size ? total / byMonth.size : 0), `${byMonth.size} tháng có doanh thu`)}
      </section>
      <section class="card">
        <h2>Doanh thu từng tháng</h2>
        ${barChart(bars)}
      </section>
      <section class="card">
        <h2>Bảng doanh thu theo tháng</h2>
        ${table(['Tháng', 'Lượt', 'Doanh thu', 'Lương nhân viên', 'Thực nhận'].slice(0, cols), rows,
          ['Tổng', entries.length, fmtMoney(total), fmtMoney(payTotal), fmtMoney(total - payTotal)].slice(0, cols))}
      </section>
      ${entries.length ? breakdownCards(entries) : ''}`;
  },
};

Submits['entry-add'] = form => {
  const f = form.elements;
  if (can('seeShop') && !f.employeeId.value) {
    toast('Hãy bấm chọn nhân viên làm (hoặc "Không gắn nhân viên")', true);
    return;
  }
  if (!f.serviceId.value) {
    toast('Hãy bấm chọn dịch vụ (hoặc "Khác")', true);
    return;
  }
  const data = readEntryForm(form);
  if (!data) return;
  Store.add('entries', { ...data, date: UI.revenue.date });
  // Mỗi lượt khách chọn lại từ đầu để không ghi nhầm cho người vừa chọn trước đó.
  quick.serviceId = '';
  if (can('seeShop')) quick.employeeId = '';
  quick.filter = '';
  toast(`Đã thêm ${fmtMoney(data.amount)}`);
  render();
};

Actions['entry-edit'] = el => {
  const entry = Store.get('entries', el.dataset.id);
  openModal({
    title: 'Sửa doanh thu',
    body: `<div class="form-grid">
      ${field('Ngày', `<input type="date" name="date" required value="${entry.date}">`, 'wide')}
      ${entryFields(entry)}
    </div>`,
    onSubmit: form => {
      const data = readEntryForm(form);
      if (!data) return false;
      Store.update('entries', entry.id, { ...data, date: form.elements.date.value });
      render();
    },
  });
};

Actions['entry-delete'] = async el => {
  const entry = Store.get('entries', el.dataset.id);
  if (!(await confirmBox(`Xóa khoản doanh thu ${fmtMoney(entry.amount)} (${Store.svcName(entry.serviceId)})?`))) return;
  Store.remove('entries', entry.id);
  render();
};
