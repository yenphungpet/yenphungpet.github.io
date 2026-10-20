import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, confirmDialog, empty, badge, statTile } from '../ui/components.js';
import { filterTx, summarize, monthlySeries, yearlySeries, planTransaction, planDeleteTransaction, dataQualityFlags, toCSV, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../domain/finance.js';
import { debtSummary, salesRevenue } from '../domain/sales.js';
import { fmtDate } from '../core/dates.js';
import { fmtMoney, fmtMoneyShort, matches, toMoney } from '../core/format.js';

function rangeFor(q, today) {
  const y = today.slice(0, 4); const m = today.slice(0, 7);
  switch (q.p) {
    case 'all': return { label: 'Toàn thời gian', from: null, to: null };
    case 'year': return { label: `Năm ${q.y || y}`, from: `${q.y || y}-01-01`, to: `${q.y || y}-12-31` };
    case 'custom': return { label: 'Khoảng tuỳ chọn', from: q.from || null, to: q.to || null };
    case 'month':
    default: { const mm = q.m || m; return { label: `Tháng ${mm.slice(5)}/${mm.slice(0, 4)}`, from: `${mm}-01`, to: `${mm}-31` }; }
  }
}

export function render(app, _p, query) {
  const s = app.store;
  const today = s.today();
  const p = query.p || 'month';
  const r = rangeFor(query, today);
  const type = query.t || '';
  const txs = filterTx(s.db.transactions, { from: r.from, to: r.to, type: type || null })
    .filter((t) => matches(query.q || '', t.description, t.note, t.category))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));
  const sum = summarize(filterTx(s.db.transactions, { from: r.from, to: r.to }));
  const year = (r.from || today).slice(0, 4);
  const series = monthlySeries(s.db.transactions, year);
  const max = Math.max(1, ...series.map((x) => Math.max(x.income, x.expense)));
  const debt = debtSummary(s.db.orders, s.db.payments);
  const revenue = salesRevenue(s.db.orders, r.from, r.to);
  const cats = Object.entries(sum.byCategory).sort((a, b) => b[1] - a[1]);
  const years = yearlySeries(s.db.transactions);
  const canW = s.can('finance.write');
  const linkedTx = new Set((s.db.inventory_movements || []).filter((m) => m.transaction_id && m.finance_mode === 'linked' && !m.deleted).map((m) => m.transaction_id));
  const qs = (o) => `#/finance?${new URLSearchParams({ p, ...(query.m ? { m: query.m } : {}), ...(query.y ? { y: query.y } : {}), ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}), ...(type ? { t: type } : {}), ...o })}`;
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Tài chính</h1><div class="sub">${r.label}</div></div>
        ${canW ? html`<button class="btn primary sm" data-new>${icon('plus')} Thu / Chi</button>` : ''}</div>
      <div class="chips">
        ${[['month', 'Theo tháng'], ['year', 'Theo năm'], ['all', 'Toàn thời gian'], ['custom', 'Khoảng ngày']].map(([k, l]) => html`<a class="chip ${k === p ? 'active' : ''}" href="#/finance?p=${k}">${l}</a>`)}
      </div>
      <form class="card flat" data-range style="margin-bottom:12px">
        ${p === 'month' ? field('Chọn tháng', html`<input type="month" name="m" value="${query.m || today.slice(0, 7)}">`) : ''}
        ${p === 'year' ? field('Chọn năm', html`<input type="number" name="y" value="${query.y || today.slice(0, 4)}" min="2020" max="2100" inputmode="numeric">`) : ''}
        ${p === 'custom' ? html`<div class="grid2">${field('Từ ngày', html`<input type="date" name="from" value="${query.from || ''}">`)}${field('Đến ngày', html`<input type="date" name="to" value="${query.to || ''}">`)}</div>` : ''}
        ${p !== 'all' ? html`<button class="btn soft sm" type="submit" style="margin-top:8px">Áp dụng</button>` : html`<span class="small muted">Toàn bộ giao dịch đã ghi, gồm dữ liệu cũ.</span>`}
      </form>
      <div class="stats">
        ${statTile('Tổng thu', fmtMoneyShort(sum.income), { tone: 'green', sub: 'dòng tiền vào' })}
        ${statTile('Tổng chi', fmtMoneyShort(sum.expense), { tone: 'red', sub: 'dòng tiền ra' })}
        ${statTile('Chênh lệch thu − chi', fmtMoneyShort(sum.diff), { sub: 'KHÔNG phải lợi nhuận ròng' })}
        ${statTile('Doanh thu bán hàng', fmtMoneyShort(revenue), { tone: 'gold', sub: 'giá trị đơn đã chốt', href: '#/sales' })}
      </div>
      <p class="def">Chênh lệch thu − chi chỉ phản ánh dòng tiền đã ghi nhận. Chưa đủ dữ liệu giá vốn (chim giống, khấu hao lồng, công lao động…) nên không gọi là lợi nhuận ròng. Công nợ phải thu hiện tại: <b>${fmtMoney(debt.receivable)}</b> (${debt.count} đơn)${debt.refundDue ? `, cần hoàn khách ${fmtMoney(debt.refundDue)}` : ''}.</p>

      <div class="section"><h2>Thu chi theo tháng · ${year}</h2></div>
      <div class="card">
        <div class="bars" role="img" aria-label="Biểu đồ thu chi theo tháng năm ${year}">${series.map((x) => html`<div class="bar-col">
          <div class="bar-pair" title="${`Tháng ${x.month.slice(5)}: Thu ${fmtMoney(x.income)} · Chi ${fmtMoney(x.expense)}`}">
            <div class="bar in" style="height:${(x.income / max) * 100}%"></div><div class="bar out" style="height:${(x.expense / max) * 100}%"></div></div>
          <small>${Number(x.month.slice(5))}</small></div>`)}</div>
        <div class="legend"><span><i style="background:#0E948A"></i>Thu</span><span><i style="background:#C0841A"></i>Chi</span><span class="muted">Chạm/di chuột vào cột để xem số</span></div>
        <div class="scroll-x" style="margin-top:10px"><table class="table"><thead><tr><th>Tháng</th><th class="r">Thu</th><th class="r">Chi</th><th class="r">Chênh lệch</th></tr></thead>
          <tbody>${series.filter((x) => x.income || x.expense).map((x) => html`<tr><td>${x.month.slice(5)}/${x.month.slice(0, 4)}</td><td class="r">${fmtMoney(x.income)}</td><td class="r">${fmtMoney(x.expense)}</td><td class="r">${fmtMoney(x.diff)}</td></tr>`)}</tbody></table></div>
      </div>

      ${years.length ? html`<div class="section"><h2>Theo năm</h2></div><div class="card scroll-x"><table class="table"><thead><tr><th>Năm</th><th class="r">Thu</th><th class="r">Chi</th><th class="r">Chênh lệch</th></tr></thead>
        <tbody>${years.map((x) => html`<tr><td><a href="#/finance?p=year&y=${x.year}">${x.year}</a></td><td class="r">${fmtMoney(x.income)}</td><td class="r">${fmtMoney(x.expense)}</td><td class="r">${fmtMoney(x.diff)}</td></tr>`)}</tbody></table></div>` : ''}

      <div class="section"><h2>Theo danh mục</h2></div>
      <div class="card">${cats.length ? html`<div class="list">${cats.map(([k, v]) => { const [t, c] = k.split('|'); return html`<div class="row"><span class="grow">${c} ${badge(t === 'income' ? 'Thu' : 'Chi', t === 'income' ? 'ok' : 'warn')}</span><span class="right ${t === 'income' ? 'money-in' : 'money-out'}">${fmtMoney(v)}</span></div>`; })}</div>` : empty('Không có giao dịch.')}</div>

      <div class="section"><h2>Giao dịch (${txs.length})</h2><button class="btn ghost sm" data-csv>${icon('download')} Xuất CSV</button></div>
      <div class="chips">${[['', 'Tất cả'], ['income', 'Thu'], ['expense', 'Chi']].map(([k, l]) => html`<a class="chip ${k === type ? 'active' : ''}" href="${qs({ t: k })}">${l}</a>`)}</div>
      <div class="card">${txs.length ? html`<div class="list">${txs.map((t) => { const flags = dataQualityFlags(t); return html`<div class="row" data-tx="${t.id}">
        <span class="row-icon ${t.type === 'income' ? 'green' : 'gold'}">${icon(t.type === 'income' ? 'plus' : 'minus')}</span>
        <span class="grow"><span class="title">${t.description}</span><br><span class="desc">${fmtDate(t.date)} · ${t.category}${t.source === 'payment' ? ' · từ đơn hàng' : t.source === 'inventory' ? ' · từ phiếu nhập kho' : t.source === 'legacy' ? ' · dữ liệu cũ' : ''}${linkedTx.has(t.id) ? ' · đã liên kết phiếu nhập kho' : ''}${t.note ? ` · ${t.note}` : ''}</span>
          ${flags.length ? html`<br>${flags.map((f) => badge(f, 'warn'))}` : ''}</span>
        <span class="right"><span class="${t.type === 'income' ? 'money-in' : 'money-out'}">${t.type === 'income' ? '+' : '−'}${fmtMoney(t.amount)}</span>
          ${canW && t.source !== 'payment' && t.source !== 'inventory' ? html`<br><button class="btn ghost sm" data-edit="${t.id}">${icon('edit')}</button><button class="btn ghost sm" data-del="${t.id}">${icon('trash')}</button>` : ''}</span></div>`; })}</div>` : empty('Không có giao dịch trong khoảng này.')}</div>`,
    mount(root) {
      root.querySelector('[data-range]')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = formValues(e.target);
        app.navigate(`#/finance?${new URLSearchParams({ p, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)) })}`);
      });
      root.querySelector('[data-new]')?.addEventListener('click', () => openTxForm(app, null));
      root.querySelector('[data-csv]').addEventListener('click', () => {
        const csv = toCSV(txs, [
          { key: 'date', label: 'Ngày' }, { label: 'Loại', get: (t) => (t.type === 'income' ? 'Thu' : 'Chi') }, { key: 'category', label: 'Danh mục' },
          { key: 'description', label: 'Nội dung' }, { key: 'amount', label: 'Số tiền' }, { key: 'note', label: 'Ghi chú' }, { key: 'source', label: 'Nguồn' },
        ]);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `thu-chi_${(r.from || 'all')}_${(r.to || today)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      root.addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-edit]');
        if (ed) return openTxForm(app, ed.dataset.edit);
        const del = e.target.closest('[data-del]');
        if (del) {
          if (!(await confirmDialog('Xoá giao dịch này? (Xoá mềm, có lưu vết.)', { danger: true, ok: 'Xoá' }))) return;
          const rr = await s.run(planDeleteTransaction(s.db, del.dataset.del, s.ctx()), { requires: 'finance.write' });
          toast(rr.ok ? 'Đã xoá giao dịch' : rr.errors.join('; '), rr.ok ? 'ok' : 'error');
        }
      });
    },
  };
}

function openTxForm(app, id) {
  const s = app.store;
  const t = id ? s.byId('transactions', id) : null;
  const cats = (type) => options(type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES, t?.category);
  openSheet({
    title: t ? 'Sửa giao dịch' : 'Thêm thu / chi',
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Loại', html`<select name="type" data-type>${options({ expense: 'Chi', income: 'Thu' }, t?.type || 'expense')}</select>`)}
        ${field('Ngày', html`<input type="date" name="date" value="${t?.date || s.today()}" max="${s.today()}">`)}</div>
      ${field('Số tiền (đ)', html`<input name="amount" inputmode="numeric" value="${t?.amount || ''}" placeholder="VD: 150000">`)}
      ${field('Danh mục', html`<select name="category" data-cat>${cats(t?.type || 'expense')}</select>`)}
      ${field('Nội dung', html`<input name="description" value="${t?.description || ''}">`)}
      ${field('Ghi chú', html`<textarea name="note" rows="2">${t?.note || ''}</textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-type]').addEventListener('change', (e) => { el.querySelector('[data-cat]').innerHTML = String(cats(e.target.value)); });
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(el.querySelector('[data-f]'));
        const r = await s.run(planTransaction(s.db, { ...v, id: t?.id, amount: toMoney(v.amount, 0) }, s.ctx()), { requires: 'finance.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu giao dịch'); close();
      }));
    },
  });
}
