import { html, raw } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { cageArt, nestArt } from '../ui/brand.js';
import { badge, empty, thumb, openSheet, toast } from '../ui/components.js';
import { cageState, CAGE_STATUS_LABELS, STAGE_LABELS, logsOfCage, logsOfClutch, clutchSummary, snapshotDelta, describeDelta, completedRestDays, pairPerformance, chickMismatch } from '../domain/breeding.js';
import { fmtDate, fmtDateShort, fmtDateTime, relativeDays, daysBetween } from '../core/dates.js';
import { fmtPct, matches } from '../core/format.js';
import { openDailyForm, openCloseClutch, openRestForm, openCageForm, openNoPairNotice, openEditClutchStart } from './breeding-forms.js';
import { openPairSheet } from './pairing-sheet.js';
import { currentPair, byCageCode } from '../domain/breeding.js';
import { openHealthForm } from './health.js';
import { noteBlock, noteList, bindNoteActions } from './notes-ui.js';
import { notesOfLog } from '../domain/notes.js';

const FILTERS = [
  ['all', 'Tất cả'], ['notlogged', 'Chưa ghi hôm nay'], ['stale', 'Lâu chưa cập nhật'], ['active', 'Có lứa'],
  ['incubating', 'Đang ấp'], ['rearing', 'Nuôi con'], ['resting', 'Nghỉ đẻ'], ['longrest', 'Nghỉ lâu'],
  ['warn', 'Cần kiểm tra'], ['nodata', 'Chưa đủ dữ liệu'],
];

const filterFn = {
  all: () => true,
  notlogged: (s) => s.pair && !s.loggedToday,
  stale: (s) => s.stale,
  active: (s) => !!s.clutch,
  incubating: (s) => s.status === 'incubating' || s.status === 'laying',
  rearing: (s) => s.status === 'rearing',
  resting: (s) => s.rest.state === 'resting',
  longrest: (s) => s.longRest || s.rest.overdueReview,
  warn: (s) => s.warnings.length > 0 || s.openHealth.length > 0,
  nodata: (s) => !s.clutch && s.rest.state === 'no_data',
};

export function pairLabel(store, pair) {
  if (!pair) return 'Chưa ghép cặp';
  return `♂ ${store.birdName(pair.male_id)}  ×  ♀ ${store.birdName(pair.female_id)}`;
}

export function restText(s) {
  const r = s.rest;
  if (r.state === 'resting') return html`<b>${r.days}</b> ngày nghỉ${r.overdueReview ? ' · quá hạn đánh giá' : ''}`;
  if (r.state === 'breeding') return r.lastRestDays !== null && r.lastRestDays !== undefined ? html`Đang sinh sản · nghỉ trước đó <b>${r.lastRestDays}</b> ngày` : html`Đang sinh sản`;
  return html`Nghỉ đẻ: <b>Chưa đủ dữ liệu</b>`;
}

const CHECK_TONE = { danger: 'danger', warn: 'warn', info: 'muted' };
const CHECK_ICON = { danger: 'red', warn: 'gold', info: '' };
export const NUMS_LEGEND = 'Trên thẻ lồng: Trứng đẻ, Có cồ, Không cồ, Hỏng, Đã nở, Ra ràng là số CỘNG DỒN của lứa (chỉ tăng). Non hiện tại và Chờ kết quả là số HIỆN TẠI — Tổng quan chỉ cộng 2 số này của các lứa đang mở.';

export function cageCard(store, s, { hideNote = false } = {}) {
  const sum = s.summary;
  const tone = { rearing: 'ok', incubating: 'warn', laying: 'warn', awaiting_close: 'info', resting: 'muted', idle: 'muted', no_pair: 'muted' }[s.status];
  const alert = s.warnings.length || s.openHealth.length || s.longRest;
  return html`<article class="cage-card st-${s.status} ${alert ? 'has-alert' : ''}" data-cage="${s.cage.id}">
    <div class="cc-top">
      <div><div class="cc-code">${s.cage.code}</div><div class="cc-pair">${pairLabel(store, s.pair)}</div></div>
      <div class="cc-badges">
        ${badge(CAGE_STATUS_LABELS[s.status], tone)}
        ${s.loggedToday ? badge(raw(`${icon('check')} Đã ghi hôm nay`), 'ok') : ''}
        ${s.stale ? badge(s.lastLog ? `${s.daysSinceUpdate} ngày chưa cập nhật` : 'Chưa có nhật ký', 'warn') : ''}
        ${s.warnings.map((w) => badge(w, 'danger'))}
        ${s.checks.map((c) => badge(c.short, CHECK_TONE[c.level]))}
        ${s.openHealth.length ? badge(raw(`${icon('heart')} Theo dõi sức khoẻ`), 'danger') : ''}
        ${s.longRest ? badge('Nghỉ lâu — đánh giá lại', 'orange') : ''}
      </div>
    </div>
    ${hideNote ? '' : noteBlock(store, s.note, { openCount: s.openNotes.length })}
    ${sum ? html`<div class="cc-nums">
        <div class="cc-num gold"><b>${sum.eggs}</b><span>Trứng đẻ</span></div>
        <div class="cc-num"><b>${sum.fertile}</b><span>Có cồ</span></div>
        <div class="cc-num"><b>${sum.infertile}</b><span>Không cồ</span></div>
        <div class="cc-num red"><b>${sum.damaged}</b><span>Hỏng</span></div>
        <div class="cc-num green"><b>${sum.hatched}</b><span>Đã nở</span></div>
        <div class="cc-num green"><b>${sum.chicks}</b><span>Non hiện tại</span></div>
        <div class="cc-num"><b>${sum.pending}</b><span>Chờ kết quả</span></div>
        <div class="cc-num"><b>${sum.fledged}</b><span>Ra ràng</span></div>
      </div>` : ''}
    <div class="cc-meta">
      ${s.clutch ? html`<span>Lứa <b>${s.clutch.code}</b> · từ ${fmtDateShort(s.clutch.start_date)}</span>` : ''}
      <span>${restText(s)}</span>
      <span>Cập nhật: <b>${s.lastLog ? `${fmtDate(s.lastLog.log_date)} (${relativeDays(s.daysSinceUpdate)})` : 'chưa có'}</b></span>
    </div>
    <div class="cc-actions">
      <button class="btn primary" data-act="today" ${s.pair ? '' : raw('data-no-pair="1"')}>${icon('clipboard')} Cập nhật hôm nay</button>
      <button class="btn soft" data-act="edit" title="Sửa nhật ký gần nhất">${icon('edit')} Sửa</button>
      <button class="btn soft" data-act="history">${icon('history')} Lịch sử</button>
      <a class="btn soft" href="#/cage/${s.cage.id}">${icon('info')} Chi tiết</a>
    </div>
  </article>`;
}

export function bindCageCards(root, app) {
  root.addEventListener('click', (e) => {
    const exp = e.target.closest('[data-expand]');
    if (exp) { const n = exp.closest('[data-note]'); n.classList.toggle('expanded'); exp.textContent = n.classList.contains('expanded') ? 'Thu gọn' : 'Xem thêm'; return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const cageId = b.closest('[data-cage]')?.dataset.cage;
    if (!cageId) return;
    const st = app.store;
    if (b.dataset.act === 'today') {
      // KHÔNG dùng thuộc tính disabled (nút bị vô hiệu không phát sự kiện, "title" không hiện trên điện thoại => bấm im lặng)
      if (!currentPair(st.db.pairs, cageId)) openNoPairNotice(app, cageId);
      else openDailyForm(app, cageId, { date: st.today() });
    }
    if (b.dataset.act === 'edit') {
      const logs = logsOfCage(st.db.daily_logs, cageId);
      const last = logs[logs.length - 1];
      if (last) openDailyForm(app, cageId, { logId: last.id });
      else if (st.can('settings.write')) openCageForm(app, cageId);
      else toast('Lồng chưa có nhật ký để sửa', 'warn');
    }
    if (b.dataset.act === 'history') openHistory(app, cageId);
  });
}

export function renderList(app, _p, query) {
  const s = app.store;
  const today = s.today();
  const f = FILTERS.some(([k]) => k === query.f) ? query.f : 'all';
  const q = query.q || '';
  const states = s.db.cages.filter((c) => !c.archived && !c.deleted).sort(byCageCode)
    .map((c) => cageState(c, s.db, today, s.settings));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, states.filter(filterFn[k]).length]));
  const list = states.filter(filterFn[f]).filter((x) => matches(q, x.cage.code, x.cage.name, s.birdName(x.pair?.male_id), s.birdName(x.pair?.female_id), x.note?.text));
  const logged = states.filter((x) => x.loggedToday).length;
  return {
    html: html`
      <div class="page-head"><div class="grow"><h1>Lồng sinh sản</h1><div class="sub">Đã ghi hôm nay ${logged}/${states.filter((x) => x.pair).length} lồng có cặp</div></div>
        ${s.can('settings.write') ? html`<button class="btn soft sm" data-new-cage>${icon('plus')} Lồng</button>` : ''}</div>
      <label class="search">${icon('search')}<input type="search" placeholder="Tìm mã lồng, chim, ghi chú…" value="${q}" data-q aria-label="Tìm kiếm lồng"></label>
      <div class="chips" role="tablist">${FILTERS.map(([k, l]) => html`<a class="chip ${k === f ? 'active' : ''}" href="#/cages?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ''}">${l} <b>${counts[k]}</b></a>`)}</div>
      ${list.length ? html`<div class="cage-list">${list.map((x) => cageCard(s, x))}</div>` : empty('Không có lồng nào khớp bộ lọc.', cageArt(72))}
      <p class="def">${NUMS_LEGEND}</p>
    `,
    mount(root) {
      bindCageCards(root, app);
      const qi = root.querySelector('[data-q]');
      let t;
      qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', `#/cages?f=${f}&q=${encodeURIComponent(qi.value)}`); app.render(); const n = document.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
      root.querySelector('[data-new-cage]')?.addEventListener('click', () => openCageForm(app, null));
    },
  };
}

export function logCard(store, log, prev, { editable = true, today } = {}) {
  const d = prev && prev.clutch_id === log.clutch_id ? describeDelta(snapshotDelta(prev, log)) : '';
  const clutch = log.clutch_id ? store.byId('clutches', log.clutch_id) : null;
  return html`<div class="tl-item ${log.log_date === today ? 'today' : ''}">
    <div class="tl-head"><b>${fmtDate(log.log_date)}</b>${log.log_date === today ? badge('Hôm nay', 'ok') : ''}
      ${clutch ? badge(clutch.code, 'info') : badge('Không thuộc lứa', 'muted')}<span class="grow"></span>
      ${editable ? html`<button class="btn soft sm" data-edit-log="${log.id}" data-cage-id="${log.cage_id}">${icon('edit')} Sửa</button>` : ''}</div>
    ${clutch ? html`<div class="small num">Trứng ${log.eggs} · có cồ ${log.fertile} · không cồ ${log.infertile} · hỏng ${log.damaged} · nở ${log.hatched} · non ${log.chicks} · ra ràng ${log.fledged}</div>` : ''}
    ${d ? html`<div class="tl-delta">Biến động so với lần trước: ${d}</div>` : ''}
    <div class="small muted">Bố mẹ: ${log.parents_status} · Tổ: ${log.nest_status}</div>
    ${noteList(store, notesOfLog(store.db, log))}
    ${log.legacy && log.legacy.eggs_in_nest !== undefined ? html`<div class="small num muted">Số liệu gốc V1: ${log.legacy.eggs_in_nest} trứng đang trong tổ · ${log.legacy.chicks} chim non · ${log.legacy.bad} hỏng${log.legacy.fertile != null ? ` · ${log.legacy.fertile} có cồ` : ''}</div>` : ''}
    ${log.photo_ids?.length ? html`<div class="thumbs">${log.photo_ids.map((id) => thumb(id))}</div>` : ''}
    ${(() => {
      // Ảnh V1 của nhật ký + ảnh riêng của bản ghi khác cùng ngày (V1 cho ghi nhiều lần / ngày — xem legacy.same_day)
      const urls = [log.legacy_photo_url, ...(log.legacy?.same_day || []).filter((x) => !x.identical).map((x) => x.data?.img)]
        .filter((u, i, a) => /^https:\/\//.test(u || '') && a.indexOf(u) === i);
      return urls.length ? html`<div class="thumbs">${urls.map((u, i) => html`<a class="thumb" href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="${i ? 'Ảnh V1 — bản ghi khác cùng ngày' : 'Ảnh từ V1'}" loading="lazy" referrerpolicy="no-referrer"></a>`)}</div>` : '';
    })()}
    <div class="tl-meta">Tạo ${fmtDateTime(log.created_at)}${log.version ? html` · <b>đã sửa ${log.version} lần</b>, lần cuối ${fmtDateTime(log.updated_at)}` : ''}</div>
  </div>`;
}

export function historyHtml(store, cageId, limit = 60) {
  const logs = logsOfCage(store.db.daily_logs, cageId);
  const today = store.today();
  const items = [];
  for (let i = logs.length - 1; i >= 0 && items.length < limit; i--) items.push(logCard(store, logs[i], logs[i - 1], { today, editable: store.can('breeding.write') }));
  return items.length ? html`<div class="timeline">${items}</div>` : empty('Chưa có nhật ký.', nestArt(64, 0));
}

function bindHistory(root, app) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit-log]');
    if (b) openDailyForm(app, b.dataset.cageId, { logId: b.dataset.editLog });
  });
  bindNoteActions(root, app);
}

export function openHistory(app, cageId) {
  const cage = app.store.byId('cages', cageId);
  openSheet({
    title: `Lịch sử ${cage.code}`, subtitle: 'Nhật ký theo thời gian (mới nhất trước)', size: 'wide',
    body: historyHtml(app.store, cageId),
    onMount: (el) => { bindHistory(el, app); import('../services/photos.js').then((m) => m.hydratePhotos(app.store, el)); },
  });
}

export function renderDetail(app, { id }, query) {
  const s = app.store;
  const cage = s.byId('cages', id);
  if (!cage) return { html: empty('Không tìm thấy lồng.') };
  const st = cageState(cage, s.db, s.today(), s.settings);
  const tab = query.tab || 'overview';
  const tabs = [['overview', 'Tổng quan'], ['history', 'Nhật ký'], ['clutches', 'Các lứa'], ['rest', 'Nghỉ đẻ'], ['mates', 'Thay chim'], ['health', 'Sức khoẻ']];
  const canW = s.can('breeding.write');
  let body;
  if (tab === 'history') body = historyHtml(s, id, 400);
  else if (tab === 'clutches') body = clutchesTab(s, id);
  else if (tab === 'rest') body = restTab(s, st, canW);
  else if (tab === 'mates') body = matesTab(s, id, canW);
  else if (tab === 'health') body = healthTab(s, id);
  else body = overviewTab(s, st, canW);
  return {
    html: html`
      <div class="page-head"><a class="back" href="#/cages" aria-label="Quay lại">${icon('back')}</a>
        <div class="grow"><h1>${cage.code}</h1><div class="sub">${CAGE_STATUS_LABELS[st.status]}${cage.note ? ` · ${cage.note}` : ''}</div></div>
        ${s.can('settings.write') ? html`<button class="btn ghost sm" data-cage-edit>${icon('edit')} Lồng</button>` : ''}</div>
      ${noteSection(s, st)}
      <div class="tabs">${tabs.map(([k, l]) => html`<a class="tab ${k === tab ? 'active' : ''}" href="#/cage/${id}?tab=${k}">${l}</a>`)}</div>
      ${body}`,
    mount(root) {
      bindCageCards(root, app);
      bindHistory(root, app);
      root.querySelector('[data-cage-edit]')?.addEventListener('click', () => openCageForm(app, id));
      root.addEventListener('click', (e) => {
        const a = e.target.closest('[data-do]');
        if (!a) return;
        const k = a.dataset.do;
        if (k === 'close') openCloseClutch(app, a.dataset.id);
        if (k === 'clutch-start') openEditClutchStart(app, a.dataset.id);
        if (k === 'rest-start') openRestForm(app, id, null);
        if (k === 'rest-edit') openRestForm(app, id, a.dataset.id);
        if (k === 'mate') openPairSheet(app, id);
        if (k === 'pair') openPairSheet(app, id);
        if (k === 'health') openHealthForm(app, null, { cage_id: id });
      });
    },
  };
}

/** Đầu trang Chi tiết lồng: ghi chú mới nhất + các việc "Cần xử lý" còn mở (B19). */
function noteSection(s, st) {
  const others = st.openNotes.filter((n) => n.id !== st.note?.id);
  return html`<div class="note-section" data-cage="${st.cage.id}"><div class="section"><h2>Ghi chú mới nhất</h2>${s.can('breeding.write') ? html`<button class="btn soft sm" data-act="today">${icon('plus')} Thêm ghi chú</button>` : ''}</div>
    ${noteBlock(s, st.note, { actions: true })}</div>
    ${others.length ? html`<div class="section"><h2>Việc cần xử lý khác (${others.length})</h2></div>${noteList(s, others)}` : ''}`;
}

function overviewTab(s, st, canW) {
  const perf = st.pair ? pairPerformance(s.db, { pairId: st.pair.id }) : null;
  return html`
    ${cageCard(s, st, { hideNote: true })}
    ${st.checks.length ? html`<div class="section"><h2>Số liệu cần đối chiếu</h2></div>
    <div class="card"><div class="list">${st.checks.map((c) => html`<div class="row"><span class="row-icon ${CHECK_ICON[c.level]}">${icon(c.level === 'info' ? 'info' : 'alert')}</span><span class="grow"><span class="desc">${c.text}</span></span></div>`)}</div></div>` : ''}
    <div class="section"><h2>Cặp bố mẹ hiện tại</h2></div>
    <div class="card">${st.pair ? html`<dl class="kv">
        <dt>Trống</dt><dd><a href="#/bird/${st.pair.male_id}">${s.birdName(st.pair.male_id)}</a></dd>
        <dt>Mái</dt><dd><a href="#/bird/${st.pair.female_id}">${s.birdName(st.pair.female_id)}</a></dd>
        <dt>Ngày ghép</dt><dd>${fmtDate(st.pair.start_date)}</dd></dl>
        ${canW ? html`<div class="btn-row" style="margin-top:12px"><button class="btn soft" data-do="mate">${icon('swap')} Thay trống / Thay mái / Kết thúc cặp</button></div>` : ''}`
      : html`<p class="muted">Lồng chưa ghép cặp.</p>${canW ? html`<button class="btn primary block" data-do="pair">${icon('plus')} Ghép cặp cho lồng</button>` : ''}`}
    </div>
    ${st.clutch && canW ? html`<div class="section"><h2>Lứa đang mở · ${st.clutch.code}</h2><a href="#/clutch/${st.clutch.id}">Chi tiết lứa</a></div>
      <div class="card"><p class="small muted">Kết thúc lứa khi đã tách hết chim non (bắt đầu tính nghỉ đẻ) hoặc khi lứa hỏng.</p>
      <button class="btn soft block" data-do="close" data-id="${st.clutch.id}">${icon('check')} Kết thúc lứa</button>
      ${s.can('clutch.edit') ? html`<button class="btn ghost block" data-do="clutch-start" data-id="${st.clutch.id}" style="margin-top:8px">${icon('edit')} Sửa ngày bắt đầu lứa (${fmtDate(st.clutch.start_date)})</button>` : ''}</div>` : ''}
    ${!st.clutch && st.rest.state !== 'resting' && st.pair && canW ? html`<div class="card" style="margin-top:12px"><p class="small muted">Lồng không có lứa mở và chưa có kỳ nghỉ. Xác nhận ngày bắt đầu nghỉ để tính số ngày nghỉ đẻ.</p>
      <button class="btn soft block" data-do="rest-start">${icon('moon')} Xác nhận bắt đầu nghỉ</button></div>` : ''}
    ${perf ? html`<div class="section"><h2>Hiệu suất cặp hiện tại</h2><a href="#/performance">So sánh</a></div>
      <div class="card"><dl class="kv">
        <dt>Số lứa</dt><dd>${perf.clutches} (${perf.closed} đã kết thúc)</dd>
        <dt>Tổng trứng</dt><dd>${perf.eggs}</dd><dt>Đã nở</dt><dd>${perf.hatched}</dd><dt>Ra ràng</dt><dd>${perf.fledged}</dd>
        <dt>Tỷ lệ có cồ</dt><dd>${fmtPct(perf.fertilityRate)}</dd><dt>Tỷ lệ nở</dt><dd>${fmtPct(perf.hatchRate)}</dd>
        <dt>Sống đến ra ràng</dt><dd>${fmtPct(perf.fledgeRate)}</dd>
        <dt>Nghỉ giữa các lứa</dt><dd>${perf.restDays.length ? `${perf.restDays.join(', ')} ngày` : 'Chưa đủ dữ liệu'}</dd></dl></div>` : ''}`;
}

function clutchesTab(s, cageId) {
  const list = s.db.clutches.filter((c) => c.cage_id === cageId && !c.deleted).sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (!list.length) return empty('Lồng chưa có lứa nào.', nestArt(64, 0));
  return html`<div class="card"><div class="list">${list.map((c) => {
    const sm = clutchSummary(c, s.db.daily_logs);
    const pair = s.byId('pairs', c.pair_id);
    const mm = c.legacy_inferred ? null : chickMismatch(c.code, sm);
    return html`<a class="row" href="#/clutch/${c.id}"><span class="row-icon gold">${icon('egg')}</span><span class="grow">
      <span class="title">${c.code}</span> ${badge(STAGE_LABELS[sm.stage], c.status === 'closed' ? 'muted' : 'warn')}${mm ? badge(mm.short, 'warn') : ''}<br>
      <span class="desc">${fmtDate(c.start_date)} → ${c.end_date ? fmtDate(c.end_date) : 'nay'} · Bố mẹ: ${pair ? `${s.birdName(pair.male_id)} × ${s.birdName(pair.female_id)}` : 'chưa ghi nhận'}</span><br>
      <span class="desc num">Trứng ${sm.eggs} · có cồ ${sm.fertile} · nở ${sm.hatched} · ra ràng ${sm.fledged} · tỷ lệ nở ${fmtPct(sm.hatchRate)}</span></span>${icon('chevron')}</a>`;
  })}</div></div>`;
}

function restTab(s, st, canW) {
  const list = s.db.rest_periods.filter((p) => p.cage_id === st.cage.id && !p.deleted).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const done = completedRestDays(s.db.rest_periods, st.cage.id);
  return html`<div class="card"><div class="card-title">${icon('moon')} Số ngày nghỉ đẻ</div>
      <p style="font-size:18px;margin:0">${restText(st)}</p>
      ${st.rest.state === 'resting' && st.rest.period.expected_review_date ? html`<p class="small muted">Dự kiến đánh giá lại: ${fmtDate(st.rest.period.expected_review_date)}</p>` : ''}
      ${st.longRest ? html`<div class="msg warn" style="margin-top:8px">${icon('info')} Đã nghỉ quá ${s.settings.longRestDays} ngày. Hãy đánh giá lại điều kiện nuôi (ánh sáng, dinh dưỡng, tổ) và sức khoẻ cặp chim. Cảnh báo này không có nghĩa phải thay trống/mái.</div>` : ''}
      <p class="def">Định nghĩa: bắt đầu nghỉ = ngày tách hết chim non lứa trước hoặc ngày nghỉ được xác nhận; kết thúc = ngày có quả trứng đầu tiên của lứa sau. Thiếu ngày bắt đầu => "Chưa đủ dữ liệu". Không suy đoán từ ngày ghi nhật ký.</p>
      ${canW && !st.clutch && st.rest.state !== 'resting' && st.pair ? html`<button class="btn soft block" data-do="rest-start">${icon('plus')} Xác nhận bắt đầu nghỉ</button>` : ''}
    </div>
    <div class="section"><h2>Lịch nghỉ & phục hồi</h2><span class="small muted">${done.length ? `TB ${Math.round(done.reduce((a, b) => a + b, 0) / done.length)} ngày` : ''}</span></div>
    ${list.length ? html`<div class="timeline">${list.map((p) => html`<div class="tl-item">
      <div class="tl-head"><b>${p.start_date ? fmtDate(p.start_date) : 'Chưa rõ ngày'} → ${p.end_date ? fmtDate(p.end_date) : 'đang nghỉ'}</b><span class="grow"></span>
        ${p.end_date ? badge(`${daysBetween(p.start_date, p.end_date) ?? '?'} ngày`, 'muted') : badge('Đang nghỉ', 'warn')}
        ${canW ? html`<button class="btn soft sm" data-do="rest-edit" data-id="${p.id}">${icon('edit')} Sửa</button>` : ''}</div>
      <div class="small">Lý do: ${p.reason || '—'}${p.expected_review_date ? ` · Đánh giá lại: ${fmtDate(p.expected_review_date)}` : ''}${p.end_reason === 'first_egg' ? ' · Kết thúc: có trứng đầu tiên lứa mới' : p.end_reason ? ` · Kết thúc: ${p.end_reason}` : ''}</div>
      ${p.health_note ? html`<div class="tl-note">Sức khoẻ: ${p.health_note}</div>` : ''}</div>`)}</div>` : empty('Chưa có kỳ nghỉ nào được ghi nhận.')}`;
}

function matesTab(s, cageId, canW) {
  const list = s.db.mate_changes.filter((m) => m.cage_id === cageId && !m.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const pairs = s.db.pairs.filter((p) => p.cage_id === cageId).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  return html`
    ${canW ? html`<button class="btn soft block" data-do="mate" style="margin-bottom:12px">${icon('swap')} Quản lý cặp: thay trống / thay mái / kết thúc</button>` : ''}
    <div class="section"><h2>Nhật ký thay chim</h2></div>
    ${list.length ? html`<div class="timeline">${list.map((m) => html`<div class="tl-item"><div class="tl-head"><b>${fmtDate(m.date)}</b>${badge(m.role === 'male' ? 'Thay trống' : 'Thay mái', 'info')}</div>
      <div>Cũ: <a href="#/bird/${m.old_bird_id}">${s.birdName(m.old_bird_id)}</a> → Mới: <a href="#/bird/${m.new_bird_id}">${s.birdName(m.new_bird_id)}</a></div>
      <div class="small">Lý do: ${m.reason}</div>${m.note ? html`<div class="tl-note">${m.note}</div>` : ''}
      ${m.photo_ids?.length ? html`<div class="thumbs">${m.photo_ids.map((id) => thumb(id))}</div>` : ''}</div>`)}</div>` : empty('Chưa có lần thay chim nào.')}
    <div class="section"><h2>Các cặp đã ở lồng này</h2></div>
    <div class="card"><div class="list">${pairs.map((p) => html`<div class="row"><span class="grow"><span class="title">${s.birdName(p.male_id)} × ${s.birdName(p.female_id)}</span><br>
      <span class="desc">${fmtDate(p.start_date)} → ${p.end_date ? fmtDate(p.end_date) : 'hiện tại'}</span></span></div>`)}</div>
      <p class="def">Mỗi lứa lưu cố định cặp bố mẹ tại thời điểm đẻ, nên thay chim không ghi đè phả hệ của các lứa trước.</p></div>`;
}

function healthTab(s, cageId) {
  const list = s.db.health_cases.filter((h) => h.cage_id === cageId && !h.deleted).sort((a, b) => b.detected_date.localeCompare(a.detected_date));
  return html`${s.can('health.write') ? html`<button class="btn soft block" data-do="health" style="margin-bottom:12px">${icon('plus')} Ghi nhận vấn đề sức khoẻ</button>` : ''}
    ${list.length ? html`<div class="card"><div class="list">${list.map((h) => html`<a class="row" href="#/health/${h.id}"><span class="row-icon red">${icon('heart')}</span>
      <span class="grow"><span class="title">${h.symptoms}</span><br><span class="desc">${fmtDate(h.detected_date)} · ${h.affected_count} con · ${h.status === 'closed' ? 'Đã đóng' : 'Đang theo dõi'}</span></span>${icon('chevron')}</a>`)}</div></div>`
      : empty('Không có hồ sơ sức khoẻ.')}`;
}

export { logsOfClutch };
