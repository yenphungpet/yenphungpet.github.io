import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { cageArt } from '../ui/brand.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, confirmDialog, empty, badge } from '../ui/components.js';
import { MOVEMENT_TYPES, penBalance, penLedger, planMovement, planDeleteMovement } from '../domain/stock.js';
import { currentPair, byCageCode } from '../domain/breeding.js';
import { fmtDate, fmtDateTime } from '../core/dates.js';
import { toInt } from '../core/format.js';
import { openDailyForm } from './breeding-forms.js';
import { openSelectBreeders } from './breeders.js';
import { openOrderForm } from './sales.js';

const ACTIONS = [
  ['in_breeding', 'Nhập từ lồng SS', 'plus', 'primary'],
  ['transfer', 'Chuyển lồng', 'swap', 'soft'],
  ['select', 'Tuyển làm giống', 'bird', 'gold'],
  ['sale', 'Bán', 'cart', 'soft'],
  ['loss', 'Hao hụt', 'minus', 'soft'],
  ['adjust', 'Kiểm đếm', 'clipboard', 'soft'],
];

function pens(store) { return store.db.flight_pens.filter((p) => !p.archived).sort((a, b) => (a.sort || 0) - (b.sort || 0)); }

export function render(app) {
  const s = app.store;
  const list = pens(s);
  const total = list.reduce((a, p) => a + penBalance(s.db.stock_movements, p.id), 0);
  const canW = s.can('stock.write');
  return {
    html: html`
      <div class="page-head"><div class="grow"><h1>Lồng phóng</h1><div class="sub">Quản lý theo số lượng · tổng ${total} con</div></div></div>
      ${list.map((p) => {
        const bal = penBalance(s.db.stock_movements, p.id);
        const last = penLedger(s.db.stock_movements, p.id).slice(0, 3);
        return html`<div class="card" data-pen="${p.id}">
          <div style="display:flex;align-items:center;gap:12px">${cageArt(56)}
            <div class="grow" style="flex:1"><div class="card-title" style="margin:0">${p.name}</div><div class="small muted">${p.purpose || ''}</div></div>
            <div style="text-align:right"><div class="stat-value">${bal}</div><div class="small muted">con hiện tại</div></div></div>
          ${canW ? html`<div class="pen-actions">
            ${ACTIONS.map(([k, l, ic, tone]) => (k === 'sale' && !s.can('sales.write')) ? '' : html`<button class="btn ${tone} sm" data-mv="${k}">${icon(ic)} ${l}</button>`)}</div>` : ''}
          <div class="section" style="margin-top:14px"><h2 style="font-size:14px">Biến động gần đây</h2><a href="#/pen/${p.id}">Toàn bộ lịch sử</a></div>
          ${last.length ? html`<div class="list">${last.map((m) => mvRow(s, m))}</div>` : html`<p class="small muted">Chưa có biến động.</p>`}
        </div>`;
      })}
      ${!list.length ? empty('Chưa có lồng phóng.', cageArt(72)) : ''}
      <p class="def">Mọi thay đổi số lượng đều là một dòng trong sổ biến động (có ngày, loại, người ghi). Hệ thống chặn mọi thao tác làm âm tồn tại bất kỳ thời điểm nào. Không yêu cầu mã cá thể cho chim thương mại.</p>`,
    mount(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mv]');
        if (!b) return;
        const penId = b.closest('[data-pen]').dataset.pen;
        const k = b.dataset.mv;
        if (k === 'select') openSelectBreeders(app, penId);
        else if (k === 'sale') openOrderForm(app, null, { items: [{ kind: 'pen', pen_id: penId, qty: 1, unit_price: 0 }] });
        else openMovementForm(app, { type: k === 'adjust' ? 'adjust_out' : k, penId });
      });
    },
  };
}

export function mvRow(s, m) {
  const t = MOVEMENT_TYPES[m.type]?.label || m.type;
  const from = m.from_pen_id ? s.byId('flight_pens', m.from_pen_id)?.name : null;
  const to = m.to_pen_id ? s.byId('flight_pens', m.to_pen_id)?.name : null;
  const src = m.source_cage_id ? s.byId('cages', m.source_cage_id)?.code : null;
  const order = m.order_id ? s.byId('orders', m.order_id) : null;
  return html`<div class="row"><span class="row-icon ${m.delta < 0 ? 'gold' : 'green'}">${icon(m.delta < 0 ? 'minus' : 'plus')}</span>
    <span class="grow"><span class="title">${t}</span> <span class="desc">· ${fmtDate(m.date)}</span><br>
    <span class="desc">${from ? `Từ ${from}` : ''}${from && to ? ' → ' : ''}${to ? `Đến ${to}` : ''}${src ? ` · Lồng SS ${src}` : ''}${order ? raw(` · <a href="#/order/${esc(order.id)}">Đơn ${esc(order.code)}</a>`) : ''}${m.note && !order ? ` · ${m.note}` : ''}</span></span>
    <span class="right"><b class="${m.delta < 0 ? 'money-out' : 'money-in'}">${m.delta > 0 ? '+' : ''}${m.delta ?? ''}</b>${m.balance !== undefined ? html`<br><span class="small muted">còn ${m.balance}</span>` : ''}</span></div>`;
}

export function renderLedger(app, { id }) {
  const s = app.store;
  const p = s.byId('flight_pens', id);
  if (!p) return { html: empty('Không tìm thấy lồng phóng.') };
  const rows = penLedger(s.db.stock_movements, id);
  const canOwner = s.can('delete');
  return {
    html: html`<div class="page-head"><a class="back" href="#/pens">${icon('back')}</a><div class="grow"><h1>${p.name}</h1><div class="sub">${p.purpose} · hiện tại ${penBalance(s.db.stock_movements, id)} con</div></div></div>
      <div class="card">${rows.length ? html`<div class="list">${rows.map((m) => html`<div>${mvRow(s, m)}
        <div class="small muted" style="padding:0 0 8px 52px">Ghi lúc ${fmtDateTime(m.created_at)}${m.updated_at && m.updated_at !== m.created_at ? ` · sửa ${fmtDateTime(m.updated_at)}` : ''}
        ${canOwner && !m.order_id && m.type !== 'select_breeder' ? html` · <button class="btn ghost sm" data-edit="${m.id}">${icon('edit')} Sửa</button> <button class="btn ghost sm" data-del="${m.id}">${icon('trash')}</button>` : ''}</div></div>`)}</div>` : empty('Chưa có biến động.')}</div>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const ed = e.target.closest('[data-edit]');
        if (ed) { const m = s.byId('stock_movements', ed.dataset.edit); openMovementForm(app, { type: m.type, movement: m }); return; }
        const del = e.target.closest('[data-del]');
        if (del) {
          if (!(await confirmDialog('Xoá dòng biến động này? (Xoá mềm, vẫn lưu vết.)', { danger: true, ok: 'Xoá' }))) return;
          const r = await s.run(planDeleteMovement(s.db, del.dataset.del, s.ctx()), { requires: 'delete' });
          toast(r.ok ? 'Đã xoá' : r.errors.join('; '), r.ok ? 'ok' : 'error');
        }
      });
    },
  };
}

export function openMovementForm(app, { type, penId, movement = null }) {
  const s = app.store;
  const P = pens(s);
  const penOpts = (sel) => options(Object.fromEntries(P.map((p) => [p.id, `${p.name} (còn ${penBalance(s.db.stock_movements, p.id)})`])), sel);
  const cagesWithPair = s.db.cages.filter((c) => !c.archived).sort(byCageCode);
  const m = movement;
  let t = m?.type || type;
  const titles = { in_breeding: 'Nhập từ lồng sinh sản', in_other: 'Nhập khác', transfer: 'Chuyển giữa lồng phóng', loss: 'Ghi nhận hao hụt', adjust_out: 'Điều chỉnh kiểm đếm', adjust_in: 'Điều chỉnh kiểm đếm' };
  const otherPen = P.find((p) => p.id !== penId)?.id;
  const bodyFor = (tt) => html`<form class="form" data-f>
    ${tt.startsWith('adjust') ? field('Loại điều chỉnh', html`<select name="type">${options({ adjust_out: 'Đếm thực tế ÍT hơn sổ (−)', adjust_in: 'Đếm thực tế NHIỀU hơn sổ (+)' }, tt)}</select>`) : html`<input type="hidden" name="type" value="${tt}">`}
    ${tt.startsWith('in') ? '' : ''}
    ${MOVEMENT_TYPES[tt].from ? field(tt === 'transfer' ? 'Từ lồng' : 'Lồng', html`<select name="from_pen_id">${penOpts(m?.from_pen_id || penId)}</select>`) : ''}
    ${MOVEMENT_TYPES[tt].to ? field(tt === 'transfer' ? 'Đến lồng' : 'Nhập vào lồng', html`<select name="to_pen_id">${penOpts(m?.to_pen_id || (tt === 'transfer' ? otherPen : penId))}</select>`) : ''}
    ${tt === 'in_breeding' ? html`<div class="grid2">
      ${field('Từ lồng sinh sản', html`<select name="source_cage_id" data-srccage><option value="">— Chọn —</option>${options(Object.fromEntries(cagesWithPair.map((c) => [c.id, c.code])), m?.source_cage_id)}</select>`)}
      ${field('Lứa gốc', html`<select name="source_clutch_id" data-srcclutch>${clutchOpts(s, m?.source_cage_id, m?.source_clutch_id)}</select>`)}</div>` : ''}
    <div class="grid2">
      ${field('Số lượng', html`<input type="number" name="qty" min="1" step="1" inputmode="numeric" value="${m?.qty || ''}" required>`)}
      ${field('Ngày', html`<input type="date" name="date" value="${m?.date || s.today()}" max="${s.today()}">`)}</div>
    ${field(['loss', 'adjust_in', 'adjust_out'].includes(tt) ? 'Lý do (bắt buộc)' : 'Ghi chú', html`<textarea name="note" rows="2" placeholder="${tt === 'loss' ? 'VD: chết 1 con yếu' : ''}">${m?.note || ''}</textarea>`)}
    ${tt === 'in_breeding' ? html`<p class="def">Sau khi nhập, nhớ cập nhật nhật ký lồng sinh sản (giảm "chim non hiện tại", tăng "đã ra ràng") để không bị tính trùng.</p>` : ''}
    <div class="form-msg" data-msg></div></form>`;
  openSheet({
    title: (m ? 'Sửa: ' : '') + titles[t],
    body: bodyFor(t),
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      el.addEventListener('change', (e) => {
        if (e.target.matches('[data-srccage]')) el.querySelector('[data-srcclutch]').innerHTML = String(clutchOpts(s, e.target.value));
      });
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(el.querySelector('[data-f]'));
        const plan = planMovement(s.db, { ...v, id: m?.id, qty: toInt(v.qty, 0) }, s.ctx());
        const r = await s.run(plan, { requires: m ? 'delete' : 'stock.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu biến động'); close();
        if (v.type === 'in_breeding' && v.source_cage_id && !m) {
          const cage = s.byId('cages', v.source_cage_id);
          if (await confirmDialog(`Mở "Cập nhật hôm nay" cho ${cage.code} để giảm số chim non hiện tại?`, { ok: 'Mở nhật ký' })) openDailyForm(app, cage.id, { date: s.today() });
        }
      }));
    },
  });
}

function clutchOpts(s, cageId, sel) {
  if (!cageId) return raw('<option value="">— Chọn lồng trước —</option>');
  const list = s.db.clutches.filter((c) => c.cage_id === cageId && !c.deleted).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return raw(`<option value="">— Không rõ —</option>${list.map((c) => `<option value="${esc(c.id)}"${c.id === sel || (!sel && c.status !== 'closed') ? ' selected' : ''}>${esc(c.code)} (${c.status === 'closed' ? 'đã kết thúc' : 'đang mở'})</option>`).join('')}`);
}

export { currentPair, badge };
