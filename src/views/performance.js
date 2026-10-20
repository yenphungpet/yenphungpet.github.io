import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { nestArt } from '../ui/brand.js';
import { empty, badge, thumb } from '../ui/components.js';
import { clutchSummary, pairPerformance, logsOfClutch, STAGE_LABELS, METRIC_LABELS, METRIC_KIND, KIND_LABELS, METRIC_ORDER, chickMismatch, inFarmStats } from '../domain/breeding.js';
import { fmtDate, addDays } from '../core/dates.js';
import { fmtPct } from '../core/format.js';
import { logCard } from './cages.js';

function rate(label, r, detail) {
  return html`<div class="rate"><div class="rate-head"><span>${label}</span><span>${fmtPct(r, 1)}</span></div>
    <div class="progress"><i style="width:${r === null ? 0 : Math.round(r * 100)}%"></i></div><small>${detail}</small></div>`;
}

export function render(app, _p, query) {
  const s = app.store;
  const today = s.today();
  const ranges = { all: ['Toàn bộ', null, null], '90': ['90 ngày', addDays(today, -90), today], '180': ['180 ngày', addDays(today, -180), today], year: ['Năm nay', `${today.slice(0, 4)}-01-01`, today] };
  const rk = ranges[query.r] ? query.r : 'all';
  const [, from, to] = ranges[rk];
  const farm = pairPerformance(s.db, { from, to });
  // Cùng quy tắc với Tổng quan: lồng đã lưu trữ không vào thống kê toàn trại
  const pairs = s.db.pairs.filter((p) => !p.deleted && inFarmStats(s.db, { cage_id: p.cage_id }));
  const rows = pairs.map((p) => ({ p, perf: pairPerformance(s.db, { pairId: p.id, from, to }) })).filter((x) => x.perf.clutches > 0)
    .sort((a, b) => (b.perf.fledged - a.perf.fledged) || ((b.perf.hatchRate ?? -1) - (a.perf.hatchRate ?? -1)));
  const clutches = s.db.clutches.filter((c) => inFarmStats(s.db, c) && (!from || c.start_date >= from) && (!to || c.start_date <= to)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const candled = farm.fertile + farm.infertile;
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Hiệu suất sinh sản</h1><div class="sub">Lứa, tỷ lệ có cồ, tỷ lệ nở, ra ràng</div></div></div>
      <div class="chips">${Object.entries(ranges).map(([k, [l]]) => html`<a class="chip ${k === rk ? 'active' : ''}" href="#/performance?r=${k}">${l}</a>`)}</div>
      <div class="card">
        <div class="card-title">${icon('chart')} Toàn trại · ${farm.clutches} lứa (${farm.closed} đã kết thúc)</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${rate('Tỷ lệ trứng có cồ', farm.fertilityRate, `${farm.fertile} có cồ / ${candled} trứng đã soi (không tính trứng chưa soi)`)}
          ${rate('Tỷ lệ nở (trên trứng có cồ)', farm.hatchRate, `${farm.resolvedHatched} nở / ${farm.resolvedFertile} trứng có cồ — chỉ tính lứa đã có kết quả cuối cùng`)}
          ${rate('Tỷ lệ sống đến ra ràng', farm.fledgeRate, `${farm.closedFledged} ra ràng / ${farm.closedHatched} nở — chỉ tính lứa đã kết thúc`)}
        </div>
        <div class="def"><b>Công thức:</b><br>
          • Tỷ lệ có cồ = trứng xác nhận có cồ ÷ (có cồ + không cồ). Trứng chưa soi/đang ấp không bị tính là không cồ hay hỏng.<br>
          • Tỷ lệ nở = trứng đã nở ÷ trứng có cồ, chỉ với các lứa mà mọi trứng đã có kết quả (đã nở, hỏng hoặc không cồ) hoặc lứa đã kết thúc.<br>
          • Tỷ lệ ra ràng = chim ra ràng ÷ chim nở, chỉ với lứa đã kết thúc.</div>
      </div>

      <div class="section"><h2>So sánh các cặp</h2><span class="small muted">theo ngày bắt đầu lứa</span></div>
      <div class="card scroll-x">${rows.length ? html`<table class="table"><thead><tr><th>Lồng · cặp</th><th class="r">Lứa</th><th class="r">Trứng</th><th class="r">Nở</th><th class="r">Ra ràng</th><th class="r">Có cồ</th><th class="r">Nở</th><th class="r">Ra ràng</th><th class="r">Nghỉ TB</th></tr></thead>
        <tbody>${rows.map(({ p, perf }) => html`<tr><td><a href="#/cage/${p.cage_id}"><b>${s.byId('cages', p.cage_id)?.code}</b></a><br><span class="small muted">${s.birdName(p.male_id)} × ${s.birdName(p.female_id)}${p.end_date ? ` (đến ${fmtDate(p.end_date)})` : ''}</span></td>
          <td class="r">${perf.clutches}</td><td class="r">${perf.eggs}</td><td class="r">${perf.hatched}</td><td class="r">${perf.fledged}</td>
          <td class="r">${fmtPct(perf.fertilityRate)}</td><td class="r">${fmtPct(perf.hatchRate)}</td><td class="r">${fmtPct(perf.fledgeRate)}</td>
          <td class="r">${perf.avgRestDays === null ? '—' : `${Math.round(perf.avgRestDays)}n`}</td></tr>`)}</tbody></table>` : empty('Chưa có lứa trong khoảng thời gian này.', nestArt(64, 0))}</div>

      <div class="section"><h2>Các lứa sinh sản</h2></div>
      <div class="card">${clutches.length ? html`<div class="list">${clutches.map((c) => {
        const sm = clutchSummary(c, s.db.daily_logs);
        const mm = c.legacy_inferred ? null : chickMismatch(c.code, sm);
        return html`<a class="row" href="#/clutch/${c.id}"><span class="row-icon gold">${icon('egg')}</span><span class="grow"><span class="title">${c.code}</span> ${badge(STAGE_LABELS[sm.stage], c.status === 'closed' ? 'muted' : 'warn')}${mm ? badge(mm.short, 'warn') : ''}<br>
          <span class="desc num">${fmtDate(c.start_date)} · trứng ${sm.eggs} · có cồ ${sm.fertile} · nở ${sm.hatched} · ra ràng ${sm.fledged}</span></span>${icon('chevron')}</a>`;
      })}</div>` : empty('Chưa có lứa.')}</div>`,
  };
}

export function renderClutch(app, { id }) {
  const s = app.store;
  const c = s.byId('clutches', id);
  if (!c) return { html: empty('Không tìm thấy lứa.') };
  const sm = clutchSummary(c, s.db.daily_logs);
  const pair = s.byId('pairs', c.pair_id);
  const cage = s.byId('cages', c.cage_id);
  const logs = logsOfClutch(s.db.daily_logs, id);
  const photos = logs.flatMap((l) => l.photo_ids || []);
  const moved = s.db.stock_movements.filter((m) => m.source_clutch_id === id && !m.deleted);
  const birds = s.db.birds.filter((b) => b.origin_clutch_id === id);
  const mm = c.legacy_inferred ? null : chickMismatch(c.code, sm);
  const canEdit = s.can('clutch.edit');
  return {
    html: html`<div class="page-head"><a class="back" href="#/cage/${c.cage_id}?tab=clutches">${icon('back')}</a><div class="grow"><h1>Lứa ${c.code}</h1><div class="sub">${STAGE_LABELS[sm.stage]}</div></div></div>
      <div class="card"><dl class="kv">
        <dt>Mã lứa</dt><dd>${c.code}</dd><dt>Lồng</dt><dd><a href="#/cage/${c.cage_id}">${cage?.code}</a></dd>
        <dt>Bố</dt><dd>${pair ? html`<a href="#/bird/${pair.male_id}">${s.birdName(pair.male_id)}</a>` : 'Chưa ghi nhận'}</dd>
        <dt>Mẹ</dt><dd>${pair ? html`<a href="#/bird/${pair.female_id}">${s.birdName(pair.female_id)}</a>` : 'Chưa ghi nhận'}</dd>
        <dt>Ngày bắt đầu lứa</dt><dd>${fmtDate(c.start_date)}${canEdit ? html` <button class="btn soft sm" data-edit-start>${icon('edit')} Sửa ngày</button>` : ''}</dd><dt>Ngày kết thúc</dt><dd>${c.end_date ? `${fmtDate(c.end_date)} · ${{ weaned: 'Tách hết non', failed: 'Lứa hỏng', other: 'Khác' }[c.end_reason] || c.end_reason}` : 'Đang mở'}</dd>
        ${METRIC_ORDER.map((f) => html`<dt>${METRIC_LABELS[f]} <span class="small muted">(${KIND_LABELS[METRIC_KIND[f]]})</span></dt><dd>${sm[f]}</dd>`)}
        <dt>Kết quả soi (có cồ)</dt><dd>${fmtPct(sm.fertilityRate)} (${sm.fertile}/${sm.fertile + sm.infertile} đã soi)</dd>
        <dt>Tỷ lệ nở</dt><dd>${sm.hatchRate === null ? 'Chưa có kết quả cuối cùng' : fmtPct(sm.hatchRate)}</dd>
        <dt>Tỷ lệ ra ràng</dt><dd>${sm.fledgeRate === null ? 'Chưa kết thúc lứa' : fmtPct(sm.fledgeRate)}</dd></dl>
        <p class="def">Cộng dồn = tổng của cả lứa tính đến lần ghi mới nhất (chỉ tăng). Hiện tại = tình trạng lúc này; Tổng quan chỉ cộng số hiện tại của các lứa đang mở.</p></div>
      ${mm ? html`<div class="msg warn" data-chick-mismatch>${icon('alert')} <div>${mm.text}</div></div>` : ''}
      ${moved.length ? html`<div class="section"><h2>Đã chuyển ra lồng phóng</h2></div><div class="card"><div class="list">${moved.map((m) => html`<div class="row"><span class="grow">${fmtDate(m.date)} · ${m.qty} con → ${s.byId('flight_pens', m.to_pen_id)?.name || '—'}</span></div>`)}</div></div>` : ''}
      ${birds.length ? html`<div class="section"><h2>Cá thể tuyển làm giống</h2></div><div class="card"><div class="list">${birds.map((b) => html`<a class="row" href="#/bird/${b.id}"><span class="grow"><b>${b.ring_code}</b> · ${b.phenotype || ''}</span>${icon('chevron')}</a>`)}</div></div>` : ''}
      ${photos.length ? html`<div class="section"><h2>Ảnh của lứa</h2></div><div class="thumbs">${photos.map((p) => thumb(p))}</div>` : ''}
      <div class="section"><h2>Lịch sử lứa</h2></div>
      <div class="timeline">${logs.slice().reverse().map((l, i, arr) => logCard(s, l, arr[i + 1], { today: s.today(), editable: s.can('breeding.write') }))}</div>`,
    mount(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-edit-log]');
        if (b) import('./breeding-forms.js').then((m) => m.openDailyForm(app, b.dataset.cageId, { logId: b.dataset.editLog }));
        if (e.target.closest('[data-edit-start]')) import('./breeding-forms.js').then((m) => m.openEditClutchStart(app, id));
      });
    },
  };
}
