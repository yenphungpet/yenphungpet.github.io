// V2.1 GROUP — giao diện trứng / chim non theo nhóm: dải trên thẻ lồng, bảng của lồng, chuyển lồng, nở / hao hụt / ra ràng,
// hoàn tác, lịch sử nguồn gốc, thanh giai đoạn phát triển. Chỉ hiện khi store.groupsEnabled (trang thử nghiệm).
// Mọi thao tác gửi lên máy chủ (RPC) — máy chủ kiểm tra lại quyền, số lượng, ngưỡng, chống bấm 2 lần.
import { html, raw } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, badge, empty } from '../ui/components.js';
import { fmtDate, fmtDateShort, fmtDateTime, addDays } from '../core/dates.js';
import { byCageCode, clutchTitle } from '../domain/breeding.js';
import {
  cageBrood, planTransfer, newRequestId, ageInfo, stageOf, BROOD_STAGES, STAGE_DISCLAIMER, EGG_CHECK_LABELS, LOSS_REASONS, EVENT_LABELS,
  KIND_LABELS, originText, groupLineage, groupPath, cageEvents, eventText, reverseCheck, clutchHatchRange, INCUBATION_DAYS, BACKDATE_DAYS, backdatedDays,
} from '../domain/brood.js';

const REASONS = ['Cân bằng đàn', 'Gửi ấp hộ', 'Bố mẹ không ấp / không mớm', 'Tách khỏi lồng đông', 'Trả về lồng gốc', 'Khác'];

export function ageChip(age) {
  if (!age || age.basis === 'unknown') return html`<span class="age unk">chưa rõ tuổi</span>`;
  return html`<span class="age ${age.basis === 'known' ? 'known' : 'est'}" title="${age.basis === 'known' ? 'Ngày nở biết chắc' : 'Ước tính — không phải ngày nở chắc chắn'}">${age.text}</span>`;
}

function segLine(s) {
  const g = s.group;
  return html`<li class="brood-seg ${s.own ? 'own' : 'grp'}" ${g ? raw(`data-group="${g.id}"`) : ''}>
    <span class="bs-qty">${s.qty}</span>
    <span class="bs-main"><b>${s.label}</b>${s.own ? html` <span class="muted">(lứa của lồng)</span>` : g?.origin_kind === 'unknown' ? html` ${badge('Chưa rõ nguồn gốc', 'warn')}` : ''}
      <br>${s.kind === 'chick' ? ageChip(s.age) : html`<span class="muted small">${g ? EGG_CHECK_LABELS[g.egg_check] || '' : 'Trứng chờ kết quả'}${g?.laid_date ? ` · đẻ ${fmtDateShort(g.laid_date)}${g.laid_date_to ? `–${fmtDateShort(g.laid_date_to)}` : ''}` : ''}</span>`}</span>
  </li>`;
}

/** Ngoại lệ vượt ngưỡng đang có hiệu lực: ghi chú chăm sóc của lần chuyển vào gần nhất có xác nhận. */
function overNote(db, cageId) {
  return (db.brood_events || []).filter((e) => e.to_cage_id === cageId && e.over_limit && !e.reversed_by && e.type !== 'reverse').sort((a, b) => b.seq - a.seq)[0] || null;
}

/** Dải "Trứng & chim non" trên thẻ lồng. */
export function broodStrip(store, cageId, { counts = true } = {}) {
  if (!store.groupsEnabled) return '';
  const db = store.db; const today = store.today();
  const b = cageBrood(db, cageId, today, store.settings);
  const recent = cageEvents(db, cageId).filter((e) => e.type === 'transfer' && !e.reversed_by && e.event_date >= addDays(today, -7));
  const inN = recent.filter((e) => e.to_cage_id === cageId).reduce((a, e) => a + e.qty, 0);
  const outN = recent.filter((e) => e.from_cage_id === cageId).reduce((a, e) => a + e.qty, 0);
  if (!b.eggs && !b.chicks && !recent.length) return '';
  const ex = b.over ? overNote(db, cageId) : null;
  return html`<div class="brood ${b.over ? 'over' : ''}">
    ${b.over ? html`<div class="brood-alert">${icon('alert')} <div><b>${b.chicks} chim non — vượt ngưỡng ${b.limit} con / lồng</b>
      <br><span class="small">${ex ? html`Ngoại lệ đã xác nhận ${fmtDateShort(ex.event_date)}: “${ex.care_note}”` : 'Chưa có xác nhận ngoại lệ — kiểm tra lồng, theo dõi mớm mồi'}</span></div></div>` : ''}
    <div class="brood-head">${counts ? html`<span>${icon('egg')} <b>${b.eggs}</b> trứng hiện có</span><span>🐣 <b>${b.chicks}</b> chim non hiện có</span>` : html`<span class="small"><b>Gồm:</b></span>`}
      ${b.ageRange ? html`<span class="small">${b.ageRange.min === b.ageRange.max ? `${b.ageRange.min}` : `${b.ageRange.min}–${b.ageRange.max}`} ngày${b.ageRange.estimated ? ' (có ước tính)' : ''}</span>` : ''}
      ${b.ageGap ? badge(`Chênh tuổi ~${b.ageGap} ngày`, 'warn') : ''}
      <span class="grow"></span><button class="btn soft sm" data-act="brood">${icon('swap')} Chuyển / nhóm</button></div>
    ${!counts || b.segments.length + b.eggSegments.length > 1 || b.groupCount ? html`<ul class="brood-segs">${[...b.eggSegments, ...b.segments].map(segLine)}</ul>` : ''}
    ${recent.length ? html`<div class="small muted">7 ngày qua: nhận ${inN} · chuyển đi ${outN}</div>` : ''}
  </div>`;
}

export function eventRow(store, e) {
  const chk = reverseCheck(e, store.db, store.user);
  const by = store.userName(e.created_by) || 'Không rõ';
  const late = backdatedDays(e);
  return html`<div class="tl-item brood-ev ${e.reversed_by ? 'reversed' : ''}">
    <div class="tl-head"><b>${fmtDate(e.event_date)}</b>${late ? badge(`Ghi lùi ${late} ngày`, 'warn') : ''}${badge(EVENT_LABELS[e.type], e.type === 'reverse' ? 'muted' : e.type === 'loss' ? 'danger' : 'info')}
      ${e.over_limit ? badge(`Ngoại lệ ${e.chicks_after} con`, 'danger') : ''}${e.reversed_by ? badge('Đã hoàn tác', 'muted') : ''}<span class="grow"></span>
      ${chk.ok && store.can('breeding.write') ? html`<button class="btn ghost sm" data-reverse="${e.id}">${icon('history')} Hoàn tác</button>` : ''}</div>
    <div>${eventText(e, store.db)}</div>
    ${e.reason ? html`<div class="small">Lý do: ${e.reason}</div>` : ''}
    ${e.note ? html`<div class="tl-note">${e.note}</div>` : ''}
    ${e.care_note ? html`<div class="tl-note">Chăm sóc: ${e.care_note}</div>` : ''}
    <div class="tl-meta">Ngày thao tác ${fmtDate(e.event_date)} · <b>nhập thực tế lúc ${fmtDateTime(e.created_at)}</b> · ${by}</div>
  </div>`;
}

/** Bảng "Trứng & chim non" của 1 lồng (chi tiết lồng + sheet từ thẻ). */
export function broodPanel(store, cageId) {
  const db = store.db; const today = store.today();
  const b = cageBrood(db, cageId, today, store.settings);
  const canW = store.can('breeding.write');
  const seg = (s) => {
    const g = s.group;
    const src = g ? `group:${g.id}` : `clutch:${s.clutch.id}:${s.kind}`;
    return html`<div class="row brood-row"><span class="row-icon ${s.kind === 'egg' ? 'gold' : 'green'}">${s.kind === 'egg' ? icon('egg') : raw('🐣')}</span>
      <span class="grow"><span class="title">${s.qty} ${KIND_LABELS[s.kind]} · ${s.label}</span>${g?.origin_kind === 'unknown' ? html` ${badge('Chưa rõ nguồn gốc', 'warn')}` : ''}<br>
        ${s.kind === 'chick' ? html`${ageChip(s.age)}${s.age.basis !== 'unknown' ? html` · <span class="small">${stageOf(s.age.max)?.label}</span>` : ''}` : html`<span class="small muted">${g ? EGG_CHECK_LABELS[g.egg_check] : 'Trứng chờ kết quả của lứa'}</span>`}
        ${g ? html`<br><span class="desc">${originText(g, db, (id) => store.birdName(id))}</span>` : ''}</span>
      <span class="brood-acts">
        ${canW ? html`<button class="btn soft sm" data-transfer="${src}">${icon('swap')} Chuyển</button>` : ''}
        ${canW && g?.kind === 'egg' ? html`<button class="btn soft sm" data-gact="hatch" data-id="${g.id}">Ghi nở</button>` : ''}
        ${canW && g?.kind === 'chick' ? html`<button class="btn soft sm" data-gact="fledge" data-id="${g.id}">Ra ràng</button>` : ''}
        ${canW && g ? html`<button class="btn ghost sm" data-gact="loss" data-id="${g.id}">Hao hụt</button>` : ''}
        ${g ? html`<button class="btn ghost sm" data-gact="detail" data-id="${g.id}">${icon('info')} Nguồn gốc</button>` : ''}
        ${s.kind === 'chick' ? html`<button class="btn ghost sm" data-stage="${s.age.basis === 'unknown' ? '' : `${s.age.min}-${s.age.max}-${s.age.basis}`}">Giai đoạn</button>` : ''}
      </span></div>`;
  };
  const events = cageEvents(db, cageId).slice(0, 30);
  return html`
    ${b.over ? html`<div class="brood-alert big">${icon('alert')} <div><b>${b.chicks} chim non — vượt ngưỡng ${b.limit} con / lồng.</b> Theo dõi mớm mồi, chỗ nằm, cân nặng; cân nhắc an toàn trước khi chuyển thêm.</div></div>` : ''}
    ${b.ageGap ? html`<div class="msg warn">${icon('alert')} Các nhóm trong lồng chênh tuổi khoảng ${b.ageGap} ngày (theo dữ liệu tuổi đã ghi) — chim nhỏ có thể bị chèn ép khi ăn.</div>` : ''}
    <div class="card"><div class="list">
      ${[...b.eggSegments, ...b.segments].length ? [...b.eggSegments, ...b.segments].map(seg) : html`<p class="muted" style="margin:4px 0">Lồng chưa có trứng / chim non.</p>`}
    </div>
    ${canW ? html`<div class="btn-row" style="margin-top:10px"><button class="btn ghost sm" data-gact="create">${icon('plus')} Ghi nhận nhóm đang có trong lồng</button>
      <button class="btn ghost sm" data-stage="">Xem các giai đoạn phát triển</button></div>` : ''}
    <p class="def">Số của lứa lấy từ nhật ký (“Cập nhật hôm nay”). Trứng / chim non nhận từ lồng khác là NHÓM riêng — không cộng vào nhật ký lứa của lồng này, nên không bị tính 2 lần.</p></div>
    <div class="section"><h2>Lịch sử chuyển & nhóm</h2></div>
    ${events.length ? html`<div class="timeline">${events.map((e) => eventRow(store, e))}</div>` : empty('Chưa có thao tác chuyển nào.')}`;
}

export function bindBroodPanel(root, app, cageId) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-transfer]');
    if (t) return openTransferForm(app, cageId, t.dataset.transfer);
    const a = e.target.closest('[data-gact]');
    if (a) {
      const k = a.dataset.gact;
      if (k === 'create') return openCreateGroup(app, cageId);
      if (k === 'detail') return openGroupDetail(app, a.dataset.id);
      return openGroupAction(app, a.dataset.id, k);
    }
    const r = e.target.closest('[data-reverse]');
    if (r) return openReverse(app, r.dataset.reverse);
    const s = e.target.closest('[data-stage]');
    if (s) { const [min, max, basis] = (s.dataset.stage || '').split('-'); return openStageViewer(app, s.dataset.stage ? { min: +min, max: +max, basis } : null); }
  });
}

export function openBroodSheet(app, cageId) {
  const cage = app.store.byId('cages', cageId);
  openSheet({
    title: `Trứng & chim non · ${cage.code}`, subtitle: 'Theo nhóm — không cần mã từng con', size: 'wide',
    body: html`<div data-brood-panel>${broodPanel(app.store, cageId)}</div>`,
    onMount: (el) => {
      bindBroodPanel(el, app, cageId);
      const off = app.store.subscribe(() => { const p = el.querySelector('[data-brood-panel]'); if (p) p.innerHTML = String(broodPanel(app.store, cageId)); else off(); });
    },
  });
}

// ---------- Chuyển lồng ----------
export function openTransferForm(app, cageId, sourceKey) {
  const store = app.store; const db = store.db; const today = store.today();
  const cage = store.byId('cages', cageId);
  const requestId = newRequestId(); // giữ nguyên khi bấm lại ⇒ máy chủ không ghi trùng
  const b = cageBrood(db, cageId, today, store.settings);
  const sources = [
    ...b.parts.flatMap((p) => [
      ...(p.own?.eggs ? [[`clutch:${p.clutch.id}:egg`, `${p.own.eggs} trứng chờ kết quả · ${clutchTitle(p.clutch)}`]] : []),
      ...(p.own?.chicks ? [[`clutch:${p.clutch.id}:chick`, `${p.own.chicks} chim non · ${clutchTitle(p.clutch)}`]] : []),
    ]),
    ...[...b.eggSegments, ...b.segments].filter((s) => s.group).map((s) => [`group:${s.group.id}`, `${s.qty} ${KIND_LABELS[s.kind]} · ${s.label}${s.kind === 'chick' ? ` · ${s.age.text}` : ''}`]),
  ];
  if (!sources.length) { toast('Lồng không có trứng / chim non để chuyển', 'warn'); return; }
  let src = sources.some(([k]) => k === sourceKey) ? sourceKey : sources[0][0];
  const targets = db.cages.filter((c) => !c.archived && !c.deleted && c.id !== cageId).sort(byCageCode)
    .map((c) => { const t = cageBrood(db, c.id, today, store.settings); return [c.id, `${c.code} · ${t.chicks} chim non${t.eggs ? ` · ${t.eggs} trứng` : ''}`]; });
  const fromClutch = (k) => k.startsWith('clutch:');
  const clutchIdOf = (k) => k.slice(7, k.lastIndexOf(':'));
  const sourceOf = (k) => (k.startsWith('group:') ? { group_id: k.slice(6) } : { clutch_id: clutchIdOf(k), kind: k.slice(k.lastIndexOf(':') + 1) });
  // Tuổi ước tính theo nhật ký của lứa chim non đang chọn ban đầu
  const hintClutch = b.parts.find((p) => p.clutch.id === clutchIdOf(src) && fromClutch(src))?.clutch || b.parts.find((p) => p.own?.chicks)?.clutch || b.clutch;
  const hint = hintClutch ? clutchHatchRange(db, hintClutch) : null;
  const kindOf = (k) => (fromClutch(k) ? k.slice(k.lastIndexOf(':') + 1) : db.brood_groups.find((g) => g.id === k.slice(6))?.kind);
  const read = (el) => {
    const v = formValues(el.querySelector('[data-tf]'));
    const input = { request_id: requestId, source: sourceOf(v.source), to_cage_id: v.to_cage_id, qty: Number(v.qty), event_date: v.event_date,
      reason: v.reason === 'Khác' ? v.reason_other : v.reason, note: v.note, confirm_over_limit: !!v.confirm, care_note: v.care_note };
    if (fromClutch(v.source) && kindOf(v.source) === 'chick') {
      if (v.age === 'log' && hint) Object.assign(input, { hatch_date: hint.hatch_date, hatch_date_to: hint.hatch_date_to, hatch_basis: 'estimated' });
      if (v.age === 'known' && v.hatch_known) Object.assign(input, { hatch_date: v.hatch_known, hatch_basis: 'known' });
      if (v.age === 'est' && v.hatch_from) Object.assign(input, { hatch_date: v.hatch_from, hatch_date_to: v.hatch_to || null, hatch_basis: 'estimated' });
    }
    if (fromClutch(v.source) && kindOf(v.source) === 'egg') Object.assign(input, { egg_check: v.egg_check, laid_date: v.laid_date || null });
    return { v, input };
  };
  const check = (el) => {
    const { v, input } = read(el);
    const plan = planTransfer(store.db, input, store.ctx());
    el.querySelector('[data-confirm]').classList.toggle('hidden', !plan.needConfirm);
    el.querySelector('[data-age]').classList.toggle('hidden', !(fromClutch(v.source) && kindOf(v.source) === 'chick'));
    el.querySelector('[data-eggf]').classList.toggle('hidden', !(fromClutch(v.source) && kindOf(v.source) === 'egg'));
    el.querySelector('[data-other]').classList.toggle('hidden', v.reason !== 'Khác');
    const q = el.querySelector('[name=qty]'); q.max = plan.available || 1;
    el.querySelector('[data-avail]').textContent = plan.available !== undefined ? `Đang có ${plan.available} ${KIND_LABELS[plan.kind] || ''}` : '';
    showMessages(el.querySelector('[data-check]'), [], plan.warnings);
    return plan;
  };
  openSheet({
    title: `Chuyển từ ${cage.code}`, subtitle: 'Số lượng do máy chủ trừ / cộng — không cần sửa nhật ký', size: 'wide',
    body: html`<form class="form" data-tf novalidate>
      ${field('Chuyển gì', html`<select name="source">${options(Object.fromEntries(sources), src)}</select>`)}
      <div class="grid2">
        ${field('Số lượng', html`<input type="number" name="qty" value="1" min="1" step="1" inputmode="numeric" required>`, raw('<span data-avail></span>'))}
        ${field('Ngày chuyển', html`<input type="date" name="event_date" value="${today}" max="${today}" min="${addDays(today, -BACKDATE_DAYS)}">`)}
      </div>
      ${field('Lồng nhận', html`<select name="to_cage_id"><option value="">— Chọn lồng —</option>${options(Object.fromEntries(targets), '')}</select>`, 'Số trong ngoặc: chim non / trứng đang có ở lồng nhận.')}
      <fieldset class="fieldset" data-age><legend>Tuổi chim non chuyển đi</legend>
        <label class="check"><input type="radio" name="age" value="none" ${hint ? '' : 'checked'}> Không ghi (chưa rõ tuổi)</label>
        ${hint ? html`<label class="check"><input type="radio" name="age" value="log" checked> Ước tính theo nhật ký lứa: nở trong khoảng ${fmtDate(hint.hatch_date)} – ${fmtDate(hint.hatch_date_to)}</label>` : ''}
        <label class="check"><input type="radio" name="age" value="est"> Ước tính khoảng ngày nở</label>
        <div class="grid2">${field('Từ ngày', html`<input type="date" name="hatch_from" max="${today}">`)}${field('Đến ngày', html`<input type="date" name="hatch_to" max="${today}">`)}</div>
        <label class="check"><input type="radio" name="age" value="known"> Biết chắc ngày nở (đã quan sát)</label>
        ${field('Ngày nở', html`<input type="date" name="hatch_known" max="${today}">`)}
        <p class="small muted" style="margin:0">App không tự đoán ngày nở. Chọn "biết chắc" chỉ khi đã thấy ngày nở thật.</p>
      </fieldset>
      <fieldset class="fieldset" data-eggf><legend>Trứng chuyển đi</legend>
        ${field('Trạng thái soi', html`<select name="egg_check">${options(EGG_CHECK_LABELS, 'not_checked')}</select>`, '"Chưa thấy cồ" KHÔNG có nghĩa là không cồ.')}
        ${field('Ngày đẻ (nếu biết)', html`<input type="date" name="laid_date" max="${today}">`)}
      </fieldset>
      ${field('Lý do', html`<select name="reason">${options(REASONS, REASONS[0])}</select>`)}
      <div data-other class="hidden">${field('Lý do khác', html`<input name="reason_other" maxlength="200">`)}</div>
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="1000"></textarea>`)}
      <fieldset class="fieldset brood-confirm hidden" data-confirm><legend>${icon('alert')} Vượt ngưỡng chim non / lồng</legend>
        <label class="check"><input type="checkbox" name="confirm"> Tôi xác nhận ngoại lệ: lồng nhận sẽ vượt ngưỡng</label>
        ${field('Ghi chú chăm sóc (bắt buộc)', html`<textarea name="care_note" rows="2" maxlength="500" placeholder="VD: theo dõi mớm mồi sáng / chiều, bổ sung thức ăn mềm"></textarea>`)}
      </fieldset>
      <div class="form-msg" data-check></div><div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('swap')} Chuyển</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-tf]');
      f.addEventListener('input', () => check(el)); f.addEventListener('change', () => check(el));
      check(el);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const plan = check(el);
        if (plan.errors.length) return showMessages(el.querySelector('[data-msg]'), plan.errors);
        const r = await store.brood('brood_transfer', plan.p);
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        const to = store.byId('cages', plan.p.to_cage_id);
        toast(r.result?.duplicate ? 'Thao tác này đã được lưu trước đó — không ghi trùng' : `Đã chuyển ${plan.p.qty} ${KIND_LABELS[plan.kind]} ${cage.code} → ${to?.code}`);
        close();
      }));
    },
  });
}

// ---------- Ghi nhận nhóm đang có (chưa rõ nguồn gốc / chỉ biết lồng gốc) ----------
export function openCreateGroup(app, cageId) {
  const store = app.store; const today = store.today(); const cage = store.byId('cages', cageId);
  const requestId = newRequestId();
  const others = store.db.cages.filter((c) => !c.deleted && c.id !== cageId).sort(byCageCode).map((c) => [c.id, c.code]);
  openSheet({
    title: `Ghi nhận nhóm ở ${cage.code}`, subtitle: 'Trứng / chim non đã có sẵn trong lồng nhưng không thuộc lứa của lồng',
    body: html`<form class="form" data-cg novalidate>
      <div class="msg info">${icon('info')} Trứng / chim non của LỨA trong lồng đã có trong nhật ký — không ghi nhận lại ở đây (tránh tính 2 lần).</div>
      <div class="grid2">${field('Loại', html`<select name="kind">${options({ chick: 'Chim non', egg: 'Trứng' }, 'chick')}</select>`)}
        ${field('Số lượng', html`<input type="number" name="qty" value="1" min="1" max="50" inputmode="numeric">`)}</div>
      ${field('Nguồn gốc', html`<select name="origin_kind">${options({ unknown: 'Chưa rõ nguồn gốc', cage: 'Biết lồng gốc (chưa rõ lứa)' }, 'unknown')}</select>`)}
      ${field('Lồng gốc', html`<select name="origin_cage_id"><option value="">—</option>${options(Object.fromEntries(others), '')}</select>`)}
      ${field('Ghi chú nguồn gốc / hoàn cảnh', html`<textarea name="origin_note" rows="2" maxlength="500" placeholder="VD: có sẵn trước khi dùng app, nhận từ trại bạn…"></textarea>`, 'Bắt buộc khi chưa rõ nguồn gốc.')}
      ${field('Tuổi (chim non)', html`<select name="age">${options({ none: 'Chưa rõ tuổi', est: 'Ước tính khoảng ngày nở', known: 'Biết chắc ngày nở' }, 'none')}</select>`)}
      <div class="grid2">${field('Ngày nở / từ ngày', html`<input type="date" name="hatch_from" max="${today}">`)}${field('Đến ngày (ước tính)', html`<input type="date" name="hatch_to" max="${today}">`)}</div>
      ${field('Trạng thái soi (trứng)', html`<select name="egg_check">${options(EGG_CHECK_LABELS, 'not_checked')}</select>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Ghi nhận</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-cg]'));
      const p = { request_id: requestId, kind: v.kind, cage_id: cageId, qty: Number(v.qty), origin_kind: v.origin_kind, origin_note: v.origin_note,
        ...(v.origin_kind === 'cage' ? { origin_cage_id: v.origin_cage_id } : {}),
        ...(v.kind === 'egg' ? { egg_check: v.egg_check } : {}),
        ...(v.kind === 'chick' && v.age !== 'none' && v.hatch_from ? { hatch_date: v.hatch_from, hatch_date_to: v.age === 'est' ? (v.hatch_to || null) : null, hatch_basis: v.age === 'known' ? 'known' : 'estimated' } : {}) };
      const errs = [];
      if (!Number.isInteger(p.qty) || p.qty < 1) errs.push('Số lượng phải từ 1');
      if (v.origin_kind === 'cage' && !v.origin_cage_id) errs.push('Chọn lồng gốc');
      if (v.origin_kind === 'unknown' && String(v.origin_note || '').trim().length < 3) errs.push('Ghi chú hoàn cảnh (≥ 3 ký tự) khi chưa rõ nguồn gốc');
      if (errs.length) return showMessages(el.querySelector('[data-msg]'), errs);
      const r = await store.brood('brood_create', p);
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast(`Đã ghi nhận nhóm ${p.qty} ${KIND_LABELS[p.kind]} ở ${cage.code}`);
      close();
    })),
  });
}

// ---------- Nở / Hao hụt / Ra ràng ----------
export function openGroupAction(app, groupId, type) {
  const store = app.store; const today = store.today();
  const g = store.db.brood_groups.find((x) => x.id === groupId);
  if (!g || g.status !== 'active') { toast('Nhóm không còn hoạt động', 'warn'); return; }
  const cage = store.byId('cages', g.cage_id);
  const requestId = newRequestId();
  const T = { hatch: ['Ghi nở', `Nhóm ${g.qty} trứng ở ${cage.code}`], loss: ['Ghi hao hụt', `Nhóm ${g.qty} ${KIND_LABELS[g.kind]} ở ${cage.code}`], fledge: ['Ra ràng → lồng phóng', `Nhóm ${g.qty} chim non ở ${cage.code}`] }[type];
  const pens = store.db.flight_pens.filter((p) => !p.archived).map((p) => [p.id, p.name]);
  openSheet({
    title: T[0], subtitle: T[1],
    body: html`<form class="form" data-ga novalidate>
      <div class="grid2">${field('Số lượng', html`<input type="number" name="qty" value="${type === 'fledge' ? g.qty : 1}" min="1" max="${g.qty}" inputmode="numeric">`, `Tối đa ${g.qty}`)}
        ${field('Ngày', html`<input type="date" name="event_date" value="${today}" max="${today}" min="${addDays(today, -BACKDATE_DAYS)}">`)}</div>
      ${type === 'loss' ? field('Lý do', html`<select name="reason">${options(LOSS_REASONS[g.kind], Object.keys(LOSS_REASONS[g.kind])[0])}</select>`) : ''}
      ${type === 'fledge' ? field('Lồng phóng nhận', html`<select name="to_pen_id">${options(Object.fromEntries(pens), pens[0]?.[0])}</select>`) : ''}
      ${type === 'hatch' ? html`<div class="msg info">${icon('info')} Ngày nở ghi là "biết chắc" — chỉ dùng khi đã thấy nở vào ngày đã chọn.</div>` : ''}
      ${field(type === 'loss' ? 'Ghi chú (bắt buộc)' : 'Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="500"></textarea>`, type === 'loss' ? 'Mô tả điều đã thấy. App không tự kết luận nguyên nhân.' : '')}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-ga]'));
      const p = { request_id: requestId, group_id: g.id, qty: Number(v.qty), event_date: v.event_date, note: v.note, ...(type === 'loss' ? { reason: v.reason } : {}), ...(type === 'fledge' ? { to_pen_id: v.to_pen_id } : {}) };
      const errs = [];
      if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > g.qty) errs.push(`Số lượng từ 1 đến ${g.qty}`);
      if (type === 'loss' && String(v.note || '').trim().length < 3) errs.push('Ghi chú bắt buộc khi ghi hao hụt (≥ 3 ký tự)');
      if (errs.length) return showMessages(el.querySelector('[data-msg]'), errs);
      const r = await store.brood({ hatch: 'brood_hatch', loss: 'brood_loss', fledge: 'brood_fledge' }[type], p);
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã lưu');
      close();
    })),
  });
}

export function openReverse(app, eventId) {
  const store = app.store;
  const ev = store.db.brood_events.find((x) => x.id === eventId);
  if (!ev) return;
  const requestId = newRequestId();
  openSheet({
    title: 'Hoàn tác thao tác', subtitle: eventText(ev, store.db),
    body: html`<form class="form" data-rv novalidate>
      <div class="msg info">${icon('info')} Hoàn tác tạo một thao tác ngược lại có lưu vết. Thao tác gốc vẫn còn trong lịch sử (đánh dấu "đã hoàn tác").</div>
      ${field('Lý do hoàn tác (bắt buộc)', html`<textarea name="note" rows="2" maxlength="500" placeholder="VD: chọn nhầm lồng nhận"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn danger" data-save>${icon('history')} Hoàn tác</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-rv]'));
      if (String(v.note || '').trim().length < 3) return showMessages(el.querySelector('[data-msg]'), ['Ghi lý do hoàn tác (≥ 3 ký tự)']);
      const r = await store.brood('brood_reverse', { request_id: requestId, event_id: eventId, note: v.note });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã hoàn tác');
      close();
    })),
  });
}

export function openGroupDetail(app, groupId) {
  const store = app.store; const db = store.db;
  const g = db.brood_groups.find((x) => x.id === groupId);
  if (!g) return;
  const lin = groupLineage(db, g);
  const age = g.kind === 'chick' ? ageInfo(g, store.today()) : null;
  const path = groupPath(db, g);
  openSheet({
    title: `Nhóm ${g.qty} ${KIND_LABELS[g.kind]} · ${store.byId('cages', g.cage_id)?.code}`, subtitle: 'Nguồn gốc & lịch sử (theo nhóm gốc)', size: 'wide',
    body: html`<div class="card"><dl class="kv">
        <dt>Nguồn gốc ban đầu</dt><dd>${originText(lin.root || g, db, (id) => store.birdName(id))}</dd>
        <dt>Đường đi</dt><dd>${path.join(' → ') || '—'}</dd>
        ${age ? html`<dt>Tuổi</dt><dd>${ageChip(age)}${age.basis !== 'unknown' ? html` · ${stageOf(age.max)?.label}` : ''}</dd>` : ''}
        ${g.kind === 'egg' ? html`<dt>Trạng thái soi</dt><dd>${EGG_CHECK_LABELS[g.egg_check] || '—'}</dd><dt>Ngày đẻ</dt><dd>${g.laid_date ? fmtDate(g.laid_date) : 'Chưa ghi nhận'}</dd>` : ''}
        <dt>Cùng nhóm gốc</dt><dd>${Object.entries(lin.groups.filter((x) => x.status === 'active' && x.qty > 0) // gộp theo lồng (1 lồng có thể giữ nhiều nhóm cùng gốc)
          .reduce((a, x) => { const k = `${x.kind === g.kind ? '' : `${KIND_LABELS[x.kind]} `}ở ${store.byId('cages', x.cage_id)?.code || '?'}`; a[k] = (a[k] || 0) + x.qty; return a; }, {}))
          .sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n} ${k}`).join(' · ') || '—'}</dd>
        ${g.care_note ? html`<dt>Chăm sóc</dt><dd>${g.care_note}</dd>` : ''}
      </dl></div>
      <div class="section"><h2>Lịch sử</h2></div>
      <div class="timeline">${lin.events.slice().reverse().map((e) => eventRow(store, e))}</div>`,
    onMount: (el) => el.addEventListener('click', (e) => { const r = e.target.closest('[data-reverse]'); if (r) openReverse(app, r.dataset.reverse); }),
  });
}

// ---------- Giai đoạn phát triển: thanh kéo + SƠ ĐỒ minh hoạ (không phải ảnh thật / ảnh AI) ----------
// Hình vẽ tay đơn giản bằng SVG — CHỈ để gợi nhớ thứ tự giai đoạn. Ảnh chuẩn đã kiểm chứng: chưa có (chờ Henry cung cấp).
export function stageArt(key, size = 120) {
  const body = {
    egg: '<ellipse cx="60" cy="64" rx="26" ry="34" fill="#FFF8E6" stroke="#A86D0C" stroke-width="3"/>',
    hatchling: '<ellipse cx="60" cy="74" rx="30" ry="22" fill="#F7C9C0" stroke="#B9382B" stroke-width="2.5"/><circle cx="80" cy="56" r="13" fill="#F7C9C0" stroke="#B9382B" stroke-width="2.5"/><path d="M76 54h8" stroke="#44524F" stroke-width="2.5" stroke-linecap="round"/><path d="M92 58l7 3-7 2" fill="#F2B53A"/>',
    eyes: '<ellipse cx="60" cy="74" rx="30" ry="22" fill="#F2D3CB" stroke="#B9382B" stroke-width="2.5"/><circle cx="80" cy="56" r="13" fill="#F2D3CB" stroke="#B9382B" stroke-width="2.5"/><circle cx="81" cy="54" r="2.8" fill="#1D2A29"/><path d="M92 58l7 3-7 2" fill="#F2B53A"/>' + [36, 44, 52, 60].map((x) => `<path d="M${x} 58v-8" stroke="#6E7C79" stroke-width="2" stroke-linecap="round"/>`).join(''),
    pins: '<ellipse cx="60" cy="74" rx="30" ry="22" fill="#DCF0EA" stroke="#137370" stroke-width="2.5"/><circle cx="80" cy="56" r="13" fill="#E2F3E2" stroke="#137370" stroke-width="2.5"/><circle cx="81" cy="54" r="2.8" fill="#1D2A29"/><path d="M92 58l7 3-7 2" fill="#F2B53A"/>' + [32, 40, 48, 56, 64].map((x) => `<path d="M${x} 60l-3-10M${x + 4} 60l3-10" stroke="#3A9D5D" stroke-width="2" stroke-linecap="round"/>`).join(''),
    feathered: '<ellipse cx="58" cy="72" rx="32" ry="22" fill="#3A9D5D"/><path d="M30 70q20-18 46-6-18 14-46 6z" fill="#2C7D47"/><circle cx="82" cy="54" r="14" fill="#F2B53A"/><circle cx="84" cy="52" r="2.8" fill="#1D2A29"/><path d="M95 56l7 3-7 3" fill="#A86D0C"/>',
    fledgling: '<ellipse cx="58" cy="66" rx="28" ry="20" fill="#3A9D5D"/><path d="M34 72l-18 22 26-14z" fill="#2C7D47"/><path d="M36 62q18-14 40-4-16 12-40 4z" fill="#2C7D47"/><circle cx="80" cy="48" r="13" fill="#F2B53A"/><circle cx="82" cy="46" r="2.6" fill="#1D2A29"/><path d="M92 50l7 3-7 3" fill="#A86D0C"/><path d="M52 86v14M64 86v14" stroke="#A86D0C" stroke-width="3"/><path d="M40 102h40" stroke="#6E7C79" stroke-width="3"/>',
    weaning: '<ellipse cx="54" cy="62" rx="28" ry="19" fill="#3A9D5D"/><path d="M30 66l-18 22 26-14z" fill="#2C7D47"/><path d="M32 58q18-14 40-4-16 12-40 4z" fill="#2C7D47"/><circle cx="78" cy="58" r="13" fill="#F2B53A"/><circle cx="80" cy="55" r="2.6" fill="#1D2A29"/><path d="M88 64l6 6-8-1" fill="#A86D0C"/><path d="M48 80v14M60 80v14" stroke="#A86D0C" stroke-width="3"/><path d="M70 98h40" stroke="#6E7C79" stroke-width="3"/>' + [92, 98, 104].map((x) => `<ellipse cx="${x}" cy="94" rx="2.5" ry="1.8" fill="#D9971C"/>`).join(''),
  }[key] || '';
  return raw(`<svg class="stage-art" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="Sơ đồ minh hoạ — không phải ảnh thật">${body}<text x="60" y="116" text-anchor="middle" font-size="9" fill="#6E7C79">SƠ ĐỒ</text></svg>`);
}

/** age: { min, max, basis } của nhóm (null = chỉ xem các giai đoạn). */
export function openStageViewer(app, age = null) {
  const MAX = 45;
  const start = age ? Math.min(MAX, age.max) : 0;
  const render = (day) => {
    const st = stageOf(day);
    const band = age ? `left:${(Math.min(age.min, MAX) / MAX) * 100}%;width:${Math.max(1.5, ((Math.min(age.max, MAX) - Math.min(age.min, MAX)) / MAX) * 100)}%` : '';
    return html`<div class="stage-view">
      <div class="stage-pic">${stageArt(st.key, 150)}</div>
      <div class="stage-txt"><div class="stage-day">Ngày ${day} sau nở</div><h3>${st.label}</h3><p>${st.desc}</p>
        <p class="small muted">Mốc tham khảo: ngày ${st.from}–${st.to}</p></div>
    </div>
    <div class="stage-track">
      ${BROOD_STAGES.map((s) => raw(`<span class="stage-tick" style="left:${(s.from / MAX) * 100}%">${s.from}</span>`))}
      ${age ? raw(`<span class="stage-band ${age.basis === 'known' ? 'known' : 'est'}" style="${band}" title="${age.basis === 'known' ? 'Tuổi thật (biết chắc ngày nở)' : 'Khoảng tuổi ƯỚC TÍNH'}"></span>`) : ''}
    </div>`;
  };
  openSheet({
    title: 'Giai đoạn phát triển chim non', subtitle: age ? (age.basis === 'known' ? `Tuổi thật: ${age.max} ngày (biết chắc ngày nở)` : `Tuổi ƯỚC TÍNH: ${age.min}–${age.max} ngày`) : 'Kéo thanh để xem từng giai đoạn', size: 'wide',
    body: html`<div class="stage-wrap"><div data-stage-body>${render(start)}</div>
      <input type="range" class="stage-range" min="0" max="${MAX}" value="${start}" step="1" aria-label="Ngày sau nở" data-range>
      <div class="stage-legend">${age ? html`<span><i class="lg ${age.basis === 'known' ? 'known' : 'est'}"></i> ${age.basis === 'known' ? 'Tuổi thật của nhóm (vạch liền)' : 'Khoảng tuổi ước tính của nhóm (vạch gạch)'}</span>` : ''}
        <span>Trứng: ấp khoảng ${INCUBATION_DAYS} ngày (tham khảo)</span></div>
      <div class="msg warn">${icon('alert')} <div>${STAGE_DISCLAIMER}<br><b>Ảnh chuẩn đã kiểm chứng: chưa có</b> — sẽ thay sơ đồ khi Henry cung cấp ảnh thật của trại.</div></div>
      <div class="stage-all">${BROOD_STAGES.map((s) => html`<div class="stage-mini">${stageArt(s.key, 64)}<b>${s.label}</b><span class="small muted">ngày ${s.from}–${s.to}</span></div>`)}</div></div>`,
    onMount: (el) => {
      const r = el.querySelector('[data-range]');
      r.addEventListener('input', () => { el.querySelector('[data-stage-body]').innerHTML = String(render(Number(r.value))); });
    },
  });
}
