// V2.2 — Thẻ lồng thông minh: thẻ thu gọn / mở rộng, sắp xếp theo tình trạng kiểm tra, soi trứng, hao hụt, thêm, chỉnh ngày tham chiếu, tách mẹ.
// Chỉ hiện khi store.smartCards. Chuyển lồng, ghi nở nhóm, ra ràng, hoàn tác, nguồn gốc dùng lại nguyên biểu mẫu V2.1.
// Mọi thay đổi gửi lên máy chủ; thẻ chỉ đổi sau khi lưu thành công.
import { html, raw } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, sheetOpen, field, stepper, options, showMessages, formValues, busy, toast, badge, empty } from '../ui/components.js';
import { cageArt } from '../ui/brand.js';
import { fmtDate, fmtDateShort, fmtDateTime, relativeDays, addDays, daysBetween } from '../core/dates.js';
import { CAGE_STATUS_LABELS, clutchTitle } from '../domain/breeding.js';
import { cageBrood, cageEvents, chickLimit, KIND_LABELS, LOSS_REASONS, newRequestId, originText, BACKDATE_DAYS } from '../domain/brood.js';
import { flightPens } from '../domain/stock.js';
import {
  fosterState, eggBreakdown, progressBars, lossSummary, clutchQuality, needsCheck, smartSort, checkCounter, planQuickAdd,
  EGG_MIN_DAYS, EGG_MAX_DAYS, CHICK_SCALE_DAYS,
} from '../domain/smart-cards.js';
import { openDailyForm, openNoPairNotice } from './breeding-forms.js';
import { eventRow, openTransferForm, openCreateGroup, openGroupAction, openGroupDetail, openReverse, openBroodSheet } from './brood-ui.js';
import { openAddClutch, openClutchReport } from './clutch-ui.js';
import { openCloseClutch } from './breeding-forms.js';
import { noteBlock, bindNoteActions } from './notes-ui.js';
import { pairLabel } from './cages.js';

// Thẻ đang mở rộng. Khi còn thẻ mở: giữ nguyên thứ tự danh sách để không nhảy trong lúc đang thao tác; thu gọn thì mới sắp xếp lại.
const expanded = new Set();
let frozenOrder = [];

const CHECK_TONE = { danger: 'danger', warn: 'warn', info: 'muted' };

export function smartRows(store, states) {
  const today = store.today();
  return states.map((state) => ({ state, brood: cageBrood(store.db, state.cage.id, today, store.settings) }));
}

/** Sắp xếp danh sách; đang có thẻ mở thì giữ thứ tự đã hiển thị. */
export function orderRows(rows) {
  const sorted = smartSort(rows);
  if (!expanded.size) { frozenOrder = sorted.map((r) => r.state.cage.id); return sorted; }
  const at = new Map(frozenOrder.map((id, i) => [id, i]));
  return sorted.map((r, i) => ({ r, i })).sort((a, b) => (at.get(a.r.state.cage.id) ?? 1e6 + a.i) - (at.get(b.r.state.cage.id) ?? 1e6 + b.i)).map((x) => x.r);
}

export function counterText(rows) {
  const { total, left } = checkCounter(rows);
  return left ? `Còn ${left}/${total} lồng cần kiểm tra hôm nay` : `Đã kiểm tra đủ ${total}/${total} lồng hôm nay`;
}

function lastSeenText(st, today) {
  const c = st.check;
  if (!c.lastDate) return 'chưa có';
  if (c.lastDate === today && c.lastAt) return `${fmtDateTime(c.lastAt)} (hôm nay)`;
  return `${fmtDate(c.lastDate)} (${relativeDays(daysBetween(c.lastDate, today))})`;
}

export function smartCard(store, row) {
  const { state: s, brood: b } = row;
  const db = store.db; const today = store.today();
  const id = s.cage.id;
  const open = expanded.has(id);
  const openList = b.parts.map((p) => p.clutch);
  const foster = fosterState(db, id, openList);
  const eggs = eggBreakdown(db, id, b);
  const loss = lossSummary(db, id, openList);
  const need = needsCheck(s, b);
  const canW = store.can('breeding.write');
  const tone = { rearing: 'ok', incubating: 'warn', laying: 'warn', awaiting_close: 'info', resting: 'muted', idle: 'muted', no_pair: 'muted' }[s.status];
  return html`<article class="cage-card smart foster-${foster.state} ${need && !s.checkedToday ? 'unchecked' : ''}" data-cage="${id}">
    <div class="cc-top">
      <div><div class="cc-code-row"><div class="cc-code">${s.cage.code}</div>${canW ? html`<button class="sc-pen" data-act="edit" aria-label="Sửa nhật ký gần nhất của ${s.cage.code}">${icon('edit')} Sửa</button>` : ''}</div><div class="cc-pair">${pairLabel(store, s.pair)}</div></div>
      <div class="cc-badges">
        ${badge(CAGE_STATUS_LABELS[s.status], tone)}
        ${need ? (s.checkedToday ? badge(raw(`${icon('check')} Đã cập nhật`), 'ok') : badge('Chưa cập nhật', 'warn')) : ''}
      </div>
    </div>
    ${noteBlock(store, s.note, { card: true })}
    <div class="sc-nums">
      <div class="sc-num gold"><b>${b.eggs}</b><span>Trứng</span></div>
      <div class="sc-num green"><b>${b.chicks}</b><span>Chim non</span></div>
      <div class="sc-num teal"><b>${eggs.fertile}</b><span>Có cồ</span></div>
      <div class="sc-num red"><b>${loss.eggs + loss.chicks}</b><span>Hao hụt${loss.eggs + loss.chicks ? html` <small>${loss.eggs} trứng · ${loss.chicks} non</small>` : ''}</span></div>
    </div>
    <div class="cc-meta"><span>Cập nhật gần nhất: <b>${lastSeenText(s, today)}</b></span></div>
    <div class="sc-actions">
      <button class="btn primary" data-act="today" ${s.pair ? '' : raw('data-no-pair="1"')}>${icon('clipboard')} Cập nhật hôm nay</button>
      <button class="btn soft" data-sact="toggle" aria-expanded="${open ? 'true' : 'false'}">${icon('chevron')} ${open ? 'Thu gọn' : 'Mở rộng'}</button>
      <button class="btn soft" data-act="history">${icon('history')} Lịch sử</button>
    </div>
    ${open ? expandedBody(store, row, foster, eggs, loss) : ''}
  </article>`;
}

function barRow(store, bar, canW) {
  const g = bar.group;
  const scale = bar.kind === 'egg' ? EGG_MAX_DAYS : CHICK_SCALE_DAYS;
  const pctOf = (d) => Math.round((d / scale) * 100);
  return html`<div class="pbar ${bar.kind === 'egg' ? 'egg' : bar.tone} basis-${bar.basis}">
    <div class="pbar-head"><span class="pbar-qty">${bar.kind === 'egg' ? icon('egg') : raw('🐣')} <b>${bar.qty}</b> ${KIND_LABELS[bar.kind]}</span>
      <span class="pbar-label">${bar.label}</span><span class="pbar-age">${bar.ageText}</span></div>
    <div class="pbar-track" role="img" aria-label="${bar.ageText}. ${bar.remainText}"><i style="width:${bar.pct}%"></i>
      ${bar.kind === 'egg' ? raw(`<u style="left:${pctOf(EGG_MIN_DAYS)}%"></u>`) : raw(`<u style="left:${pctOf(30)}%"></u><u style="left:${pctOf(36)}%"></u>`)}</div>
    <div class="pbar-foot"><span class="small">${bar.remainText}${bar.milestone ? ` · ${bar.milestone.label}` : ''}</span>
      ${canW ? html`<span class="pbar-btns">
        <button class="btn ghost xs" data-sact="adjust" data-bar="${bar.id}">Chỉnh</button>
        ${bar.kind === 'chick' ? html`<button class="btn ghost xs" data-sact="wean" data-src="${bar.source}">Tách mẹ</button>` : ''}
        ${g?.kind === 'egg' ? html`<button class="btn ghost xs" data-gact="hatch" data-id="${g.id}">Ghi nở</button>` : ''}
        ${g?.kind === 'chick' ? html`<button class="btn ghost xs" data-gact="fledge" data-id="${g.id}">Ra ràng</button>` : ''}
        ${bar.own && bar.kind === 'chick' ? html`<button class="btn ghost xs" data-sact="fledge" data-clutch="${bar.clutch.id}">Ra ràng</button>` : ''}
        <button class="btn ghost xs danger-text" data-sact="loss" data-src="${bar.source}" aria-label="Ghi hao hụt ${bar.qty} ${KIND_LABELS[bar.kind]}">${icon('x')}</button>
      </span>` : ''}</div>
  </div>`;
}

function expandedBody(store, row, foster, eggs, loss) {
  const { state: s, brood: b } = row;
  const db = store.db; const today = store.today();
  const id = s.cage.id;
  const canW = store.can('breeding.write');
  const bars = progressBars(db, id, today, b);
  const events = cageEvents(db, id).filter((e) => e.type !== 'reverse').slice(0, 5);
  const groups = [...b.eggSegments, ...b.segments].filter((x) => x.group);
  return html`<div class="sc-more">
    ${foster.state === 'mixed' ? html`<p class="small sc-foster">Viền đỏ: lứa này đã có đảo tổ (nhận ${foster.inN} · chuyển đi ${foster.outN}${foster.groupCount ? ` · ${foster.groupCount} nhóm không thuộc lứa` : ''}). Không có nghĩa là lồng có bệnh.</p>` : ''}
    ${s.warnings.length || s.checks.length || s.openHealth.length || s.longRest || b.over ? html`<div class="sc-alerts">
      ${b.over ? badge(`${b.chicks} chim non — vượt ngưỡng ${chickLimit(store.settings)} con / lồng`, 'danger') : ''}
      ${s.warnings.map((w) => badge(w, 'danger'))}${s.checks.map((c) => badge(c.short, CHECK_TONE[c.level]))}
      ${s.openHealth.length ? badge(raw(`${icon('heart')} Theo dõi sức khoẻ`), 'danger') : ''}${s.longRest ? badge('Nghỉ lâu — đánh giá lại', 'orange') : ''}</div>` : ''}

    <div class="sc-section"><h3>Trứng trong tổ (${eggs.total})</h3>${canW && eggs.total ? html`<button class="btn soft sm" data-sact="eggcheck">${icon('search')} Soi trứng</button>` : ''}</div>
    ${eggs.total ? html`<div class="egg-chips">
      <span class="egg-chip fertile"><b>${eggs.fertile}</b> có cồ</span><span class="egg-chip notseen"><b>${eggs.notSeen}</b> chưa thấy cồ</span>
      <span class="egg-chip unchecked"><b>${eggs.unchecked}</b> chưa soi</span>${loss.eggs ? html`<span class="egg-chip broken"><b>${loss.eggs}</b> vỡ / hỏng</span>` : ''}</div>
      ${eggs.check ? html`<p class="small muted">Soi gần nhất ${fmtDateShort(eggs.check.check_date)}. "Chưa thấy cồ" chưa phải kết luận không cồ.</p>` : ''}` : html`<p class="small muted">Không có trứng trong tổ.</p>`}

    <div class="sc-section"><h3>Tiến độ</h3></div>
    ${bars.length ? html`<div class="pbars">${bars.map((x) => barRow(store, x, canW))}</div>
      <p class="def">Thanh tự tăng theo ngày. Trứng: mốc tham khảo ${EGG_MIN_DAYS}–${EGG_MAX_DAYS} ngày ấp. Chim non: ra ràng ~30–35 ngày, kiểm tra tách mẹ ~36–42 ngày. Đủ ngày KHÔNG tự chuyển trạng thái.</p>` : html`<p class="small muted">Chưa có trứng / chim non để theo dõi.</p>`}

    <div class="sc-section"><h3>Hao hụt trong lứa</h3></div>
    ${loss.rows.length ? html`<ul class="sc-losses">${loss.rows.map((r) => html`<li><b>${r.qty}</b> ${r.label}</li>`)}</ul>` : html`<p class="small muted">Chưa ghi nhận hao hụt.</p>`}
    ${loss.unaccounted ? html`<p class="small muted">${loss.unaccounted} chim non chưa khớp — chưa được ghi là chết hay mất, cần đối chiếu.</p>` : ''}

    <div class="sc-section"><h3>Đảo tổ & nguồn gốc</h3><button class="btn ghost sm" data-act="brood">Xem toàn bộ</button></div>
    ${groups.map((x) => html`<p class="small"><b>${x.qty} ${KIND_LABELS[x.kind]}:</b> ${originText(x.group, db, (bid) => store.birdName(bid))}${s.pair ? ` · Đang nuôi: ${pairLabel(store, s.pair)}` : ''}
      <button class="link" data-gact="detail" data-id="${x.group.id}">Đường đi</button></p>`)}
    ${events.length ? html`<div class="timeline">${events.map((e) => eventRow(store, e))}</div>` : groups.length ? '' : html`<p class="small muted">Chưa có đảo tổ.</p>`}

    <div class="sc-section"><h3>Các lứa đang mở (${b.parts.length})</h3>${canW && s.pair ? html`<button class="btn primary sm" data-sact="add-clutch">${icon('plus')} Thêm lứa sinh sản</button>` : ''}</div>
    ${b.parts.length ? b.parts.map((p) => partBlock(db, p, canW)) : html`<p class="small muted">Chưa có lứa đang mở. Bấm "Thêm lứa sinh sản" khi chim mái bắt đầu đẻ đợt mới.</p>`}

    <div class="sc-tools">
      ${canW ? html`<button class="btn soft" data-sact="add">${icon('plus')} Thêm</button>
      <button class="btn soft" data-sact="adjust-pick" ${bars.length ? '' : raw('disabled')}>${icon('edit')} Điều chỉnh</button>
      <button class="btn soft" data-sact="loss" data-src="">${icon('x')} Hao hụt</button>
      <button class="btn soft" data-act="brood-transfer">${icon('swap')} Đảo / Chuyển</button>` : ''}
      <button class="btn ghost" data-act="edit">${icon('edit')} Sửa nhật ký</button>
      <button class="btn ghost" data-act="history">${icon('history')} Lịch sử</button>
      <a class="btn ghost" href="#/cage/${id}">${icon('info')} Chi tiết</a>
      <button class="btn ghost" data-sact="toggle">Thu gọn</button>
    </div>
  </div>`;
}

/** Một lứa đang mở trong phần mở rộng: số riêng của lứa, kết thúc lứa, báo cáo. */
function partBlock(db, part, canW) {
  const c = part.clutch;
  const q = clutchQuality(db, c);
  return html`<div class="sc-part" data-part="${c.id}">
    <div class="sc-part-head"><b>${clutchTitle(c)}</b><span class="small muted">từ ${fmtDateShort(c.start_date)}</span>
      <span class="sc-part-now"><b>${part.own?.eggs || 0}</b> trứng · <b>${part.own?.chicks || 0}</b> chim non</span></div>
    <dl class="sc-quality">
      <div><dt>Trứng đã đẻ</dt><dd>${q.eggsLaid}</dd></div><div><dt>Ghi nhận có cồ</dt><dd>${q.fertileSeen}</dd></div>
      <div><dt>Đã nở</dt><dd>${q.hatched}</dd></div><div><dt>Trứng vỡ / hỏng</dt><dd>${q.eggsLost}</dd></div>
      <div><dt>Chim non chết / mất</dt><dd>${q.chicksDead}</dd></div><div><dt>Ra ràng</dt><dd>${q.fledged}</dd></div>
      <div><dt>Đã tách mẹ</dt><dd>${q.weaned}</dd></div><div><dt>Chuyển đi / đến</dt><dd>${q.movedOut} / ${q.movedIn}</dd></div></dl>
    <div class="sc-part-btns">
      <button class="btn ghost sm" data-sact="report" data-clutch="${c.id}">${icon('info')} Báo cáo lứa</button>
      ${canW ? html`<button class="btn soft sm" data-sact="finish" data-clutch="${c.id}">${icon('check')} Kết thúc lứa</button>` : ''}
    </div></div>`;
}

export function smartListBody(store, rows, filtered) {
  const ordered = orderRows(rows).filter((r) => filtered.has(r.state.cage.id));
  if (!ordered.length) return empty('Không có lồng nào khớp bộ lọc.', cageArt(72));
  const firstDone = ordered.findIndex((r) => !needsCheck(r.state, r.brood) || r.state.checkedToday);
  return html`<div class="cage-list">${ordered.map((r, i) => html`${i === firstDone && i > 0 && !expanded.size ? html`<div class="sc-divider">Đã kiểm tra hôm nay / không cần kiểm tra</div>` : ''}${smartCard(store, r)}`)}</div>`;
}

/**
 * Sau khi kiểm tra xong một lồng: thu gọn thẻ, sắp xếp lại, cuộn tới lồng chưa cập nhật kế tiếp trong danh sách đang lọc.
 * Không cuộn nếu đã rời danh sách, hoặc đang mở biểu mẫu / nhập liệu.
 */
export function advanceToNext(app, cageId) {
  if (!app.store.smartCards || !/^#\/cages(\?|$)/.test(location.hash)) return;
  expanded.clear();
  app.render();
  // Chờ lần vẽ lại do dữ liệu mới (trễ 30 ms), lần đó giữ nguyên vị trí cuộn
  setTimeout(() => {
    if (sheetOpen() || !/^#\/cages(\?|$)/.test(location.hash) || document.activeElement?.matches('input,textarea,select')) return;
    const next = [...document.querySelectorAll('.cage-card.smart.unchecked')].find((c) => c.dataset.cage !== cageId);
    // Không thêm thông báo khi còn lồng kế tiếp: thông báo thứ hai sẽ che mã lồng vừa cuộn tới
    if (next) next.scrollIntoView({ block: 'start' });
    else { window.scrollTo(0, 0); toast('Đã kiểm tra hết các lồng trong danh sách'); }
  }, 90);
}

export function bindSmartCards(root, app) {
  bindNoteActions(root, app);
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reverse]');
    if (r) return openReverse(app, r.dataset.reverse);
    const g = e.target.closest('[data-gact]');
    if (g) return g.dataset.gact === 'detail' ? openGroupDetail(app, g.dataset.id) : openGroupAction(app, g.dataset.id, g.dataset.gact);
    const t = e.target.closest('[data-act="brood-transfer"]');
    if (t) return openTransferForm(app, t.closest('[data-cage]').dataset.cage);
    const b = e.target.closest('[data-sact]');
    if (!b) return;
    const cageId = b.closest('[data-cage]')?.dataset.cage;
    const a = b.dataset.sact;
    if (a === 'toggle') {
      if (expanded.has(cageId)) expanded.delete(cageId); else expanded.add(cageId);
      return app.render();
    }
    if (a === 'add-clutch') return openAddClutch(app, cageId);
    if (a === 'finish') return openCloseClutch(app, b.dataset.clutch);
    if (a === 'report') return openClutchReport(app, b.dataset.clutch);
    if (a === 'fledge') return openClutchFledge(app, b.dataset.clutch);
    if (a === 'eggcheck') return openEggCheck(app, cageId);
    if (a === 'loss') return openLossSheet(app, cageId, b.dataset.src);
    if (a === 'add') return openAddSheet(app, cageId);
    if (a === 'wean') return openWeanSheet(app, cageId, b.dataset.src);
    if (a === 'adjust') return openAdjust(app, cageId, b.dataset.bar);
    if (a === 'adjust-pick') return openAdjustPick(app, cageId);
  });
}

function broodOf(app, cageId) {
  return cageBrood(app.store.db, cageId, app.store.today(), app.store.settings);
}

// ---------- Chim non của lứa ra lồng phóng: một lần lưu, tổ giảm và lồng phóng tăng cùng lúc ----------
export function openClutchFledge(app, clutchId) {
  const store = app.store; const today = store.today();
  const c = store.byId('clutches', clutchId);
  const part = broodOf(app, c.cage_id).parts.find((p) => p.clutch.id === clutchId);
  const max = part?.own?.chicks || 0;
  if (!max) { toast('Lứa không còn chim non', 'warn'); return; }
  const pens = flightPens(store.db);
  if (!pens.length) { toast('Chưa có lồng phóng đang sử dụng', 'warn'); return; }
  const requestId = newRequestId();
  openSheet({
    title: `Ra ràng → lồng phóng · ${clutchTitle(c)}`, subtitle: `Lứa còn ${max} chim non`,
    body: html`<form class="form" data-fl novalidate>
      ${field('Chuyển vào lồng', html`<select name="to_pen_id">${options(Object.fromEntries(pens.map((p) => [p.id, p.name])))}</select>`)}
      <div class="grid2">${field('Số lượng', html`<input type="number" name="qty" value="1" min="1" max="${max}" step="1" inputmode="numeric">`, `Tối đa ${max}`)}
        ${field('Ngày', html`<input type="date" name="event_date" value="${today}" max="${today}" min="${addDays(today, -BACKDATE_DAYS)}">`)}</div>
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="500"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-fl]')); const qty = Number(v.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > max) return showMessages(el.querySelector('[data-msg]'), [`Số lượng từ 1 đến ${max}`]);
      const r = await store.brood('brood_clutch_fledge', { request_id: requestId, clutch_id: clutchId, qty, to_pen_id: v.to_pen_id, event_date: v.event_date, note: v.note });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast(r.result?.duplicate ? 'Thao tác này đã được lưu trước đó — không ghi trùng' : `Đã chuyển ${qty} chim non ra lồng phóng`);
      close();
    })),
  });
}

// ---------- Soi trứng theo số lượng ----------
export function openEggCheck(app, cageId, clutchId = null) {
  const store = app.store; const cage = store.byId('cages', cageId);
  const b = broodOf(app, cageId);
  const holders = b.parts.filter((p) => p.own?.eggs);
  // Nhiều lứa còn trứng: soi theo từng lứa
  const multi = holders.length > 1;
  if (multi && !clutchId) {
    openSheet({
      title: 'Soi trứng của lứa nào?', subtitle: cage.code,
      body: html`<div class="list">${holders.map((p) => html`<button class="row sc-pick" data-pick="${p.clutch.id}"><span class="grow"><span class="title">${clutchTitle(p.clutch)}</span><br><span class="desc">${p.own.eggs} trứng</span></span>${icon('chevron')}</button>`)}</div>`,
      onMount: (el, close) => el.addEventListener('click', (e) => { const x = e.target.closest('[data-pick]'); if (x) { close(); openEggCheck(app, cageId, x.dataset.pick); } }),
    });
    return;
  }
  const part = multi ? holders.find((p) => p.clutch.id === clutchId) : null;
  const now = eggBreakdown(store.db, cageId, part ? { eggs: part.own.eggs, clutch: part.clutch, own: part.own, parts: [part], eggSegments: [] } : b);
  if (!now.total) { toast('Lồng không có trứng để soi', 'warn'); return; }
  const requestId = newRequestId();
  const history = (store.db.cage_checks || []).filter((c) => c.cage_id === cageId && c.kind === 'egg_check').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 5);
  openSheet({
    title: `Soi trứng · ${cage.code}${part ? ` · ${clutchTitle(part.clutch)}` : ''}`, subtitle: `${part ? 'Lứa' : 'Tổ'} đang có ${now.total} trứng — chỉ cần nhập số lượng, không cần biết quả nào`,
    body: html`<form class="form" data-ec novalidate>
      ${stepper('fertile_seen', 'Thấy dấu hiệu có cồ', now.fertile, { hint: 'Màu xanh trên thẻ' })}
      ${stepper('not_seen', 'Đã soi, chưa thấy cồ', now.notSeen, { hint: 'Chưa phải kết luận không cồ' })}
      <div class="msg info" data-rest></div>
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="500"></textarea>`)}
      ${history.length ? html`<div class="field"><span>Các lần soi trước</span><ul class="sc-losses">${history.map((c) => html`<li>${fmtDateTime(c.created_at)}: ${c.fertile_seen} có cồ · ${c.not_seen} chưa thấy cồ / ${c.total_eggs} trứng · ${store.userName(c.created_by) || 'Không rõ'}</li>`)}</ul></div>` : ''}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-ec]');
      const read = () => { const v = formValues(f); return { fertile: Number(v.fertile_seen), notSeen: Number(v.not_seen), note: v.note }; };
      const upd = () => { const v = read(); const rest = now.total - v.fertile - v.notSeen; el.querySelector('[data-rest]').textContent = rest < 0 ? `Vượt ${-rest} so với ${now.total} trứng trong tổ` : `Còn ${rest} trứng chưa soi`; };
      f.addEventListener('input', upd); upd();
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = read();
        if (![v.fertile, v.notSeen].every((x) => Number.isInteger(x) && x >= 0)) return showMessages(el.querySelector('[data-msg]'), ['Số trứng phải là số nguyên từ 0 trở lên']);
        if (v.fertile + v.notSeen > now.total) return showMessages(el.querySelector('[data-msg]'), [`Tổ chỉ có ${now.total} trứng`]);
        const r = await store.brood('brood_egg_check', { request_id: requestId, cage_id: cageId, ...(part ? { clutch_id: part.clutch.id } : {}), fertile_seen: v.fertile, not_seen: v.notSeen, expected_total: now.total, note: v.note });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(`Đã lưu soi trứng ${cage.code}: ${v.fertile} có cồ, ${v.notSeen} chưa thấy cồ`);
        close();
      }));
    },
  });
}

// ---------- Hao hụt: không xoá bản ghi; bắt buộc nguyên nhân ----------
function sourcesOf(store, cageId) {
  const b = cageBrood(store.db, cageId, store.today(), store.settings);
  return [
    ...b.parts.flatMap((p) => [
      ...(p.own?.eggs ? [{ key: `clutch:${p.clutch.id}:egg`, kind: 'egg', qty: p.own.eggs, label: `${p.own.eggs} trứng · ${clutchTitle(p.clutch)}`, clutch: p.clutch }] : []),
      ...(p.own?.chicks ? [{ key: `clutch:${p.clutch.id}:chick`, kind: 'chick', qty: p.own.chicks, label: `${p.own.chicks} chim non · ${clutchTitle(p.clutch)}`, clutch: p.clutch }] : []),
    ]),
    ...[...b.eggSegments, ...b.segments].filter((s) => s.group).map((s) => ({ key: `group:${s.group.id}`, kind: s.kind, qty: s.qty, label: `${s.qty} ${KIND_LABELS[s.kind]} · ${s.label}`, group: s.group })),
  ];
}

export function openLossSheet(app, cageId, sourceKey) {
  const store = app.store; const today = store.today(); const cage = store.byId('cages', cageId);
  const sources = sourcesOf(store, cageId);
  if (!sources.length) { toast('Lồng không có trứng / chim non', 'warn'); return; }
  const requestId = newRequestId();
  const start = sources.find((s) => s.key === sourceKey) || sources[0];
  const reasonsFor = (s) => { const { egg_infertile: drop, ...rest } = LOSS_REASONS.egg; return s.kind === 'chick' ? LOSS_REASONS.chick : s.group ? LOSS_REASONS.egg : rest; };
  openSheet({
    title: `Ghi hao hụt · ${cage.code}`, subtitle: 'Không xoá bản ghi. Có thể ghi một phần của nhóm.',
    body: html`<form class="form" data-ls novalidate>
      ${field('Hao hụt từ', html`<select name="source">${options(Object.fromEntries(sources.map((s) => [s.key, s.label])), start.key)}</select>`)}
      <div class="grid2">${field('Số lượng', html`<input type="number" name="qty" value="1" min="1" max="${start.qty}" step="1" inputmode="numeric">`, raw('<span data-max></span>'))}
        ${field('Ngày', html`<input type="date" name="event_date" value="${today}" max="${today}" min="${addDays(today, -BACKDATE_DAYS)}">`)}</div>
      ${field('Nguyên nhân', html`<select name="reason" data-reason>${options(reasonsFor(start))}</select>`)}
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="500" placeholder="Mô tả điều đã thấy"></textarea>`, 'App không tự suy đoán nguyên nhân. Chưa rõ thì chọn "Chưa xác định".')}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn danger" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-ls]');
      const cur = () => sources.find((s) => s.key === f.querySelector('[name=source]').value);
      const upd = () => { el.querySelector('[data-max]').textContent = `Tối đa ${cur().qty}`; f.querySelector('[name=qty]').max = cur().qty; };
      f.querySelector('[name=source]').addEventListener('change', () => { f.querySelector('[data-reason]').innerHTML = String(options(reasonsFor(cur()))); upd(); });
      upd();
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f); const s = cur(); const qty = Number(v.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > s.qty) return showMessages(el.querySelector('[data-msg]'), [`Số lượng từ 1 đến ${s.qty}`]);
        const base = { request_id: requestId, qty, reason: v.reason, note: v.note, event_date: v.event_date };
        const r = s.group ? await store.brood('brood_loss', { ...base, group_id: s.group.id }) : await store.brood('brood_clutch_loss', { ...base, clutch_id: s.clutch.id, kind: s.kind });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(r.result?.duplicate ? 'Thao tác này đã được lưu trước đó — không ghi trùng' : `Đã ghi hao hụt ${qty} ${KIND_LABELS[s.kind]} ở ${cage.code}`);
        close();
      }));
    },
  });
}

// ---------- + Thêm ----------
export function openAddSheet(app, cageId) {
  const store = app.store; const today = store.today(); const cage = store.byId('cages', cageId);
  const parts = broodOf(app, cageId).parts;
  const hasClutch = parts.length > 0;
  openSheet({
    title: `Thêm · ${cage.code}`, subtitle: 'Nhập số phát sinh, app tự cộng vào tổng của lứa',
    body: html`<form class="form" data-ad novalidate>
      ${field('Ghi nhận', html`<select name="type">${options({ egg: 'Trứng mới đẻ của cặp trong lồng', ...(hasClutch ? { hatch: 'Chim non mới nở từ trứng của lứa' } : {}), group: 'Trứng / chim non có sẵn, không thuộc lứa này' }, 'egg')}</select>`)}
      ${parts.length > 1 ? field('Thuộc lứa', html`<select name="clutch_id">${options(Object.fromEntries(parts.slice().reverse().map((p) => [p.clutch.id, `${clutchTitle(p.clutch)} · ${p.own?.eggs || 0} trứng · ${p.own?.chicks || 0} chim non`])))}</select>`) : ''}
      <div data-qf><div class="grid2">${field('Số lượng', html`<input type="number" name="qty" value="1" min="1" step="1" inputmode="numeric">`)}
        ${field('Ngày', html`<input type="date" name="date" value="${today}" max="${today}">`)}</div></div>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-ad]');
      f.querySelector('[name=type]').addEventListener('change', (e) => el.querySelector('[data-qf]').classList.toggle('hidden', e.target.value === 'group'));
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f);
        if (v.type === 'group') { close(); openCreateGroup(app, cageId); return; }
        const plan = planQuickAdd(store.db, { cage_id: cageId, clutch_id: v.clutch_id, type: v.type, qty: Number(v.qty), date: v.date }, store.ctx());
        if (plan.errors?.length) return showMessages(el.querySelector('[data-msg]'), plan.errors);
        const r = await store.run(plan, { requires: 'breeding.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(`Đã thêm ${v.qty} ${v.type === 'egg' ? 'trứng' : 'chim non'} ở ${cage.code}`);
        close();
      }));
    },
  });
}

// ---------- Tách mẹ: chỉ đánh dấu do người dùng xác nhận ----------
export function openWeanSheet(app, cageId, sourceKey) {
  const store = app.store; const today = store.today(); const cage = store.byId('cages', cageId);
  const s = sourcesOf(store, cageId).find((x) => x.key === sourceKey);
  if (!s) return;
  const requestId = newRequestId();
  openSheet({
    title: `Đánh dấu tách mẹ · ${cage.code}`, subtitle: s.label,
    body: html`<form class="form" data-wn novalidate>
      <div class="msg info">${icon('info')} Chỉ ghi nhận để thống kê sau khi đã kiểm tra chim tự ăn. Số chim trong lồng không đổi cho tới khi chuyển đi.</div>
      <div class="grid2">${field('Số lượng', html`<input type="number" name="qty" value="${s.qty}" min="1" max="${s.qty}" inputmode="numeric">`, `Tối đa ${s.qty}`)}
        ${field('Ngày', html`<input type="date" name="event_date" value="${today}" max="${today}" min="${addDays(today, -BACKDATE_DAYS)}">`)}</div>
      ${field('Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="2" maxlength="500"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-wn]')); const qty = Number(v.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > s.qty) return showMessages(el.querySelector('[data-msg]'), [`Số lượng từ 1 đến ${s.qty}`]);
      const r = await store.brood('brood_wean', { request_id: requestId, source: s.group ? { group_id: s.group.id } : { clutch_id: s.clutch.id }, qty, event_date: v.event_date, note: v.note });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã đánh dấu tách mẹ');
      close();
    })),
  });
}

// ---------- Điều chỉnh ngày tham chiếu / tuổi ----------
function openAdjustPick(app, cageId) {
  const store = app.store;
  const bars = progressBars(store.db, cageId, store.today(), broodOf(app, cageId));
  if (bars.length === 1) return openAdjust(app, cageId, bars[0].id);
  return openSheet({
    title: 'Điều chỉnh đợt nào?', subtitle: store.byId('cages', cageId).code,
    body: html`<div class="list">${bars.map((b) => html`<button class="row sc-pick" data-pick="${b.id}"><span class="grow"><span class="title">${b.qty} ${KIND_LABELS[b.kind]} · ${b.label}</span><br><span class="desc">${b.ageText}</span></span>${icon('chevron')}</button>`)}</div>`,
    onMount: (el, close) => el.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (p) { close(); openAdjust(app, cageId, p.dataset.pick); } }),
  });
}

export function openAdjust(app, cageId, barId) {
  const store = app.store; const today = store.today();
  const bar = progressBars(store.db, cageId, today, broodOf(app, cageId)).find((b) => b.id === barId);
  if (!bar) { toast('Đợt này vừa thay đổi — mở lại thẻ', 'warn'); return; }
  const isEgg = bar.kind === 'egg';
  const max = isEgg ? 40 : 90;
  const start = Math.max(0, Math.min(max, bar.days ?? 0));
  const hasValue = bar.days !== null;
  openSheet({
    title: `Điều chỉnh · ${bar.qty} ${KIND_LABELS[bar.kind]}`, subtitle: `${bar.label} · hiện tại: ${bar.ageText}`,
    body: html`<form class="form" data-aj novalidate>
      <div class="msg info">${icon('info')} Chỉ sửa sau khi đã xác minh. Không đổi số lượng. Lịch sử sửa được lưu.</div>
      ${isEgg ? field('Mốc tính', html`<select name="ref">${options({ laid: 'Ngày đẻ (dự kiến nở là ước tính)', incubate: 'Ngày bắt đầu ấp' }, bar.ref && !bar.ref.laid_date && !bar.group?.laid_date ? 'incubate' : (bar.ref?.incubate_date || bar.group?.incubate_date ? 'incubate' : 'laid'))}</select>`) : ''}
      <label class="field"><span data-age-label></span><input type="range" name="age" min="0" max="${max}" value="${start}" step="1" class="stage-range"></label>
      ${field(isEgg ? 'Ngày tương ứng' : 'Ngày nở', html`<input type="date" name="date" value="${addDays(today, -start)}" min="${addDays(today, -max)}" max="${today}">`)}
      ${isEgg ? '' : field('Độ chắc chắn', html`<select name="basis">${options({ estimated: 'Ước tính', known: 'Biết chắc (đã thấy ngày nở)' }, bar.basis === 'known' ? 'known' : 'estimated')}</select>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`${hasValue && (bar.ref || bar.group) ? html`<button class="btn ghost" data-clear>${bar.own ? 'Về tính theo nhật ký' : 'Đặt là chưa rõ'}</button>` : ''}<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu thay đổi</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-aj]');
      const range = f.querySelector('[name=age]'); const date = f.querySelector('[name=date]');
      const label = () => { el.querySelector('[data-age-label]').textContent = `${isEgg ? 'Số ngày đã qua' : 'Tuổi'}: ${range.value} ngày`; };
      range.addEventListener('input', () => { date.value = addDays(today, -Number(range.value)); label(); });
      date.addEventListener('change', () => { const d = daysBetween(date.value, today); if (d !== null && d >= 0) range.value = Math.min(max, d); label(); });
      label();
      const send = async (dates) => {
        const r = bar.group ? await store.brood('brood_update', { group_id: bar.group.id, ...dates })
          : await store.brood('brood_ref_set', { clutch_id: bar.clutch.id, kind: bar.kind, cohort: bar.cohort, laid_date: null, incubate_date: null, hatch_date: null, hatch_date_to: null, hatch_basis: null, ...dates });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu');
        close();
      };
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f);
        if (!v.date || v.date > today) return showMessages(el.querySelector('[data-msg]'), ['Ngày không hợp lệ']);
        if (isEgg) return send(v.ref === 'incubate' ? { incubate_date: v.date, ...(bar.group ? {} : { laid_date: null }) } : { laid_date: v.date, ...(bar.group ? { laid_date_to: null } : {}), incubate_date: null });
        return send({ hatch_date: v.date, hatch_date_to: null, hatch_basis: v.basis });
      }));
      el.querySelector('[data-clear]')?.addEventListener('click', (e) => busy(e.currentTarget, () => send(isEgg ? { laid_date: null, ...(bar.group ? { laid_date_to: null } : {}), incubate_date: null } : { hatch_date: null, hatch_date_to: null, hatch_basis: null })));
    },
  });
}

export function noPairGuard(app, cageId) { return openNoPairNotice(app, cageId); }
export { openDailyForm };
