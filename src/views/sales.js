import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, confirmDialog, promptDialog, empty, badge, statTile } from '../ui/components.js';
import {
  ORDER_STATUS, PAYMENT_KIND, PAY_METHOD, PAYMENT_STATUS_LABEL, orderTotal, orderSubtotal, orderPaid, orderBalance, paymentStatus,
  debtSummary, planOrderSave, planOrderStatus, planPayment, planDeletePayment, canTransition, salesRevenue,
} from '../domain/sales.js';
import { penBalance } from '../domain/stock.js';
import { fmtDate, fmtDateTime } from '../core/dates.js';
import { fmtMoney, fmtMoneyShort, matches, toMoney, toInt } from '../core/format.js';
import { uid } from '../core/ids.js';

const ST_TONE = { draft: 'muted', confirmed: 'info', shipping: 'warn', completed: 'ok', cancelled: 'danger' };
const FILTERS = { open: ['Đang xử lý', (o) => ['draft', 'confirmed', 'shipping'].includes(o.status)], debt: ['Còn nợ', null], completed: ['Hoàn thành', (o) => o.status === 'completed'], cancelled: ['Đã huỷ', (o) => o.status === 'cancelled'], all: ['Tất cả', () => true] };

export function renderList(app, _p, query) {
  const s = app.store;
  const f = FILTERS[query.f] ? query.f : 'open';
  const fn = f === 'debt' ? (o) => orderBalance(o, s.db.payments) !== 0 : FILTERS[f][1];
  const list = s.db.orders.filter((o) => !o.deleted && fn(o) && matches(query.q || '', o.code, s.byId('customers', o.customer_id)?.name, o.note))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));
  const debt = debtSummary(s.db.orders, s.db.payments);
  const m = s.today().slice(0, 7);
  const canW = s.can('sales.write');
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Bán hàng</h1><div class="sub">Đơn hàng, thanh toán, công nợ</div></div>
        <a class="btn ghost sm" href="#/customers">${icon('users')} Khách</a>${canW ? html`<button class="btn primary sm" data-new>${icon('plus')} Đơn</button>` : ''}</div>
      <div class="stats">
        ${statTile('Doanh thu tháng này', fmtMoneyShort(salesRevenue(s.db.orders, `${m}-01`, `${m}-31`)), { tone: 'green', sub: 'đơn đã chốt' })}
        ${statTile('Công nợ phải thu', fmtMoneyShort(debt.receivable), { tone: 'gold', sub: `${debt.count} đơn`, href: '#/sales?f=debt' })}
        ${statTile('Cần hoàn khách', fmtMoneyShort(debt.refundDue), { tone: debt.refundDue ? 'red' : '', href: '#/sales?f=debt' })}
        ${statTile('Đơn chờ giao', s.db.orders.filter((o) => o.status === 'confirmed').length, { href: '#/sales?f=open' })}
      </div>
      <div class="chips" style="margin-top:12px">${Object.entries(FILTERS).map(([k, [l]]) => html`<a class="chip ${k === f ? 'active' : ''}" href="#/sales?f=${k}">${l}</a>`)}</div>
      <div class="card">${list.length ? html`<div class="list">${list.map((o) => orderRow(s, o))}</div>` : empty('Không có đơn hàng.')}</div>`,
    mount(root) { root.querySelector('[data-new]')?.addEventListener('click', () => openOrderForm(app, null)); },
  };
}

function orderRow(s, o) {
  const c = s.byId('customers', o.customer_id);
  const bal = orderBalance(o, s.db.payments);
  return html`<a class="row" href="#/order/${o.id}"><span class="row-icon">${icon('cart')}</span>
    <span class="grow"><span class="title">${o.code}</span> ${badge(ORDER_STATUS[o.status], ST_TONE[o.status])}<br>
    <span class="desc">${fmtDate(o.date)} · ${c?.name || '?'} · ${o.items.reduce((a, i) => a + i.qty, 0)} con/sp</span></span>
    <span class="right"><b>${fmtMoneyShort(orderTotal(o))}</b><br>${bal > 0 ? html`<span class="small money-out">nợ ${fmtMoneyShort(bal)}</span>` : bal < 0 ? html`<span class="small money-out">hoàn ${fmtMoneyShort(-bal)}</span>` : html`<span class="small muted">${PAYMENT_STATUS_LABEL[paymentStatus(o, s.db.payments)]}</span>`}</span></a>`;
}

function itemLabel(s, it) {
  if (it.kind === 'pen') return `${s.byId('flight_pens', it.pen_id)?.name || 'Lồng phóng'}${it.description ? ` — ${it.description}` : ''}`;
  if (it.kind === 'breeder') return `Chim giống ${s.byId('birds', it.bird_id)?.ring_code || '?'}${it.description ? ` — ${it.description}` : ''}`;
  return it.description || 'Sản phẩm khác';
}

export function renderOrder(app, { id }) {
  const s = app.store;
  const o = s.byId('orders', id);
  if (!o) return { html: empty('Không tìm thấy đơn.') };
  const c = s.byId('customers', o.customer_id);
  const pays = s.db.payments.filter((p) => p.order_id === id && !p.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const bal = orderBalance(o, s.db.payments);
  const canW = s.can('sales.write');
  const next = ['confirmed', 'shipping', 'completed', 'draft'].filter((t) => canTransition(o.status, t));
  const NEXT_LABEL = { confirmed: 'Chốt đơn (trừ tồn)', shipping: 'Bắt đầu giao', completed: 'Hoàn thành', draft: 'Đưa về nháp (hoàn tồn)' };
  return {
    html: html`<div class="page-head"><a class="back" href="#/sales">${icon('back')}</a><div class="grow"><h1>Đơn ${o.code}</h1><div class="sub">${fmtDate(o.date)} · ${ORDER_STATUS[o.status]}</div></div>
        ${canW && o.status !== 'cancelled' ? html`<button class="btn soft sm" data-edit>${icon('edit')} Sửa</button>` : ''}</div>
      <div class="card"><dl class="kv"><dt>Khách hàng</dt><dd>${c?.name || '?'}${c?.phone ? ` · ${c.phone}` : ''}${c?.province ? ` · ${c.province}` : ''}</dd>
        <dt>Trạng thái đơn</dt><dd>${badge(ORDER_STATUS[o.status], ST_TONE[o.status])}</dd>
        <dt>Thanh toán</dt><dd>${badge(PAYMENT_STATUS_LABEL[paymentStatus(o, s.db.payments)], bal > 0 ? 'warn' : bal < 0 ? 'danger' : 'ok')}</dd>
        ${o.status === 'cancelled' ? html`<dt>Lý do huỷ</dt><dd>${o.cancel_reason || '—'}</dd>` : ''}</dl></div>
      <div class="section"><h2>Hàng</h2></div>
      <div class="card"><table class="table"><thead><tr><th>Mô tả</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr></thead><tbody>
        ${o.items.map((it) => html`<tr><td>${itemLabel(s, it)}</td><td class="r">${it.qty}</td><td class="r">${fmtMoney(it.unit_price)}</td><td class="r">${fmtMoney(it.qty * it.unit_price)}</td></tr>`)}
        <tr><td colspan="3">Tạm tính</td><td class="r">${fmtMoney(orderSubtotal(o))}</td></tr>
        ${o.shipping?.fee_charged ? html`<tr><td colspan="3">Phí vận chuyển thu khách</td><td class="r">${fmtMoney(o.shipping.fee_charged)}</td></tr>` : ''}
        ${o.discount ? html`<tr><td colspan="3">Giảm giá</td><td class="r">−${fmtMoney(o.discount)}</td></tr>` : ''}
        <tr><td colspan="3"><b>Tổng đơn</b></td><td class="r"><b>${fmtMoney(orderTotal(o))}</b></td></tr>
        <tr><td colspan="3">Đã thu (sau hoàn)</td><td class="r">${fmtMoney(orderPaid(s.db.payments, id))}</td></tr>
        <tr><td colspan="3"><b>${bal >= 0 ? 'Còn nợ' : 'Cần hoàn khách'}</b></td><td class="r"><b class="${bal ? 'money-out' : ''}">${fmtMoney(Math.abs(bal))}</b></td></tr>
      </tbody></table>
      ${o.status === 'draft' ? html`<p class="def">Đơn nháp chưa trừ tồn lồng phóng. Tồn chỉ bị trừ 1 lần khi chốt đơn; huỷ đơn sẽ hoàn tồn.</p>` : ''}</div>
      ${canW && o.status !== 'cancelled' ? html`<div class="btn-row" style="margin-top:12px">${next.map((t) => html`<button class="btn ${t === 'draft' ? 'ghost' : 'primary'}" data-status="${t}">${NEXT_LABEL[t]}</button>`)}</div>
        <div class="btn-row" style="margin-top:8px"><button class="btn danger" data-cancel>${icon('x')} Huỷ đơn</button></div>` : ''}
      <div class="section"><h2>Vận chuyển</h2></div>
      <div class="card"><dl class="kv"><dt>Nhà xe / đơn vị</dt><dd>${o.shipping?.carrier || '—'}</dd><dt>SĐT tài xế</dt><dd>${o.shipping?.driver_phone || '—'}</dd>
        <dt>Ngày gửi</dt><dd>${o.shipping?.ship_date ? fmtDate(o.shipping.ship_date) : '—'}</dd><dt>Ghi chú</dt><dd>${o.shipping?.note || '—'}</dd></dl></div>
      <div class="section"><h2>Thanh toán</h2>${canW ? html`<button class="btn soft sm" data-pay>${icon('plus')} Ghi nhận</button>` : ''}</div>
      <div class="card">${pays.length ? html`<div class="list">${pays.map((p) => html`<div class="row"><span class="row-icon ${p.kind === 'refund' ? 'red' : 'green'}">${icon(p.kind === 'refund' ? 'minus' : 'plus')}</span>
        <span class="grow"><span class="title">${PAYMENT_KIND[p.kind]}</span> · ${PAY_METHOD[p.method] || ''}<br><span class="desc">${fmtDate(p.date)}${p.note ? ` · ${p.note}` : ''}</span></span>
        <span class="right"><b class="${p.kind === 'refund' ? 'money-out' : 'money-in'}">${p.kind === 'refund' ? '−' : '+'}${fmtMoney(p.amount)}</b>
        ${canW ? html`<br><button class="btn ghost sm" data-delpay="${p.id}">${icon('trash')}</button>` : ''}</span></div>`)}</div>` : empty('Chưa có thanh toán.')}
        <p class="def">Mỗi khoản thanh toán tự sinh đúng 1 giao dịch trong Tài chính (không nhập lại tay để tránh cộng trùng).</p></div>
      ${o.note ? html`<div class="section"><h2>Ghi chú</h2></div><div class="card" style="white-space:pre-wrap">${o.note}</div>` : ''}
      <div class="section"><h2>Lịch sử thao tác</h2></div>
      <div class="card"><div class="list">${(o.history || []).slice().reverse().map((h) => html`<div class="row"><span class="grow"><span class="title">${h.action}</span><br><span class="desc">${fmtDateTime(h.at)}${h.detail ? ` · ${h.detail}` : ''}</span></span></div>`)}</div></div>`,
    mount(root) {
      root.querySelector('[data-edit]')?.addEventListener('click', () => openOrderForm(app, id));
      root.querySelector('[data-pay]')?.addEventListener('click', () => openPaymentForm(app, id));
      root.querySelector('[data-cancel]')?.addEventListener('click', async () => {
        const reason = await promptDialog('Huỷ đơn hàng', 'Lý do huỷ (bắt buộc)', { ok: 'Huỷ đơn' });
        if (!reason) return;
        const r = await s.run(planOrderStatus(s.db, id, 'cancelled', s.ctx(), reason), { requires: 'sales.write' });
        if (!r.ok) return toast(r.errors.join('; '), 'error');
        toast('Đã huỷ đơn và hoàn tồn');
        if (orderPaid(s.db.payments, id) > 0) toast('Đơn đã có thu tiền — hãy ghi nhận hoàn tiền cho khách', 'warn');
      });
      root.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-status]');
        if (st) {
          if (st.dataset.status === 'draft' && !(await confirmDialog('Đưa đơn về nháp? Số chim đã trừ sẽ được hoàn lại lồng phóng.'))) return;
          const r = await s.run(planOrderStatus(s.db, id, st.dataset.status, s.ctx()), { requires: 'sales.write' });
          toast(r.ok ? `Đơn: ${ORDER_STATUS[st.dataset.status]}` : r.errors.join('; '), r.ok ? 'ok' : 'error');
        }
        const dp = e.target.closest('[data-delpay]');
        if (dp) {
          if (!(await confirmDialog('Xoá khoản thanh toán này? Giao dịch tài chính tương ứng cũng bị xoá (xoá mềm).', { danger: true, ok: 'Xoá' }))) return;
          const r = await s.run(planDeletePayment(s.db, dp.dataset.delpay, s.ctx()), { requires: 'sales.write' });
          toast(r.ok ? 'Đã xoá thanh toán' : r.errors.join('; '), r.ok ? 'ok' : 'error');
        }
      });
    },
  };
}

function itemHtml(s, it, i) {
  const pens = s.db.flight_pens.filter((p) => !p.archived);
  const birds = s.db.birds.filter((b) => b.status === 'holding' || b.status === 'retired' || b.id === it.bird_id);
  return html`<div class="item-line" data-item data-id="${it.id || ''}">
    <div class="grid2">${field(`Dòng ${i + 1} — loại`, html`<select name="kind" data-kind>${options({ pen: 'Chim lồng phóng (theo số lượng)', breeder: 'Chim giống (theo cá thể)', other: 'Sản phẩm khác' }, it.kind || 'pen')}</select>`)}
      <div data-src>${srcHtml(s, it, pens, birds)}</div></div>
    ${field('Mô tả', html`<input name="description" value="${it.description || ''}" placeholder="VD: cặp phổ thông, chim tơ…">`)}
    <div class="grid2">${field('Số lượng', html`<input type="number" name="qty" min="1" inputmode="numeric" value="${it.qty || 1}">`)}
      ${field('Đơn giá (đ)', html`<input name="unit_price" inputmode="numeric" value="${it.unit_price || ''}">`)}</div>
    <button type="button" class="btn ghost sm" data-rmitem>${icon('trash')} Bỏ dòng</button></div>`;
}
function srcHtml(s, it, pens, birds) {
  if ((it.kind || 'pen') === 'pen') return field('Lồng phóng', html`<select name="pen_id">${options(Object.fromEntries(pens.map((p) => [p.id, `${p.name} (còn ${penBalance(s.db.stock_movements, p.id)})`])), it.pen_id)}</select>`);
  if (it.kind === 'breeder') return field('Cá thể', raw(`<select name="bird_id"><option value="">— Chọn —</option>${birds.map((b) => `<option value="${b.id}"${b.id === it.bird_id ? ' selected' : ''}>${esc(b.ring_code)} · ${esc(b.phenotype || '')}</option>`).join('')}</select>`));
  return html`<span></span>`;
}

export function openOrderForm(app, id, preset = {}) {
  const s = app.store;
  if (!s.can('sales.write')) { toast('Chỉ chủ trại được tạo/sửa đơn', 'error'); return; }
  const o = id ? s.byId('orders', id) : null;
  const items = o ? o.items : (preset.items || [{ kind: 'pen', qty: 1 }]);
  const pens = s.db.flight_pens.filter((p) => !p.archived);
  const custOpts = () => raw(`<option value="">— Chọn khách —</option>${s.db.customers.filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.id}"${c.id === o?.customer_id ? ' selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}`);
  openSheet({
    title: o ? `Sửa đơn ${o.code}` : 'Tạo đơn hàng', size: 'wide',
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Ngày đơn', html`<input type="date" name="date" value="${o?.date || s.today()}">`)}
        <div class="field"><span>Khách hàng</span><div style="display:flex;gap:6px"><select name="customer_id" data-cust style="flex:1">${custOpts()}</select><button type="button" class="btn soft sm" data-newcust>${icon('plus')}</button></div></div></div>
      <div data-items style="display:flex;flex-direction:column;gap:8px">${items.map((it, i) => itemHtml(s, it, i))}</div>
      <button type="button" class="btn soft" data-additem>${icon('plus')} Thêm dòng hàng</button>
      <fieldset class="fieldset"><legend>Vận chuyển</legend>
        <div class="grid2">${field('Nhà xe / đơn vị', html`<input name="carrier" value="${o?.shipping?.carrier || ''}">`)}${field('SĐT tài xế', html`<input name="driver_phone" inputmode="tel" value="${o?.shipping?.driver_phone || ''}">`)}</div>
        <div class="grid2">${field('Ngày gửi', html`<input type="date" name="ship_date" value="${o?.shipping?.ship_date || ''}">`)}${field('Phí ship thu khách (đ)', html`<input name="fee_charged" inputmode="numeric" value="${o?.shipping?.fee_charged || ''}">`)}</div>
        ${field('Ghi chú vận chuyển', html`<input name="ship_note" value="${o?.shipping?.note || ''}">`)}</fieldset>
      <div class="grid2">${field('Giảm giá (đ)', html`<input name="discount" inputmode="numeric" value="${o?.discount || ''}">`)}
        ${!o ? field('Trạng thái', html`<select name="status">${options({ draft: 'Nháp / báo giá', confirmed: 'Chốt luôn (trừ tồn)' }, 'draft')}</select>`) : html`<span></span>`}</div>
      ${field('Ghi chú đơn', html`<textarea name="note" rows="2">${o?.note || ''}</textarea>`)}
      <div class="delta-preview" data-total></div>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu đơn</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-f]');
      const read = () => {
        const v = formValues(f);
        const its = [...f.querySelectorAll('[data-item]')].map((row) => {
          const g = (n) => row.querySelector(`[name=${n}]`)?.value;
          return { id: row.dataset.id || undefined, kind: g('kind'), pen_id: g('pen_id') || null, bird_id: g('bird_id') || null, description: g('description').trim(), qty: toInt(g('qty'), 0), unit_price: toMoney(g('unit_price'), 0) };
        });
        return { ...v, items: its, discount: toMoney(v.discount, 0), shipping: { carrier: v.carrier, driver_phone: v.driver_phone, ship_date: v.ship_date || null, fee_charged: toMoney(v.fee_charged, 0), note: v.ship_note } };
      };
      const upd = () => { const x = read(); el.querySelector('[data-total]').textContent = `Tổng đơn: ${fmtMoney(orderTotal(x))}`; };
      f.addEventListener('input', upd); upd();
      f.addEventListener('change', (e) => {
        if (e.target.matches('[data-kind]')) {
          const row = e.target.closest('[data-item]');
          row.querySelector('[data-src]').innerHTML = String(srcHtml(s, { kind: e.target.value }, pens, s.db.birds.filter((b) => b.status === 'holding' || b.status === 'retired')));
        }
      });
      f.addEventListener('click', (e) => {
        if (e.target.closest('[data-rmitem]')) { e.target.closest('[data-item]').remove(); upd(); }
        if (e.target.closest('[data-additem]')) { f.querySelector('[data-items]').insertAdjacentHTML('beforeend', String(itemHtml(s, { kind: 'pen', qty: 1 }, f.querySelectorAll('[data-item]').length))); }
        if (e.target.closest('[data-newcust]')) openCustomerForm(app, null, (c) => { f.querySelector('[data-cust]').innerHTML = String(custOpts()); f.querySelector('[data-cust]').value = c.id; });
      });
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const x = read();
        const r = await s.run(planOrderSave(s.db, { ...x, id: o?.id }, s.ctx()), { requires: 'sales.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(o ? 'Đã cập nhật đơn' : `Đã tạo đơn ${r.record.code}`); close();
        app.navigate(`#/order/${r.record.id}`);
      }));
    },
  });
}

function openPaymentForm(app, orderId) {
  const s = app.store;
  const o = s.byId('orders', orderId);
  const bal = orderBalance(o, s.db.payments);
  const payId = uid(); // sinh trước => bấm Lưu 2 lần (mạng chập chờn) vẫn chỉ 1 bản ghi
  let ack = false;
  openSheet({
    title: `Thanh toán đơn ${o.code}`, subtitle: bal >= 0 ? `Còn nợ ${fmtMoney(bal)}` : `Cần hoàn ${fmtMoney(-bal)}`,
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Loại', html`<select name="kind">${options(o.status === 'cancelled' ? { refund: PAYMENT_KIND.refund } : o.status === 'draft' ? { deposit: PAYMENT_KIND.deposit } : PAYMENT_KIND, o.status === 'cancelled' ? 'refund' : o.status === 'draft' ? 'deposit' : 'payment')}</select>`)}
        ${field('Ngày', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}</div>
      <div class="grid2">${field('Số tiền (đ)', html`<input name="amount" inputmode="numeric" value="${Math.abs(bal) || ''}">`)}
        ${field('Hình thức', html`<select name="method">${options(PAY_METHOD, 'transfer')}</select>`)}</div>
      ${field('Ghi chú', html`<input name="note">`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      const plan = planPayment(s.db, { ...v, id: payId, order_id: orderId, amount: toMoney(v.amount, 0) }, s.ctx());
      if (!plan.errors.length && plan.warnings?.length && !ack) { ack = true; showMessages(el.querySelector('[data-msg]'), [], [...plan.warnings, 'Bấm Lưu lần nữa để xác nhận.']); return; }
      const r = await s.run(plan, { requires: 'sales.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã ghi nhận thanh toán'); close();
    })),
  });
}

export function renderCustomers(app, _p, query) {
  const s = app.store;
  const list = s.db.customers.filter((c) => !c.deleted && matches(query.q || '', c.name, c.phone, c.province)).sort((a, b) => a.name.localeCompare(b.name));
  return {
    html: html`<div class="page-head"><a class="back" href="#/sales">${icon('back')}</a><div class="grow"><h1>Khách hàng</h1></div>
        ${s.can('sales.write') ? html`<button class="btn primary sm" data-new>${icon('plus')} Khách</button>` : ''}</div>
      <div class="card">${list.length ? html`<div class="list">${list.map((c) => {
        const os = s.db.orders.filter((o) => o.customer_id === c.id && !o.deleted);
        const debt = os.reduce((a, o) => a + Math.max(0, orderBalance(o, s.db.payments)), 0);
        return html`<div class="row" data-c="${c.id}"><span class="row-icon">${icon('users')}</span><span class="grow"><span class="title">${c.name}</span><br>
          <span class="desc">${c.phone || '—'} · ${c.province || '—'} · ${os.length} đơn${debt ? ` · nợ ${fmtMoney(debt)}` : ''}</span></span>
          ${s.can('sales.write') ? html`<button class="btn ghost sm" data-edit="${c.id}">${icon('edit')}</button>` : ''}</div>`;
      })}</div>` : empty('Chưa có khách hàng.')}</div>`,
    mount(root) {
      root.querySelector('[data-new]')?.addEventListener('click', () => openCustomerForm(app, null));
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) openCustomerForm(app, b.dataset.edit); });
    },
  };
}

function openCustomerForm(app, id, onSaved) {
  const s = app.store;
  const c = id ? s.byId('customers', id) : null;
  openSheet({
    title: c ? 'Sửa khách hàng' : 'Thêm khách hàng', size: 'small',
    body: html`<form class="form" data-f>
      ${field('Tên khách', html`<input name="name" value="${c?.name || ''}">`)}
      <div class="grid2">${field('Điện thoại', html`<input name="phone" inputmode="tel" value="${c?.phone || ''}">`)}${field('Tỉnh/TP', html`<input name="province" value="${c?.province || ''}">`)}</div>
      ${field('Ghi chú', html`<textarea name="note" rows="2">${c?.note || ''}</textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      if (!v.name.trim()) return showMessages(el.querySelector('[data-msg]'), ['Nhập tên khách']);
      const now = new Date().toISOString();
      const rec = { ...(c || { id: uid(), created_at: now }), name: v.name.trim(), phone: v.phone.trim(), province: v.province.trim(), note: v.note.trim(), updated_at: now };
      const r = await s.run({ ops: [{ table: 'customers', op: 'put', record: rec, before: c }] }, { requires: 'sales.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã lưu khách hàng'); close(); onSaved?.(rec);
    })),
  });
}
