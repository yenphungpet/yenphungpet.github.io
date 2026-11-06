// V2.2.2 — Thêm lứa, số thứ tự lứa theo cặp, báo cáo lứa, lịch sử các lứa của cặp.
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, stepper, showMessages, formValues, busy, toast, badge, empty } from '../ui/components.js';
import { fmtDate } from '../core/dates.js';
import { fmtPct } from '../core/format.js';
import { currentPair, nextClutchSeq, planAddClutch, planSetClutchSeq, clutchTitle, logsOfClutch, STAGE_LABELS, clutchSummary } from '../domain/breeding.js';
import { clutchReport, reportEdited, pairHistory, END_REASON_LABELS } from '../domain/clutch-report.js';
import { openDailyForm, openCloseClutch, openNoPairNotice } from './breeding-forms.js';
import { openEditHistory } from './edit-history.js';

const pairText = (store, pair) => (pair ? `♂ ${store.birdName(pair.male_id)} × ♀ ${store.birdName(pair.female_id)}` : 'Chưa ghi nhận');
const rateText = (v) => (v === null ? 'Chưa đủ dữ liệu' : fmtPct(v));

function seqFields(value, reason) {
  return html`${field('Số thứ tự lứa của cặp', html`<input type="number" name="pair_seq" min="1" step="1" inputmode="numeric" value="${value ?? ''}" ${value ? '' : 'disabled'}>`, 'Tính theo cặp bố mẹ, kể cả khi đổi lồng. Đổi một con là cặp mới, đếm lại từ đầu.')}
    <label class="check"><input type="checkbox" name="unknown" ${value ? '' : 'checked'} data-seq-unknown> Chưa xác định</label>
    ${reason ? html`<p class="small muted">${reason}</p>` : ''}`;
}

function bindSeq(el) {
  const box = el.querySelector('[data-seq-unknown]');
  const input = el.querySelector('[name=pair_seq]');
  box.addEventListener('change', () => { input.disabled = box.checked; if (!box.checked) input.focus(); });
}

/** + Thêm lứa sinh sản. Không bắt buộc kết thúc lứa trước; không tự chuyển chim hay đổi lứa đang mở. */
export function openAddClutch(app, cageId) {
  const store = app.store; const today = store.today(); const cage = store.byId('cages', cageId);
  const pair = currentPair(store.db.pairs, cageId);
  if (!pair) { openNoPairNotice(app, cageId); return; }
  const next = nextClutchSeq(store.db, pair);
  openSheet({
    title: `Thêm lứa sinh sản · ${cage.code}`, subtitle: pairText(store, pair),
    body: html`<form class="form" data-ac novalidate>
      ${seqFields(next.seq, next.reason)}
      <div class="grid2">${field('Ngày bắt đầu ghi nhận', html`<input type="date" name="start_date" value="${today}" max="${today}">`)}
        ${field('Ngày đẻ trứng đầu tiên', html`<input type="date" name="first_egg_date" max="${today}">`, 'Nếu biết')}</div>
      ${stepper('eggs', 'Trứng đang có của lứa mới', 0, { hint: 'Tuỳ chọn, ghi sau cũng được' })}
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="2000"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu lứa mới</button>`,
    onMount: (el, close) => {
      bindSeq(el);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(el.querySelector('[data-ac]'));
        const plan = planAddClutch(store.db, cageId, { ...v, unknown: !!v.unknown }, store.ctx());
        if (plan.errors.length) return showMessages(el.querySelector('[data-msg]'), plan.errors);
        const r = await store.run(plan, { requires: 'breeding.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(`Đã thêm ${clutchTitle(plan.record)} ở ${cage.code}`);
        close();
      }));
    },
  });
}

/** Chủ trại xác nhận số thứ tự của lứa đã có. */
export function openSetClutchSeq(app, clutchId, then) {
  const store = app.store; const c = store.byId('clutches', clutchId);
  if (!store.can('clutch.edit')) { toast('Chỉ chủ trại được xác nhận số thứ tự lứa', 'error'); return; }
  openSheet({
    title: `Số thứ tự lứa · ${c.code}`, subtitle: pairText(store, store.byId('pairs', c.pair_id)),
    body: html`<form class="form" data-sq novalidate>${seqFields(c.pair_seq, c.pair_seq ? '' : 'Chỉ xác nhận khi đã biết chắc. Chưa biết thì giữ "Chưa xác định".')}<div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      bindSeq(el);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(el.querySelector('[data-sq]'));
        const r = await store.run(planSetClutchSeq(store.db, clutchId, { ...v, unknown: !!v.unknown }, store.ctx()), { requires: 'clutch.edit' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu số thứ tự lứa');
        close();
        then?.();
      }));
    },
  });
}

/** Báo cáo của 1 lứa. Xem được cả khi lứa đang mở lẫn đã kết thúc. */
export function openClutchReport(app, clutchId) {
  const store = app.store; const db = store.db;
  const c = store.byId('clutches', clutchId);
  if (!c) { toast('Không tìm thấy lứa', 'error'); return; }
  const r = clutchReport(db, c);
  const owner = store.can('clutch.edit');
  const canW = store.can('breeding.write');
  const closed = c.status === 'closed';
  const rows = [
    ['Tổng số trứng đã đẻ', r.eggsLaid], ['Trứng được xác nhận có cồ', r.fertile], ['Trứng nở thành công', r.hatched],
    ['Trứng vỡ / hỏng', r.eggsDamaged], ['Trứng không cồ', r.eggsInfertile], ...(closed ? [] : [['Trứng còn chờ kết quả', r.eggsPending], ['Chim non hiện tại', r.chicksNow]]),
    ['Chim non chết / mất', r.chicksDead], ['Chim ra ràng', r.fledged], ['Chuyển sang lồng phóng', r.toPens],
    ['Chuyển sang tổ khác', r.movedOut], ['Nhận từ tổ khác', r.movedIn], [closed ? 'Sống đến khi kết thúc lứa' : 'Đang sống', r.alive],
  ];
  openSheet({
    title: `${clutchTitle(c)} · ${closed ? 'Báo cáo kết thúc' : 'Đang theo dõi'}`, subtitle: `${c.code} · ${store.byId('cages', c.cage_id)?.code || ''}`,
    body: html`<div data-report>
      <dl class="kv">
        <dt>Số thứ tự lứa</dt><dd>${c.pair_seq ? c.pair_seq : 'Chưa xác định'}${owner ? html` <button class="btn soft sm" data-seq>${icon('edit')} Xác nhận</button>` : ''}</dd>
        <dt>Cặp bố mẹ</dt><dd>${pairText(store, store.byId('pairs', c.pair_id))}</dd>
        <dt>Bắt đầu</dt><dd>${fmtDate(c.start_date)}${c.legacy_inferred ? ' (mốc theo dõi, không phải ngày đẻ)' : ''}</dd>
        ${c.first_egg_date ? html`<dt>Trứng đầu tiên</dt><dd>${fmtDate(c.first_egg_date)}</dd>` : ''}
        <dt>Kết thúc</dt><dd>${c.end_date ? `${fmtDate(c.end_date)}${END_REASON_LABELS[c.end_reason] ? ` · ${END_REASON_LABELS[c.end_reason]}` : ''}` : 'Đang mở'}</dd>
        ${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
        <dt>Tỷ lệ có cồ</dt><dd>${rateText(r.fertilityRate)}</dd><dt>Tỷ lệ nở</dt><dd>${rateText(r.hatchRate)}</dd><dt>Tỷ lệ ra ràng</dt><dd>${rateText(r.fledgeRate)}</dd>
      </dl>
      ${r.unaccounted ? html`<div class="msg warn">${icon('alert')} <div>${r.unaccounted} chim non chưa khớp, chưa được ghi là chết hay mất. Hãy đối chiếu.</div></div>` : ''}
      ${r.legacy ? html`<p class="def">Lứa này suy từ dữ liệu V1 nên số trứng là ước lượng, không tính tỷ lệ.</p>` : ''}
      ${r.reasons.length ? html`<div class="field"><span>Nguyên nhân hao hụt</span><ul class="sc-losses">${r.reasons.map((x) => html`<li><b>${x.qty}</b> ${x.label}</li>`)}</ul></div>` : ''}
      ${c.close_note ? html`<div class="field"><span>Ghi chú khi kết thúc</span><p class="small" style="white-space:pre-line">${c.close_note}</p></div>` : ''}
      ${reportEdited(db, c) ? html`<p class="small muted">Số liệu đã được chủ trại sửa sau khi kết thúc lứa. Xem Lịch sử sửa.</p>` : ''}
    </div>`,
    footer: html`${owner ? html`<button class="btn ghost" data-audit-clutch>${icon('history')} Lịch sử sửa</button>` : ''}
      ${closed && owner ? html`<button class="btn soft" data-edit-numbers>${icon('edit')} Sửa số liệu</button>` : ''}
      ${!closed && canW ? html`<button class="btn soft" data-finish>${icon('check')} Kết thúc lứa</button>` : ''}
      <button class="btn ghost" data-close>Đóng</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-seq]')?.addEventListener('click', () => { close(); openSetClutchSeq(app, clutchId, () => openClutchReport(app, clutchId)); });
      el.querySelector('[data-audit-clutch]')?.addEventListener('click', () => openEditHistory(app, 'clutches', clutchId));
      el.querySelector('[data-finish]')?.addEventListener('click', () => { close(); openCloseClutch(app, clutchId); });
      el.querySelector('[data-edit-numbers]')?.addEventListener('click', () => {
        const last = logsOfClutch(db.daily_logs, clutchId).pop();
        if (!last) { toast('Lứa chưa có nhật ký để sửa', 'warn'); return; }
        close();
        openDailyForm(app, c.cage_id, { logId: last.id });
      });
    },
  });
}

function clutchRow(store, clutch, showCage) {
  const r = clutchReport(store.db, clutch);
  const closed = clutch.status === 'closed';
  const sm = clutchSummary(clutch, store.db.daily_logs);
  return html`<button type="button" class="row sc-pick" data-clutch-report="${clutch.id}"><span class="row-icon gold">${icon('egg')}</span><span class="grow">
    <span class="title">${clutchTitle(clutch)}</span> ${badge(STAGE_LABELS[sm.stage], closed ? 'muted' : 'warn')}${clutch.pair_seq ? '' : badge('Chưa xác định số', 'muted')}<br>
    <span class="desc">${showCage ? `${store.byId('cages', clutch.cage_id)?.code || ''} · ` : ''}${fmtDate(clutch.start_date)} → ${clutch.end_date ? fmtDate(clutch.end_date) : 'nay'}</span><br>
    <span class="desc num">Trứng ${r.eggsLaid} · có cồ ${r.fertile} · nở ${r.hatched} · ra ràng ${r.fledged}${r.chicksDead ? ` · chết ${r.chicksDead}` : ''}</span></span>${icon('chevron')}</button>`;
}

/** Các lứa của cặp đang ở lồng (qua mọi lồng), rồi các lứa của cặp trước đó ở lồng này. */
export function clutchesPanel(store, cageId) {
  const db = store.db;
  const pair = currentPair(db.pairs, cageId);
  const hist = pair ? pairHistory(db, pair) : null;
  const seen = new Set(hist ? hist.rows.map((x) => x.clutch.id) : []);
  const others = db.clutches.filter((c) => c.cage_id === cageId && !c.deleted && !seen.has(c.id)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (!hist?.rows.length && !others.length) return empty('Lồng chưa có lứa nào.');
  return html`
    ${hist?.rows.length ? html`<div class="section"><h2>Cặp hiện tại · ${hist.total.clutches} lứa</h2></div>
      <p class="small muted">${pairText(store, pair)}</p>
      <p class="small num">Tổng: ${hist.total.eggs} trứng · nở ${hist.total.hatched} · ra ràng ${hist.total.fledged} · chết / mất ${hist.total.dead} · đã kết thúc ${hist.total.closed}/${hist.total.clutches} lứa</p>
      <div class="card"><div class="list">${hist.rows.slice().reverse().map((x) => clutchRow(store, x.clutch, x.clutch.cage_id !== cageId))}</div></div>` : ''}
    ${others.length ? html`<div class="section"><h2>Cặp trước đó ở lồng này</h2></div>
      <div class="card"><div class="list">${others.map((c) => clutchRow(store, c, false))}</div></div>` : ''}`;
}

export function bindClutchesPanel(root, app) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clutch-report]');
    if (b) openClutchReport(app, b.dataset.clutchReport);
  });
}
