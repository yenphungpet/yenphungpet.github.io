import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, confirmDialog, empty, badge, statTile } from '../ui/components.js';
import {
  INV_CATEGORIES, INV_TYPES, UNITS, itemStatus, itemLedger, itemBalance, planItemSave, planInvMovement, planDeleteInvMovement,
  reconciliation, purchaseCost, normalizeUnit, round3, invCost,
} from '../domain/inventory.js';
import { fmtDate, fmtDateTime, addDays } from '../core/dates.js';
import { fmtMoney, fmtMoneyShort, matches, toMoney, toDecimal } from '../core/format.js';

const LEVEL = { low: ['Sắp hết', 'danger'], warn: ['Sắp chạm ngưỡng', 'warn'], ok: ['Đủ dùng', 'ok'] };
const num = (n) => (n === null || n === undefined ? '—' : String(round3(n)).replace('.', ','));

function items(s) { return (s.db.inventory_items || []).filter((i) => !i.deleted); }

function itemCard(s, st, canUse) {
  const i = st.item;
  const [lv, tone] = LEVEL[st.level];
  return html`<article class="card inv-card ${st.level === 'low' ? 'alert-card' : ''}" data-item="${i.id}">
    <div class="inv-top">
      <div class="grow" style="min-width:0"><div class="card-title" style="margin:0">${i.name}</div>
        <div class="small muted">${i.category}${i.archived ? ' · đã lưu trữ' : ''}</div>
        <div class="cc-badges" style="justify-content:flex-start;max-width:none;margin-top:6px">${badge(lv, tone)}${st.needsReview ? badge('Cần xác minh (dữ liệu cũ)', 'orange') : ''}</div></div>
      <div class="inv-qty"><b class="num">${num(st.balance)}</b><span>${i.unit}</span></div>
    </div>
    <div class="cc-meta">
      <span>Ngưỡng: <b>${num(i.threshold)} ${i.unit}</b></span>
      <span>${st.daysLeft !== null ? html`Còn khoảng <b>${st.daysLeft} ngày</b> (${st.rateSource === 'actual' ? `tiêu hao thực tế ~${num(st.rate)}/ngày` : `ước tính ${num(st.rate)}/ngày`})` : 'Chưa đủ dữ liệu tiêu hao'}</span>
      <span>${st.lastCount ? html`Kiểm kê: <b>${fmtDate(st.lastCount.date)}</b> (${st.daysSinceCount} ngày trước)` : html`<b>Chưa kiểm kê</b>`}</span>
    </div>
    ${canUse ? html`<div class="inv-actions">
      <button class="btn primary" data-inv="use">${icon('minus')} Xuất dùng</button>
      <button class="btn soft" data-inv="${s.can('inventory.purchase') ? 'purchase' : 'in_other'}">${icon('plus')} Nhập</button>
      <button class="btn soft" data-inv="count">${icon('clipboard')} Kiểm kê</button>
      <a class="btn soft" href="#/inventory/${i.id}">${icon('history')} Lịch sử</a></div>` : ''}
  </article>`;
}

export function render(app, _p, query) {
  const s = app.store;
  const today = s.today();
  const f = query.f || 'all';
  const q = query.q || '';
  const all = items(s).filter((i) => f === 'archived' ? i.archived : !i.archived).map((i) => itemStatus(i, s.db.inventory_movements, today));
  const list = all.filter((st) => (f === 'all' || f === 'archived' || (f === 'low' ? st.level === 'low' : f === 'review' ? st.needsReview : st.item.category === f))
    && matches(q, st.item.name, st.item.note, st.item.category))
    .sort((a, b) => ({ low: 0, warn: 1, ok: 2 }[a.level] - { low: 0, warn: 1, ok: 2 }[b.level]) || a.item.name.localeCompare(b.item.name));
  const active = items(s).filter((i) => !i.archived).map((i) => itemStatus(i, s.db.inventory_movements, today));
  const canUse = s.can('inventory.use');
  const m = today.slice(0, 7);
  const chips = [['all', 'Tất cả'], ['low', 'Sắp hết'], ...INV_CATEGORIES.map((c) => [c, c]), ['review', 'Cần xác minh'], ['archived', 'Đã lưu trữ']];
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Kho & thức ăn</h1><div class="sub">Tồn kho theo sổ nhập – xuất – kiểm kê</div></div>
        ${s.can('inventory.manage') ? html`<button class="btn soft sm" data-new-item>${icon('plus')} Vật tư</button>` : ''}</div>
      <div class="stats">
        ${statTile('Vật tư đang theo dõi', active.length)}
        ${statTile('Sắp hết', active.filter((x) => x.level === 'low').length, { tone: active.some((x) => x.level === 'low') ? 'red' : 'green', href: '#/inventory?f=low' })}
        ${statTile('Chưa kiểm kê > 30 ngày', active.filter((x) => x.daysSinceCount === null || x.daysSinceCount > 30).length, { tone: 'gold', href: '#/inventory-check' })}
        ${s.can('finance.read') ? statTile('Chi phí nhập tháng này', fmtMoneyShort(purchaseCost(s.db, `${m}-01`, `${m}-31`)), { sub: 'theo phiếu nhập có giá', href: '#/finance' }) : statTile('Cần xác minh', active.filter((x) => x.needsReview).length, { href: '#/inventory?f=review' })}
      </div>
      <div class="btn-row" style="margin:12px 0"><a class="btn ghost" href="#/inventory-check">${icon('chart')} Đối chiếu tồn</a></div>
      <label class="search">${icon('search')}<input type="search" placeholder="Tìm vật tư…" value="${q}" data-q aria-label="Tìm vật tư"></label>
      <div class="chips">${chips.map(([k, l]) => html`<a class="chip ${k === f ? 'active' : ''}" href="#/inventory?f=${encodeURIComponent(k)}">${l}</a>`)}</div>
      ${list.length ? html`<div class="cage-list">${list.map((st) => itemCard(s, st, canUse))}</div>` : empty('Không có vật tư phù hợp.')}
      <p class="def">Tồn kho chỉ thay đổi khi có phiếu Nhập / Xuất / Hao hụt / Kiểm kê (có lịch sử). "Tiêu hao/ngày" chỉ dùng để ước tính số ngày còn lại — không tự trừ tồn như App cũ. Hệ thống chặn xuất vượt tồn.</p>`,
    mount(root) {
      root.querySelector('[data-new-item]')?.addEventListener('click', () => openItemForm(app, null));
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-inv]');
        if (b) openInvForm(app, { itemId: b.closest('[data-item]').dataset.item, type: b.dataset.inv });
      });
      const qi = root.querySelector('[data-q]');
      let t;
      qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', `#/inventory?f=${encodeURIComponent(f)}&q=${encodeURIComponent(qi.value)}`); app.render(); const n = document.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    },
  };
}

function rowDesc(s, m, item, showCost) {
  const parts = [];
  if (m.type === 'count') parts.push(`Đếm thực tế ${num(m.counted_qty)} ${item.unit} · chênh lệch ${m.delta > 0 ? '+' : ''}${num(m.delta)}`);
  if (m.pack_qty) parts.push(`${num(m.pack_qty)} gói × ${num(m.pack_size)} ${item.unit}`);
  if (m.supplier) parts.push(m.supplier);
  const cost = showCost ? invCost(s.db, m)?.total_cost : null;
  if (cost) parts.push(`${fmtMoney(cost)}${m.finance_mode === 'created' ? ' · đã ghi chi phí' : m.finance_mode === 'linked' ? ' · liên kết khoản chi có sẵn' : ' · chưa ghi vào Tài chính'}`);
  if (m.note) parts.push(m.note);
  if (m.legacy_unverified) parts.push('dữ liệu cũ chưa xác minh');
  return parts.join(' · ');
}

export function renderDetail(app, { id }) {
  const s = app.store;
  const item = s.byId('inventory_items', id);
  if (!item) return { html: empty('Không tìm thấy vật tư.') };
  const st = itemStatus(item, s.db.inventory_movements, s.today());
  const rows = itemLedger(s.db.inventory_movements, id).reverse();
  const owner = s.can('inventory.manage');
  const showCost = s.can('finance.read');
  return {
    html: html`<div class="page-head"><a class="back" href="#/inventory">${icon('back')}</a><div class="grow"><h1>${item.name}</h1><div class="sub">${item.category} · đơn vị gốc: ${item.unit}</div></div>
        ${owner ? html`<button class="btn soft sm" data-edit-item>${icon('edit')} Sửa</button>` : ''}</div>
      ${itemCard(s, st, s.can('inventory.use'))}
      ${item.needs_review ? html`<div class="msg warn" style="margin-top:12px">${icon('alert')} <div>Vật tư nhập từ App cũ, cần xác minh: ${item.review_note || 'kiểm kê lại số lượng thực tế'}.${owner ? ' Sau khi kiểm kê, mở "Sửa" và bỏ đánh dấu.' : ''}</div></div>` : ''}
      ${item.note ? html`<p class="def">${item.note}</p>` : ''}
      <div class="section"><h2>Lịch sử nhập – xuất (${rows.length})</h2></div>
      <div class="card">${rows.length ? html`<div class="list">${rows.map((m) => html`<div class="row" data-mv="${m.id}">
        <span class="row-icon ${m.delta < 0 ? 'gold' : m.type === 'count' ? '' : 'green'}">${icon(m.type === 'count' ? 'clipboard' : m.delta < 0 ? 'minus' : 'plus')}</span>
        <span class="grow"><span class="title">${INV_TYPES[m.type]?.label}</span> <span class="desc">· ${fmtDate(m.date)}</span><br>
          <span class="desc">${rowDesc(s, m, item, showCost)}</span><br>
          <span class="desc">Ghi ${fmtDateTime(m.created_at)}${m.version ? ` · đã sửa ${m.version} lần` : ''}</span>
          ${owner ? html`<br><button class="btn ghost sm" data-edit-mv="${m.id}">${icon('edit')} Sửa</button> <button class="btn ghost sm" data-del-mv="${m.id}">${icon('trash')}</button>` : ''}</span>
        <span class="right"><b class="${m.delta < 0 ? 'money-out' : 'money-in'}">${m.delta > 0 ? '+' : ''}${num(m.delta)}</b><br><span class="small muted">còn ${num(m.balance)}</span></span></div>`)}</div>` : empty('Chưa có phiếu nhập/xuất.')}</div>`,
    mount(root) {
      root.querySelector('[data-edit-item]')?.addEventListener('click', () => openItemForm(app, id));
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-inv]');
        if (b) return openInvForm(app, { itemId: id, type: b.dataset.inv });
        const ed = e.target.closest('[data-edit-mv]');
        if (ed) return openInvForm(app, { itemId: id, movement: s.byId('inventory_movements', ed.dataset.editMv) });
        const del = e.target.closest('[data-del-mv]');
        if (del) {
          if (!(await confirmDialog('Xoá phiếu kho này? Xoá mềm, có lưu vết. Nếu phiếu đã tự ghi chi phí, khoản chi đó cũng bị xoá mềm.', { danger: true, ok: 'Xoá' }))) return;
          const r = await s.run(planDeleteInvMovement(s.db, del.dataset.delMv, s.ctx()), { requires: 'inventory.manage' });
          toast(r.ok ? 'Đã xoá phiếu kho' : r.errors.join('; '), r.ok ? 'ok' : 'error');
        }
      });
    },
  };
}

export function renderCheck(app) {
  const s = app.store;
  const rows = reconciliation(s.db, s.today()).sort((a, b) => (a.daysSinceCount ?? 9999) < (b.daysSinceCount ?? 9999) ? 1 : -1);
  return {
    html: html`<div class="page-head"><a class="back" href="#/inventory">${icon('back')}</a><div class="grow"><h1>Đối chiếu tồn</h1><div class="sub">Sổ sách so với số đếm thực tế lần gần nhất</div></div></div>
      <div class="card scroll-x"><table class="table"><thead><tr><th>Vật tư</th><th class="r">Sổ trước kiểm</th><th class="r">Đếm thực tế</th><th class="r">Chênh lệch</th><th>Lần kiểm</th><th class="r">Tồn hiện tại</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td><a href="#/inventory/${r.item.id}"><b>${r.item.name}</b></a>${r.needsReview ? html`<br>${badge('Cần xác minh', 'orange')}` : ''}</td>
          <td class="r">${num(r.bookBeforeCount)}</td><td class="r">${num(r.counted)}</td>
          <td class="r"><b class="${r.diff < 0 ? 'money-out' : r.diff > 0 ? 'money-in' : ''}">${r.diff === null ? '—' : `${r.diff > 0 ? '+' : ''}${num(r.diff)}`}</b></td>
          <td>${r.lastCountDate ? `${fmtDate(r.lastCountDate)} (${r.daysSinceCount}n)` : html`<span class="money-out">Chưa kiểm kê</span>`}</td>
          <td class="r">${num(r.balance)} ${r.item.unit}</td></tr>`)}</tbody></table></div>
      <p class="def">Chênh lệch âm = thực tế ÍT hơn sổ (hao hụt chưa ghi, xuất chưa ghi); dương = thực tế NHIỀU hơn sổ (nhập chưa ghi). Nên kiểm kê định kỳ (gợi ý: 2 tuần/lần với thức ăn).</p>`,
  };
}

function txOptions(s, selected, movementId) {
  const used = new Set((s.db.inventory_movements || []).filter((m) => m.transaction_id && !m.deleted && m.id !== movementId).map((m) => m.transaction_id));
  const list = s.db.transactions.filter((t) => !t.deleted && t.type === 'expense' && t.source !== 'inventory' && (!used.has(t.id) || t.id === selected))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
  return raw(`<option value="">— Chọn khoản chi đã ghi —</option>${list.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? ' selected' : ''}>${esc(fmtDate(t.date))} · ${esc(t.description)} · ${esc(fmtMoney(t.amount))}</option>`).join('')}`);
}

/** Phiếu kho: nhập mua / nhập khác / xuất dùng / hao hụt / kiểm kê / tồn đầu kỳ. */
export function openInvForm(app, { itemId, type, movement = null }) {
  const s = app.store;
  const item = s.byId('inventory_items', itemId);
  const m = movement;
  if (m && !s.can('inventory.manage')) { toast('Chỉ chủ trại được sửa phiếu kho', 'error'); return; }
  const allowed = s.can('inventory.purchase') ? ['use', 'purchase', 'in_other', 'loss', 'count', 'opening'] : ['use', 'in_other', 'loss', 'count'];
  let t = m?.type || (allowed.includes(type) ? type : 'use');
  const bal = () => itemBalance(s.db.inventory_movements.filter((x) => x.id !== m?.id), item.id);
  const body = () => html`<form class="form" data-f>
    <div class="grid2">${field('Loại phiếu', html`<select name="type" data-type>${options(Object.fromEntries(allowed.map((k) => [k, INV_TYPES[k].label])), t)}</select>`)}
      ${field('Ngày', html`<input type="date" name="date" value="${m?.date || s.today()}" max="${s.today()}">`)}</div>
    <div class="msg info">${icon('info')} Tồn sổ hiện tại${m ? ' (không tính phiếu đang sửa)' : ''}: <b>${num(bal())} ${item.unit}</b></div>
    ${t === 'count' ? html`
      ${field(`Số lượng đếm thực tế (${item.unit})`, html`<input name="counted_qty" inputmode="decimal" value="${m?.counted_qty ?? ''}" placeholder="VD: 8,5">`, 'Kiểm kê đặt lại tồn theo số đếm; chênh lệch được lưu để đối chiếu.')}`
    : html`
      <label class="check"><input type="checkbox" name="use_pack" data-pack ${m?.pack_qty ? 'checked' : ''}> Nhập theo quy cách (số gói/bao × ${item.unit} mỗi gói)</label>
      <div data-qty-plain class="${m?.pack_qty ? 'hidden' : ''}">${field(`Số lượng (${item.unit})`, html`<input name="qty" inputmode="decimal" value="${m?.pack_qty ? '' : (m?.qty ?? '')}" placeholder="VD: 1,5">`)}
        <div class="chips" style="margin:6px 0 0;padding:0">${[0.5, 1, 2, 5].map((v) => html`<button type="button" class="chip" data-add-qty="${v}">+${String(v).replace('.', ',')}</button>`)}</div></div>
      <div data-qty-pack class="grid2 ${m?.pack_qty ? '' : 'hidden'}">${field('Số gói / bao', html`<input name="pack_qty" inputmode="decimal" value="${m?.pack_qty ?? ''}">`)}
        ${field(`${item.unit} mỗi gói`, html`<input name="pack_size" inputmode="decimal" value="${m?.pack_size ?? ''}" placeholder="VD: 25">`)}</div>`}
    ${t === 'purchase' ? html`<fieldset class="fieldset"><legend>Chi phí</legend>
      <div class="grid2">${field('Thành tiền (đ)', html`<input name="total_cost" inputmode="numeric" value="${invCost(s.db, m)?.total_cost ?? ''}">`)}${field('Nơi mua', html`<input name="supplier" value="${m?.supplier || ''}">`)}</div>
      ${field('Ghi vào Tài chính', html`<select name="finance" data-fin>${options({ create: 'Ghi khoản chi MỚI vào Tài chính', link: 'Liên kết khoản chi ĐÃ CÓ (tránh cộng trùng)', none: 'Không ghi chi phí' }, m?.finance_mode === 'linked' ? 'link' : m?.finance_mode === 'none' ? 'none' : 'create')}</select>`,
        'Nếu đã ghi khoản mua này ở Tài chính rồi, chọn "Liên kết" — không tạo thêm khoản chi.')}
      <div data-link class="${m?.finance_mode === 'linked' ? '' : 'hidden'}">${field('Khoản chi đã có', html`<select name="link_transaction_id">${txOptions(s, m?.transaction_id, m?.id)}</select>`)}</div></fieldset>` : ''}
    ${field(t === 'loss' ? 'Lý do (bắt buộc)' : 'Ghi chú', html`<textarea name="note" rows="2" placeholder="${t === 'loss' ? 'VD: ẩm mốc, chuột cắn…' : ''}">${m?.note || ''}</textarea>`)}
    <div class="delta-preview" data-after></div>
    <div class="form-msg" data-msg></div></form>`;
  const read = (f) => {
    const v = formValues(f);
    const input = { id: m?.id, item_id: item.id, type: v.type, date: v.date, note: v.note, expectedVersion: m ? (m.version || 0) : null };
    if (v.type === 'count') input.counted_qty = v.counted_qty === '' ? '' : toDecimal(v.counted_qty, NaN);
    else if (v.use_pack) { input.pack_qty = toDecimal(v.pack_qty, 0); input.pack_size = toDecimal(v.pack_size, 0); }
    else input.qty = toDecimal(v.qty, 0);
    if (v.type === 'purchase') Object.assign(input, { total_cost: v.total_cost === '' ? '' : toMoney(v.total_cost, 0), supplier: v.supplier, finance: v.finance, link_transaction_id: v.link_transaction_id });
    return input;
  };
  openSheet({
    title: `${m ? 'Sửa phiếu' : INV_TYPES[t].label} · ${item.name}`, subtitle: `Đơn vị gốc: ${item.unit}`,
    body: body(),
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu phiếu</button>`,
    onMount: (el, close) => {
      const wire = () => {
        const f = el.querySelector('[data-f]');
        const preview = () => {
          const input = read(f);
          const plan = planInvMovement(s.db, input, s.ctx());
          const out = f.querySelector('[data-after]');
          if (plan.errors.length) { out.innerHTML = String(html`<span class="money-out">${plan.errors[0]}</span>`); return; }
          const after = itemBalance(s.db.inventory_movements.filter((x) => x.id !== plan.record.id).concat(plan.record), item.id);
          out.textContent = `Tồn sau khi lưu: ${num(after)} ${item.unit}${input.type === 'count' ? ` (chênh lệch ${num(after - bal()) > 0 ? '+' : ''}${num(after - bal())})` : ''}`;
        };
        f.addEventListener('input', preview);
        f.addEventListener('change', (e) => {
          if (e.target.matches('[data-type]')) { t = e.target.value; el.querySelector('.sheet-body').innerHTML = String(body()); el.querySelector('.sheet-titles h2').textContent = `${m ? 'Sửa phiếu' : INV_TYPES[t].label} · ${item.name}`; wire(); return; }
          if (e.target.matches('[data-pack]')) { f.querySelector('[data-qty-plain]').classList.toggle('hidden', e.target.checked); f.querySelector('[data-qty-pack]').classList.toggle('hidden', !e.target.checked); }
          if (e.target.matches('[data-fin]')) f.querySelector('[data-link]').classList.toggle('hidden', e.target.value !== 'link');
          preview();
        });
        f.addEventListener('click', (e) => {
          const a = e.target.closest('[data-add-qty]');
          if (!a) return;
          const q = f.querySelector('[name=qty]');
          q.value = String(round3(toDecimal(q.value, 0) + Number(a.dataset.addQty))).replace('.', ',');
          preview();
        });
        preview();
      };
      wire();
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = el.querySelector('[data-f]');
        const input = read(f);
        const need = m ? 'inventory.manage' : ['purchase', 'opening'].includes(input.type) ? 'inventory.purchase' : 'inventory.use';
        const r = await s.run(planInvMovement(s.db, input, s.ctx()), { requires: need });
        if (!r.ok) return showMessages(f.querySelector('[data-msg]'), r.errors);
        toast(`Đã lưu: ${INV_TYPES[input.type].label} ${item.name}`); close();
      }));
    },
  });
}

export function openItemForm(app, id) {
  const s = app.store;
  if (!s.can('inventory.manage')) { toast('Chỉ chủ trại được thêm/sửa vật tư', 'error'); return; }
  const it = id ? s.byId('inventory_items', id) : null;
  openSheet({
    title: it ? `Sửa vật tư · ${it.name}` : 'Thêm vật tư / thức ăn',
    body: html`<form class="form" data-f>
      ${field('Tên', html`<input name="name" value="${it?.name || ''}" placeholder="VD: Hạt kê, Bắp nếp…">`)}
      <div class="grid2">${field('Danh mục', html`<select name="category">${options(INV_CATEGORIES, it?.category || 'Thức ăn')}</select>`)}
        ${field('Đơn vị gốc', html`<input name="unit" list="yp-units" value="${it?.unit || ''}" placeholder="kg, gói, trái…">`, it ? 'Không đổi được khi đã có lịch sử' : 'Mọi số lượng lưu theo đơn vị này')}</div>
      <datalist id="yp-units">${UNITS.map((u) => html`<option value="${u}">`)}</datalist>
      <div class="grid2">${field('Ngưỡng cảnh báo', html`<input name="threshold" inputmode="decimal" value="${it?.threshold ?? ''}" placeholder="VD: 5">`)}
        ${field('Tiêu hao ước tính / ngày', html`<input name="daily_use_estimate" inputmode="decimal" value="${it?.daily_use_estimate ?? ''}" placeholder="tuỳ chọn">`, 'Chỉ để ước tính số ngày còn lại')}</div>
      ${field('Ghi chú', html`<textarea name="note" rows="2">${it?.note || ''}</textarea>`)}
      ${it ? html`<label class="check"><input type="checkbox" name="archived" ${it.archived ? 'checked' : ''}> Lưu trữ (ẩn khỏi danh sách & cảnh báo)</label>` : ''}
      ${it?.needs_review ? html`<label class="check"><input type="checkbox" name="reviewed"> Đã kiểm kê & xác minh số liệu từ App cũ</label>` : ''}
      ${!it ? field('Tồn đầu kỳ (tuỳ chọn)', html`<input name="opening" inputmode="decimal" placeholder="Số lượng đang có">`) : ''}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      const dec = (x) => (x === '' || x == null ? '' : toDecimal(x, NaN));
      const plan = planItemSave(s.db, { ...v, id: it?.id, unit: it && normalizeUnit(v.unit).unit === it.unit ? it.unit : v.unit, threshold: dec(v.threshold) || 0, daily_use_estimate: dec(v.daily_use_estimate), needs_review: v.reviewed ? false : it?.needs_review }, s.ctx());
      if (!it && v.opening !== '' && plan.record) {
        const op = planInvMovement({ ...s.db, inventory_items: [...s.db.inventory_items, plan.record] }, { item_id: plan.record.id, type: 'opening', date: s.today(), qty: dec(v.opening), note: 'Tồn đầu kỳ khi tạo vật tư' }, s.ctx());
        if (op.errors.length) return showMessages(el.querySelector('[data-msg]'), op.errors);
        plan.ops.push(...op.ops);
      }
      const r = await s.run(plan, { requires: 'inventory.manage' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã lưu vật tư'); close();
    })),
  });
}

export { addDays };
