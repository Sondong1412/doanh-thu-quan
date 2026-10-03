// Tab "Doanh thu quán": nhập doanh thu hàng ngày, tổng hợp theo ngày / tháng / năm.

// Các khoản khách trả chung một lần mang cùng mã hóa đơn; khoản lẻ tự là một hóa đơn.
const billKey = e => e.billId ?? e.id;
const customerCount = entries => new Set(entries.map(billKey)).size;

// Gom nhóm doanh thu theo khóa -> Map(key => { count, total, entries }); count là số dịch vụ đã làm.
function groupEntries(entries, keyFn) {
  const groups = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    const g = groups.get(key) ?? { count: 0, total: 0, entries: [] };
    g.count++;
    g.total += e.amount;
    g.entries.push(e);
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
// `lines` là các dịch vụ đã thêm vào hóa đơn đang nhập mà chưa lưu.
const quick = { employeeId: '', serviceId: '', filter: '', lines: [] };
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
      ${pendingBill()}
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
            ${moneyInput('amount', Store.service(serviceId)?.price)}
            ${shorthand() ? '' : '<button type="button" class="btn" data-action="quick-000" title="Thêm ba số 0">000</button>'}
          </div>
          <div class="chips" data-suggest>${suggestionChips(serviceId)}</div>
        </div>
        ${field('% hoa hồng', `<input type="number" name="pct" min="0" max="100" step="any" value="${employeeId ? Store.rateFor(employeeId, serviceId) : 0}"${shopWide ? '' : ' readonly'}>`)}
        ${field('Ghi chú', '<input type="text" name="note" autocomplete="off">')}
        <div class="form-actions">
          <button type="button" class="btn" data-action="bill-add" title="Khách này còn dịch vụ khác: thêm dòng này vào hóa đơn rồi nhập dòng tiếp theo">+ Dịch vụ khác cùng khách</button>
          <button type="submit" class="btn btn-primary">${quick.lines.length ? 'Lưu hóa đơn' : 'Thêm doanh thu'}</button>
        </div>
      </div>
    </form>`;
}

// Hóa đơn đang nhập dở: các dịch vụ đã thêm và tổng tiền khách phải trả.
function pendingBill() {
  if (!quick.lines.length) return '';
  const rows = quick.lines.map((line, i) => `
    <li class="row tight">
      <div class="row-main">
        <strong>${esc(Store.svcName(line.serviceId))}</strong>
        <span class="sub">${line.employeeId ? esc(Store.empName(line.employeeId)) : 'Không gắn nhân viên'}${line.note ? ` · ${esc(line.note)}` : ''}</span>
      </div>
      <div class="row-side">
        <div class="row-amount">${fmtMoney(line.amount)}</div>
        <div class="row-actions"><button type="button" class="btn btn-sm danger" data-action="bill-remove" data-index="${i}">Bỏ</button></div>
      </div>
    </li>`).join('');
  return `
    <div class="bill">
      <div class="card-head">
        <h3>Hóa đơn đang nhập · ${quick.lines.length} dịch vụ</h3>
        <button type="button" class="link" data-action="bill-clear">Hủy hóa đơn</button>
      </div>
      <ul class="rows">${rows}</ul>
      <p class="bill-total">Khách trả <strong>${fmtMoney(sumBy(quick.lines, l => l.amount))}</strong></p>
      <p class="hint">Chọn tiếp dịch vụ bên dưới rồi bấm "Lưu hóa đơn", hoặc bấm "Lưu hóa đơn" ngay nếu đã đủ.</p>
    </div>`;
}

// Đọc dòng đang chọn trong form nhập nhanh; thiếu gì thì báo và trả về null.
function readQuickLine(form) {
  const f = form.elements;
  if (can('seeShop') && !f.employeeId.value) {
    toast('Hãy bấm chọn nhân viên làm (hoặc "Không gắn nhân viên")', true);
    return null;
  }
  if (!f.serviceId.value) {
    toast('Hãy bấm chọn dịch vụ (hoặc "Khác")', true);
    return null;
  }
  return readEntryForm(form);
}

// Mỗi dòng chọn lại từ đầu để không ghi nhầm cho người vừa chọn trước đó.
function resetQuickPick() {
  quick.serviceId = '';
  if (can('seeShop')) quick.employeeId = '';
  quick.filter = '';
}

Actions['bill-add'] = el => {
  const line = readQuickLine(el.form);
  if (!line) return;
  quick.lines.push(line);
  resetQuickPick();
  render();
};

Actions['bill-remove'] = el => {
  quick.lines.splice(Number(el.dataset.index), 1);
  render(true);
};

Actions['bill-clear'] = () => {
  quick.lines = [];
  render(true);
};

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
      ${table(['Dịch vụ', 'Lượt làm', 'Doanh thu'], rowsOf(e => e.serviceId, Store.svcName))}
    </section>
    ${can('seeShop') ? `
      <section class="card">
        <h2>Theo nhân viên</h2>
        ${table(['Nhân viên', 'Lượt làm', 'Doanh thu'], rowsOf(e => e.employeeId, id => (id ? Store.empName(id) : 'Không gắn nhân viên')))}
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
    const entryRow = e => `
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
      </li>`;
    // Hóa đơn nhiều dịch vụ hiện thành một nhóm có tổng tiền; trong nhóm giữ thứ tự nhập.
    const list = [...groupEntries(entries, billKey).values()].map(bill => (bill.count === 1 ? entryRow(bill.entries[0]) : `
      <li class="bill-group">
        <div class="bill-head"><strong>Hóa đơn ${bill.count} dịch vụ</strong><span class="row-amount">${fmtMoney(bill.total)}</span></div>
        <ul class="rows">${bill.entries.sort((a, b) => a.createdAt - b.createdAt).map(entryRow).join('')}</ul>
      </li>`)).join('');
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu ngày', fmtMoney(total), `${WEEKDAYS[weekdayOf(date)]} ${fmtDate(date)} · ${customerCount(entries)} lượt khách`)}
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
      cells: [`${WEEKDAYS[weekdayOf(d)]} ${fmtDate(d)}`, customerCount(g.entries), fmtMoney(g.total)],
      attrs: `class="clickable" ${gotoDay(d)}`,
    }));
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu tháng', fmtMoney(total), `${fmtMonth(date)} · ${customerCount(entries)} lượt khách`)}
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
          ${table(['Ngày', 'Lượt khách', 'Doanh thu'], dayRows, ['Tổng', customerCount(entries), fmtMoney(total)])}
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
        ? [`Tháng ${x.m}`, customerCount(x.g?.entries ?? []), fmtMoney(x.g?.total ?? 0), fmtMoney(x.pay), fmtMoney((x.g?.total ?? 0) - x.pay)]
        : [`Tháng ${x.m}`, '—', '—', '—', '—']).slice(0, cols),
      attrs: `class="clickable" ${x.attrs}`,
    }));
    return `
      <section class="stats">
        ${statTile('Tổng doanh thu năm', fmtMoney(total), `Năm ${y} · ${customerCount(entries)} lượt khách`)}
        ${netTile(total, payTotal, 'lương nhân viên', y === new Date().getFullYear())}
        ${statTile('Trung bình mỗi tháng có khách', fmtMoney(byMonth.size ? total / byMonth.size : 0), `${byMonth.size} tháng có doanh thu`)}
      </section>
      <section class="card">
        <h2>Doanh thu từng tháng</h2>
        ${barChart(bars)}
      </section>
      <section class="card">
        <h2>Bảng doanh thu theo tháng</h2>
        ${table(['Tháng', 'Lượt khách', 'Doanh thu', 'Lương nhân viên', 'Thực nhận'].slice(0, cols), rows,
          ['Tổng', customerCount(entries), fmtMoney(total), fmtMoney(payTotal), fmtMoney(total - payTotal)].slice(0, cols))}
      </section>
      ${entries.length ? breakdownCards(entries) : ''}`;
  },
};

Submits['entry-add'] = form => {
  const f = form.elements;
  // Đang có hóa đơn dở mà form bên dưới để trống: lưu các dòng đã thêm. Ngược lại dòng đang chọn là dòng cuối của hóa đơn.
  const blank = !f.serviceId.value && !f.amount.value;
  const lines = [...quick.lines];
  if (!lines.length || !blank) {
    const line = readQuickLine(form);
    if (!line) return;
    lines.push(line);
  }
  Store.addBill(lines.map(line => ({ ...line, date: UI.revenue.date })));
  quick.lines = [];
  resetQuickPick();
  const total = fmtMoney(sumBy(lines, l => l.amount));
  toast(lines.length > 1 ? `Đã lưu hóa đơn ${lines.length} dịch vụ, ${total}` : `Đã thêm ${total}`);
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
