import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { cageArt } from '../ui/brand.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, confirmDialog, empty, badge } from '../ui/components.js';
import { flightPens, MOVEMENT_TYPES, ORIGIN_LABELS, PEN_NAME_MAX, penBalance, penLedger, penSummary, planMovement, planDeleteMovement, planPenCount, planOrigin, planPenSave, penHasData } from '../domain/stock.js';
import { currentPair, byCageCode, clutchSummary, movedToPens, clutchTitle } from '../domain/breeding.js';
import { newRequestId } from '../domain/brood.js';
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
];

function pens(store) { return flightPens(store.db); }

export function render(app) {
  const s = app.store;
  const list = pens(s);
  const total = list.reduce((a, p) => a + penBalance(s.db.stock_movements, p.id), 0);
  const canW = s.can('stock.write');
  const canPen = s.can('settings.write');
  const archived = canPen ? flightPens(s.db, true).sort((a, b) => penBalance(s.db.stock_movements, b.id) - penBalance(s.db.stock_movements, a.id) || a.name.localeCompare(b.name)) : [];
  return {
    html: html`
      <div class="page-head"><div class="grow"><h1>Lồng phóng</h1><div class="sub">Quản lý theo số lượng · tổng ${total} con</div></div>
        ${canPen ? html`<button class="btn soft sm" data-pen-new>${icon('plus')} Thêm lồng phóng</button>` : ''}</div>
      ${list.map((p) => {
        const bal = penBalance(s.db.stock_movements, p.id);
        const last = penLedger(s.db.stock_movements, p.id).slice(0, 3);
        const sum = penSummary(s.db.stock_movements, p.id);
        return html`<div class="card" data-pen="${p.id}">
          <div style="display:flex;align-items:center;gap:12px">${cageArt(56)}
            <div class="grow" style="flex:1"><div class="card-title" style="margin:0">${p.name}${canPen ? html` <button class="note-pen" data-pen-edit aria-label="Sửa ${p.name}">${icon('edit')}</button>` : ''}</div><div class="small muted">${p.purpose || ''}</div></div>
            <div style="text-align:right"><div class="stat-value">${bal}</div><div class="small muted">con hiện tại</div></div></div>
          <div class="pen-sum"><div><b>${sum.counted > 0 ? '+' : ''}${sum.counted}</b>Kiểm kê</div><div><b>${sum.movedIn}</b>Chuyển đến</div><div><b>${sum.movedOut}</b>Chuyển đi / bán</div><div><b>${sum.lost}</b>Chết / hao hụt</div></div>
          ${sum.originUnknown ? html`<div class="pen-unknown">${badge(`${sum.originUnknown} con nguồn gốc: ${ORIGIN_LABELS.unknown}`, 'warn')}</div>` : ''}
          ${canW ? html`<button class="btn primary pen-count" data-mv="adjust">${icon('clipboard')} Cập nhật số chim hiện có</button>` : ''}
          ${canW ? html`<div class="pen-actions">
            ${ACTIONS.map(([k, l, ic, tone]) => (k === 'sale' && !s.can('sales.write')) ? '' : html`<button class="btn ${tone} sm" data-mv="${k}">${icon(ic)} ${l}</button>`)}</div>` : ''}
          <div class="section" style="margin-top:14px"><h2 style="font-size:14px">Biến động gần đây</h2><a href="#/pen/${p.id}">Toàn bộ lịch sử</a></div>
          ${last.length ? html`<div class="list">${last.map((m) => mvRow(s, m))}</div>` : html`<p class="small muted">Chưa có biến động.</p>`}
        </div>`;
      })}
      ${!list.length ? empty('Chưa có lồng phóng.', cageArt(72)) : ''}
      ${archived.length ? html`<details class="card pen-archived"><summary>Đã ngừng sử dụng (${archived.length})</summary>
        <p class="small muted">Không tính vào tổng. Số chim còn trên sổ của các lồng này được giữ nguyên.</p>
        <div class="list">${archived.map((p) => html`<div class="row" data-pen="${p.id}"><span class="grow"><a class="title" href="#/pen/${p.id}">${p.name}</a><br><span class="desc">${p.purpose || ''}${p.purpose ? ' · ' : ''}còn ${penBalance(s.db.stock_movements, p.id)} con trên sổ</span></span>
          <button class="btn ghost sm" data-pen-restore>Dùng lại</button>${penHasData(s.db, p.id) ? '' : html`<button class="btn ghost sm" data-pen-del aria-label="Xoá vĩnh viễn ${p.name}">${icon('trash')}</button>`}</div>`)}</div></details>` : ''}
      <p class="def">Mọi thay đổi số lượng đều là một dòng trong sổ biến động (có ngày, loại, người ghi). Hệ thống chặn mọi thao tác làm âm tồn tại bất kỳ thời điểm nào. Không yêu cầu mã cá thể cho chim thương mại.</p>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-pen-new]')) return openPenForm(app, null);
        const penId0 = e.target.closest('[data-pen]')?.dataset.pen;
        if (e.target.closest('[data-pen-edit]')) return openPenForm(app, penId0);
        if (e.target.closest('[data-pen-del]')) return deletePen(app, penId0);
        const re = e.target.closest('[data-pen-restore]');
        if (re) {
          const p = s.byId('flight_pens', penId0);
          const r = await s.run(planPenSave(s.db, { ...p, archived: false }, s.ctx()), { requires: 'settings.write' });
          return toast(r.ok ? `Đã dùng lại ${p.name}` : r.errors.join('; '), r.ok ? 'ok' : 'error');
        }
        const b = e.target.closest('[data-mv]');
        if (!b) return;
        const penId = b.closest('[data-pen]').dataset.pen;
        const k = b.dataset.mv;
        if (k === 'adjust') openPenCount(app, penId);
        else if (k === 'select') openSelectBreeders(app, penId);
        else if (k === 'sale') openOrderForm(app, null, { items: [{ kind: 'pen', pen_id: penId, qty: 1, unit_price: 0 }] });
        else openMovementForm(app, { type: k === 'adjust' ? 'adjust_out' : k, penId });
      });
    },
  };
}

export function mvRow(s, m) {
  const t = m.counted_total != null ? `Kiểm kê: đếm được ${m.counted_total} con` : MOVEMENT_TYPES[m.type]?.label || m.type;
  const from = m.from_pen_id ? s.byId('flight_pens', m.from_pen_id)?.name : null;
  const to = m.to_pen_id ? s.byId('flight_pens', m.to_pen_id)?.name : null;
  const src = m.source_cage_id ? s.byId('cages', m.source_cage_id)?.code : null;
  const order = m.order_id ? s.byId('orders', m.order_id) : null;
  return html`<div class="row"><span class="row-icon ${m.delta < 0 ? 'gold' : 'green'}">${icon(m.delta < 0 ? 'minus' : 'plus')}</span>
    <span class="grow"><span class="title">${t}</span> <span class="desc">· ${fmtDate(m.date)}</span><br>
    <span class="desc">${from ? `Từ ${from}` : ''}${from && to ? ' → ' : ''}${to ? `Đến ${to}` : ''}${src ? ` · Lồng SS ${src}` : ''}${order ? raw(` · <a href="#/order/${esc(order.id)}">Đơn ${esc(order.code)}</a>`) : ''}${m.note && !order ? ` · ${m.note}` : ''}</span>${m.origin_status === 'unknown' ? html`<br>${badge(`Nguồn gốc: ${ORIGIN_LABELS.unknown}`, 'warn')}` : m.origin_note ? html`<br><span class="desc">Nguồn gốc: ${m.origin_note}</span>` : ''}</span>
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
        ${canOwner && !m.order_id && m.type !== 'select_breeder' ? html` · <button class="btn ghost sm" data-edit="${m.id}">${icon('edit')} Sửa</button> <button class="btn ghost sm" data-del="${m.id}">${icon('trash')}</button>` : ''}
        ${m.origin_status === 'unknown' && s.can('stock.write') ? html` · <button class="btn soft sm" data-origin="${m.id}">${icon('edit')} Bổ sung nguồn gốc</button>` : ''}</div></div>`)}</div>` : empty('Chưa có biến động.')}</div>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const og = e.target.closest('[data-origin]');
        if (og) { openOrigin(app, og.dataset.origin); return; }
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

/** Cập nhật số chim hiện có: nhập số đếm được, app tính chênh lệch và ghi 1 dòng kiểm kê. */
export function openPenCount(app, penId) {
  const s = app.store; const p = s.byId('flight_pens', penId);
  const book = penBalance(s.db.stock_movements, penId);
  openSheet({
    title: 'Cập nhật số chim hiện có', subtitle: `${p.name} · sổ đang ghi ${book} con`,
    body: html`<form class="form" data-f novalidate>
      ${field('Số chim đếm được', html`<input type="number" name="counted" min="0" step="1" inputmode="numeric" value="${book}" required>`)}
      <div class="msg info" data-diff></div>
      <div data-origin-box>${field('Nguồn gốc (nếu biết)', html`<textarea name="origin" rows="2" maxlength="300" placeholder="Để trống nếu chưa rõ"></textarea>`, `Để trống sẽ ghi "${ORIGIN_LABELS.unknown}", có thể bổ sung sau.`)}</div>
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="300"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-f]');
      const upd = () => {
        const n = toInt(f.elements.counted.value, -1); const d = n - book;
        el.querySelector('[data-diff]').textContent = n < 0 ? 'Nhập số nguyên từ 0 trở lên' : !d ? 'Khớp với sổ, không có gì thay đổi' : `${d > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(d)} con so với sổ. Không tạo dòng chuyển lồng.`;
        el.querySelector('[data-origin-box]').hidden = d <= 0;
      };
      f.addEventListener('input', upd); upd();
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f);
        const plan = planPenCount(s.db, { penId, counted: v.counted, origin: v.origin, note: v.note }, s.ctx());
        const r = await s.run(plan, { requires: 'stock.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(plan.unchanged ? 'Số chim khớp với sổ, không ghi thêm' : `Đã cập nhật ${p.name}: ${v.counted} con`);
        close();
      }));
    },
  });
}

function openOrigin(app, id) {
  const s = app.store; const m = s.byId('stock_movements', id);
  openSheet({
    title: 'Bổ sung nguồn gốc', subtitle: `${m.qty} con · ${fmtDate(m.date)}`,
    body: html`<form class="form" data-f novalidate>${field('Nguồn gốc đã xác minh', html`<textarea name="origin" rows="3" maxlength="300"></textarea>`, 'Chỉ bổ sung thông tin, không đổi số lượng.')}<div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const r = await s.run(planOrigin(s.db, id, formValues(el.querySelector('[data-f]')).origin, s.ctx()), { requires: 'stock.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã bổ sung nguồn gốc'); close();
    })),
  });
}

async function deletePen(app, id) {
  const s = app.store; const p = s.byId('flight_pens', id);
  if (penHasData(s.db, id)) { toast('Lồng đã có dữ liệu liên quan, chỉ được ngừng sử dụng', 'error'); return false; }
  if (!(await confirmDialog(`Xoá vĩnh viễn ${p.name}? Lồng chưa có dữ liệu nào. Thao tác này không hoàn tác được.`, { danger: true, ok: 'Xoá vĩnh viễn' }))) return false;
  const r = await s.deletePen(id);
  toast(r.ok ? `Đã xoá ${p.name}` : r.errors.join('; '), r.ok ? 'ok' : 'error');
  return r.ok;
}

/** Thêm / sửa lồng, ngừng sử dụng, xoá. Thuộc quyền chủ trại, như Thêm lồng sinh sản. */
export function openPenForm(app, id, opts = {}) {
  const s = app.store; const p = id ? s.byId('flight_pens', id) : null;
  const breeder = (p?.kind || opts.kind) === 'breeder'; // V2.2.3: lồng giống dùng chung form, không có số chim ban đầu (đếm theo hồ sơ)
  openSheet({
    title: p ? `Sửa ${p.name}` : breeder ? 'Thêm lồng giống' : 'Thêm lồng phóng',
    body: html`<form class="form" data-f novalidate>
      ${field('Tên lồng *', html`<input name="name" maxlength="${PEN_NAME_MAX}" value="${p?.name || ''}" required>`)}
      ${field('Mục đích / ghi chú', html`<input name="purpose" maxlength="120" value="${p?.purpose || ''}" placeholder="VD: Chim tơ để bán">`)}
      ${p || breeder ? '' : html`${field('Số chim hiện có (tuỳ chọn)', html`<input type="number" name="initial" min="0" step="1" inputmode="numeric" placeholder="0">`, `Khi chưa biết nguồn gốc, nhập số đếm được. Nguồn gốc sẽ ghi "${ORIGIN_LABELS.unknown}".`)}
      ${field('Nguồn gốc (nếu biết)', html`<input name="origin" maxlength="300">`)}`}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`${p ? html`${penHasData(s.db, id) ? '' : html`<button class="btn ghost" data-del aria-label="Xoá vĩnh viễn">${icon('trash')}</button>`}<button class="btn ghost" data-archive>Ngừng sử dụng</button>` : html`<button class="btn ghost" data-close>Huỷ</button>`}<button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      const msg = el.querySelector('[data-msg]');
      const save = async (extra) => {
        const v = formValues(el.querySelector('[data-f]'));
        const r = await s.run(planPenSave(s.db, { ...v, id, kind: breeder ? 'breeder' : 'flight', archived: p?.archived, ...extra }, s.ctx()), { requires: 'settings.write' });
        if (!r.ok) { showMessages(msg, r.errors); return false; }
        return true;
      };
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => { if (await save()) { toast(breeder ? 'Đã lưu lồng giống' : 'Đã lưu lồng phóng'); close(); } }));
      el.querySelector('[data-archive]')?.addEventListener('click', async () => {
        if (!(await confirmDialog(`Ngừng sử dụng ${p.name}? Lồng được ẩn, lịch sử giữ nguyên, có thể dùng lại sau.`, { ok: 'Ngừng sử dụng' }))) return;
        if (await save({ archived: true })) { toast(`Đã ngừng sử dụng ${p.name}`); close(); }
      });
      el.querySelector('[data-del]')?.addEventListener('click', async () => { if (await deletePen(app, id)) close(); });
    },
  });
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
  const requestId = newRequestId();
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
    ${tt === 'in_breeding' ? html`<p class="def">${s.smartCards && !m ? 'Chọn lứa đang mở: chim non của lứa tự giảm đúng số này khi lưu. Số đã ghi ra ràng trước đó mà chưa nhập thì không trừ lại. Không chọn lứa: chỉ tăng lồng phóng.' : 'Sau khi nhập, nhớ cập nhật nhật ký lồng sinh sản (giảm "chim non hiện tại", tăng "đã ra ràng") để không bị tính trùng.'}</p>` : ''}
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
        // Chim non của lứa đang mở: giảm tổ và tăng lồng phóng trong 1 giao dịch ở máy chủ
        const srcClutch = !m && v.type === 'in_breeding' && s.smartCards && v.source_clutch_id ? s.byId('clutches', v.source_clutch_id) : null;
        if (srcClutch?.status === 'open') {
          const sm = clutchSummary(srcClutch, s.db.daily_logs);
          const waiting = Math.max(0, sm.fledged - movedToPens(s.db.stock_movements, srcClutch.id));
          const qty = toInt(v.qty, 0);
          if (qty > waiting) {
            const r = await s.brood('brood_clutch_fledge', { request_id: requestId, clutch_id: srcClutch.id, qty, to_pen_id: v.to_pen_id, event_date: v.date, note: v.note });
            if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
            toast(r.result?.duplicate ? 'Thao tác này đã được lưu trước đó — không ghi trùng' : 'Đã lưu biến động'); close();
            return;
          }
        }
        const plan = planMovement(s.db, { ...v, id: m?.id, qty: toInt(v.qty, 0) }, s.ctx());
        const r = await s.run(plan, { requires: m ? 'delete' : 'stock.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu biến động'); close();
        if (v.type === 'in_breeding' && v.source_cage_id && !m && !s.smartCards) {
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
  return raw(`<option value="">— Không rõ —</option>${list.map((c) => `<option value="${esc(c.id)}"${c.id === sel || (!sel && c.status !== 'closed') ? ' selected' : ''}>${esc(clutchTitle(c))} (${c.status === 'closed' ? 'đã kết thúc' : 'đang mở'})</option>`).join('')}`);
}

export { currentPair, badge };
