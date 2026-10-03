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

function entryFields(e = {}) {
  return `
    ${field('Dịch vụ', `<select name="serviceId" data-change="entry-sync">${selectOptions(Store.pick('services', e.serviceId), e.serviceId, 'Khác')}</select>`)}
    ${field('Nhân viên làm', `<select name="employeeId" data-change="entry-sync">${selectOptions(Store.pick('employees', e.employeeId), e.employeeId, 'Không có (doanh thu quán)')}</select>`)}
    ${field('Số tiền thu của khách (₫)', `<input type="text" inputmode="numeric" class="money" name="amount" required autocomplete="off" value="${e.amount ? fmtNum(e.amount) : ''}">`)}
    ${field('% hoa hồng nhân viên', `<input type="number" name="pct" min="0" max="100" step="any" value="${e.pct ?? 0}">`)}
    ${field('Ghi chú', `<input type="text" name="note" autocomplete="off" value="${esc(e.note)}">`, 'wide')}`;
}

function readEntryForm(form) {
  const f = form.elements;
  const amount = parseMoney(f.amount.value);
  if (!amount) {
    toast('Hãy nhập số tiền', true);
    return null;
  }
  return {
    serviceId: f.serviceId.value || null,
    employeeId: f.employeeId.value || null,
    amount,
    pct: clampPct(f.pct.value),
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
    <section class="card">
      <h2>Theo nhân viên</h2>
      ${table(['Nhân viên', 'Lượt', 'Doanh thu'], rowsOf(e => e.employeeId, id => (id ? Store.empName(id) : 'Không gắn nhân viên')))}
    </section>`;
}

// Tổng lương phải trả nhân viên trong tháng (mức cao hơn giữa lương cứng và hoa hồng của từng người).
const staffPay = ym => sumBy(Store.payroll(ym), r => r.gross);

// Ô "Doanh thu thực nhận" đặt cạnh ô tổng doanh thu: doanh thu trừ phần trả cho nhân viên.
function netTile(total, cost, costLabel, provisional = false) {
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
    const hint = missing.length
      ? `<p class="hint">Chưa có ${missing.join(' và ')}. <button type="button" class="link" data-action="tab" data-tab="settings">Mở Cài đặt</button> để thêm trước khi nhập doanh thu.</p>`
      : '';
    const list = entries.map(e => `
      <li class="row">
        <div class="row-main">
          <strong>${esc(Store.svcName(e.serviceId))}</strong>
          <span class="sub">${e.employeeId
            ? `${esc(Store.empName(e.employeeId))} · hoa hồng ${e.pct}% = ${fmtMoney(Store.commissionOf(e))}`
            : 'Không gắn nhân viên'}${e.note ? ` · ${esc(e.note)}` : ''}</span>
        </div>
        <div class="row-amount">${fmtMoney(e.amount)}</div>
        <div class="row-actions">
          <button type="button" class="btn btn-sm" data-action="entry-edit" data-id="${e.id}">Sửa</button>
          <button type="button" class="btn btn-sm danger" data-action="entry-delete" data-id="${e.id}">Xóa</button>
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
        <form class="form-grid" data-submit="entry-add">
          ${entryFields()}
          <div class="form-actions"><button type="submit" class="btn btn-primary">Thêm doanh thu</button></div>
        </form>
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
    const rows = months.map(x => ({
      cells: x.g || x.pay
        ? [`Tháng ${x.m}`, x.g?.count ?? 0, fmtMoney(x.g?.total ?? 0), fmtMoney(x.pay), fmtMoney((x.g?.total ?? 0) - x.pay)]
        : [`Tháng ${x.m}`, '—', '—', '—', '—'],
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
        ${table(['Tháng', 'Lượt', 'Doanh thu', 'Lương nhân viên', 'Thực nhận'], rows,
          ['Tổng', entries.length, fmtMoney(total), fmtMoney(payTotal), fmtMoney(total - payTotal)])}
      </section>
      ${entries.length ? breakdownCards(entries) : ''}`;
  },
};

// Chọn dịch vụ / nhân viên thì tự điền giá và % hoa hồng tương ứng.
Changes['entry-sync'] = el => {
  const f = el.form.elements;
  const svc = Store.service(f.serviceId.value);
  if (el.name === 'serviceId' && svc?.price) f.amount.value = fmtNum(svc.price);
  f.pct.value = f.employeeId.value ? Store.rateFor(f.employeeId.value, f.serviceId.value) : 0;
};

Submits['entry-add'] = form => {
  const data = readEntryForm(form);
  if (!data) return;
  Store.add('entries', { ...data, date: UI.revenue.date });
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
