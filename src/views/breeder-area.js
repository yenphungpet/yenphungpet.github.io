// Màn hình Chim giống (V2.2.3): khu nuôi chim giống tuyển từ lồng phóng, chuyển lồng giống, ghép cặp vào lồng sinh sản.
// Dùng lại: hồ sơ chim (birds), lồng phóng (form lồng, sổ số lượng), luồng ghép cặp (planCreatePair), lịch sử sửa (audit).
import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { mascot } from '../ui/brand.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, empty, badge, statTile } from '../ui/components.js';
import { BIRD_STATUS, SEX_LABEL, breederStats, birdPlacement } from '../domain/breeders.js';
import { areaBirds, areaSummary, breederPens, birdTimeline, nextBreederCodes, planSelectToArea, planMoveInArea, planPairFromArea, planStopBreeder, PREDICTED } from '../domain/breeder-area.js';
import { pairKinship, activePairOfBird } from '../domain/pairing.js';
import { currentPair, byCageCode } from '../domain/breeding.js';
import { flightPens, penBalance } from '../domain/stock.js';
import { fmtDate } from '../core/dates.js';
import { matches } from '../core/format.js';
import { openBirdForm } from './breeders.js';
import { openPenForm } from './pens.js';
import { openEditHistory } from './edit-history.js';

const STATUS_TONE = { holding: 'ok', paired: 'info', isolated: 'danger', retired: 'muted', sold: 'muted', dead: 'muted', released: 'muted' };
const CUR = new Set(['holding', 'paired', 'isolated', 'retired']);
const VIEWS = [['area', 'Ở khu giống'], ['paired', 'Đang ghép'], ['current', 'Tất cả hiện có'], ['past', 'Đã rời']];
// Giới tính kèm mức chắc chắn trong 1 ô chọn (ít thao tác trên điện thoại)
// Nhãn ngắn để không bị cắt chữ trên điện thoại: đoán = phỏng đoán, nhìn = xem ngoại hình (mũi / da mũi)
const SEX_PICK = {
  unknown: 'Chưa xác định', 'male:guess': 'Trống (đoán)', 'male:visual': 'Trống (nhìn)', 'male:dna': 'Trống (DNA)',
  'female:guess': 'Mái (đoán)', 'female:visual': 'Mái (nhìn)', 'female:dna': 'Mái (DNA)',
};
const sexPick = (v) => { const [sex, conf] = String(v || 'unknown').split(':'); return { sex, sex_confidence: sex === 'unknown' ? null : conf || 'guess' }; };
export const sexText = (b) => `${SEX_LABEL[b.sex || 'unknown']}${b.sex && b.sex !== 'unknown' && PREDICTED.has(b.sex_confidence) ? ' (dự đoán)' : ''}`;
const penName = (s, id) => s.byId('flight_pens', id)?.name;

/** Vị trí hiện tại: lồng giống / lồng sinh sản / chưa xếp lồng. */
export function birdWhere(s, b, place) {
  if (place.activePaired.has(b.id)) return `Lồng SS ${s.byId('cages', activePairOfBird(s.db, b.id)?.cage_id)?.code || '?'}`;
  if (b.status !== 'holding') return BIRD_STATUS[b.status] || b.status;
  return penName(s, b.pen_id) || 'Chưa xếp lồng giống';
}

function row(s, b, place, canW) {
  const inArea = b.status === 'holding' && !place.activePaired.has(b.id);
  return html`<div class="row bird-row" data-bird="${b.id}">
    <a class="bird-main" href="#/bird/${b.id}">
      ${b.photo_ids?.length ? html`<span class="thumb" style="width:48px;height:48px"><img data-photo="${b.photo_ids[0]}" data-size="thumb" alt="Ảnh ${b.ring_code}" loading="lazy"></span>` : html`<span class="row-icon">${icon('bird')}</span>`}
      <span class="grow"><span class="title">${b.ring_code}</span> ${place.activePaired.has(b.id) ? badge('Đang ghép', 'info') : badge(BIRD_STATUS[b.status] || b.status, STATUS_TONE[b.status])}<br>
      <span class="desc">${sexText(b)} · ${b.phenotype || 'chưa ghi màu'}${b.mutation ? ` · ${b.mutation}` : ''}<br>${birdWhere(s, b, place)}</span></span></a>
    ${canW ? html`<span class="bird-acts"><button class="note-pen" data-bact="edit" aria-label="Sửa ${b.ring_code}">${icon('edit')}</button>
      ${inArea ? html`<button class="btn soft sm" data-bact="act">Chuyển / Ghép</button>` : ''}</span>` : ''}</div>`;
}

export function renderArea(app, _p, query) {
  const s = app.store;
  const place = birdPlacement(s.db);
  const st = breederStats(s.db.birds, s.db);
  const sum = areaSummary(s.db);
  const live = s.db.birds.filter((b) => !b.deleted && !place.archivedCage.has(b.id));
  const area = new Set(areaBirds(s.db, place).map((b) => b.id));
  const inView = {
    area: (b) => area.has(b.id), paired: (b) => place.activePaired.has(b.id), current: (b) => CUR.has(b.status),
    past: (b) => ['sold', 'dead', 'released'].includes(b.status),
  };
  const v = inView[query.v] ? query.v : 'area';
  const f = { q: query.q || '', sex: query.sex || '', color: query.color || '', line: query.line || '', pen: query.pen || '' };
  const base = live.filter(inView[v]);
  const list = base.filter((b) => matches(f.q, b.ring_code, b.phenotype, b.mutation, b.note)
    && (!f.sex || (b.sex || 'unknown') === f.sex) && (!f.color || b.phenotype === f.color) && (!f.line || b.mutation === f.line)
    && (!f.pen || (f.pen === '-' ? area.has(b.id) && !penName(s, b.pen_id) : b.pen_id === f.pen && area.has(b.id))))
    .sort((a, b) => a.ring_code.localeCompare(b.ring_code, 'vi', { numeric: true }));
  const distinct = (k) => [...new Set(base.map((b) => b[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const canW = s.can('breeders.write'); const canPen = s.can('settings.write');
  const males = live.filter((b) => CUR.has(b.status) && b.sex === 'male'); const females = live.filter((b) => CUR.has(b.status) && b.sex === 'female');
  const pred = (l) => l.filter((b) => PREDICTED.has(b.sex_confidence)).length;
  const href = (o) => `#/breeders?${new URLSearchParams(Object.entries({ v, ...f, ...o }).filter(([, x]) => x)).toString()}`;
  const nFilters = ['sex', 'color', 'line', 'pen'].filter((k) => f[k]).length;
  return {
    html: html`
      <div class="page-head"><div class="grow"><h1>Chim giống</h1><div class="sub">Khu nuôi chim giống tuyển từ lồng phóng</div></div>
        <a class="btn soft sm" href="#/kinship">${icon('dna')} Huyết thống</a></div>
      <div class="stats">
        ${statTile('Tổng chim giống hiện có', st.total, { tone: 'gold', sub: 'ở khu giống + đang ghép + cách ly + ngưng' })}
        ${statTile('Ở khu giống', sum.total, { tone: 'green', sub: sum.unplaced ? `${sum.unplaced} chưa xếp lồng` : `${sum.byPen.filter((x) => !x.pen.archived).length} lồng giống` })}
        ${statTile('Đang ghép ở lồng SS', st.paired, { sub: 'không tính vào khu giống' })}
        ${statTile('Trống', males.length, { sub: `${pred(males)} dự đoán` })}
        ${statTile('Mái', females.length, { sub: `${pred(females)} dự đoán` })}
        ${statTile('Chưa xác định giới', st.unknownSex)}
      </div>
      <p class="def">Mỗi con chỉ ở 1 nơi: khu giống (lồng giống) hoặc cặp đang ghép ở lồng sinh sản. Tuyển từ lồng phóng trừ đúng số ở lồng phóng; ghép cặp không đổi tổng chim giống.</p>
      ${canW ? html`<div class="btn-row" style="margin:12px 0"><button class="btn primary" data-add>${icon('plus')} Thêm chim giống</button><button class="btn gold" data-select>${icon('bird')} Tuyển từ lồng phóng</button></div>` : ''}
      <div class="card bp-card"><div class="section" style="margin:0 0 6px"><h2 style="font-size:15px">Lồng giống</h2>${canPen ? html`<button class="btn ghost sm" data-pen-new>${icon('plus')} Lồng giống</button>` : ''}</div>
        ${sum.byPen.length || sum.unplaced ? html`<div class="list">${sum.byPen.map(({ pen, n }) => html`<div class="row" data-pen="${pen.id}"><a class="grow" href="${href({ v: 'area', pen: pen.id })}"><span class="title">${pen.name}</span>${pen.archived ? html` ${badge('đã ngừng dùng', 'muted')}` : ''}<br><span class="desc">${pen.purpose || 'Lồng giống'}</span></a>
            <b class="bp-n">${n}</b>${canPen ? html`<button class="note-pen" data-pen-edit aria-label="Sửa ${pen.name}">${icon('edit')}</button>` : ''}</div>`)}
          ${sum.unplaced ? html`<a class="row" href="${href({ v: 'area', pen: '-' })}"><span class="grow"><span class="title">Chưa xếp lồng giống</span><br><span class="desc">Ở khu giống nhưng chưa ghi lồng — bấm Chuyển để xếp</span></span><b class="bp-n">${sum.unplaced}</b></a>` : ''}</div>`
          : html`<p class="small muted">Chưa có lồng giống.${canPen ? ' Bấm "+ Lồng giống" để tạo.' : ' Chủ trại tạo lồng giống.'}</p>`}</div>
      <div class="chips">${VIEWS.map(([k, l]) => html`<a class="chip ${k === v ? 'active' : ''}" href="${href({ v: k, pen: k === 'area' ? f.pen : '' })}">${l} <b>${live.filter(inView[k]).length}</b></a>`)}</div>
      <label class="search">${icon('search')}<input type="search" placeholder="Tìm mã chim, màu, dòng, ghi chú…" value="${f.q}" data-q aria-label="Tìm chim giống"></label>
      <details class="card bf-filter" ${nFilters ? 'open' : ''}><summary>Lọc theo màu, dòng, giới tính, lồng${nFilters ? ` (${nFilters})` : ''}</summary>
        <form class="form" data-filter><div class="grid2">
          ${field('Giới tính', html`<select name="sex"><option value="">Tất cả</option>${options(SEX_LABEL, f.sex)}</select>`)}
          ${field('Lồng giống', html`<select name="pen"><option value="">Tất cả</option>${options({ ...Object.fromEntries(breederPens(s.db, null).map((p) => [p.id, p.name])), '-': 'Chưa xếp lồng' }, f.pen)}</select>`)}
          ${field('Màu', html`<select name="color"><option value="">Tất cả</option>${options(distinct('phenotype'), f.color)}</select>`)}
          ${field('Dòng / mutation', html`<select name="line"><option value="">Tất cả</option>${options(distinct('mutation'), f.line)}</select>`)}</div>
          ${nFilters ? html`<a class="btn ghost sm" href="${href({ sex: '', color: '', line: '', pen: '' })}">Bỏ lọc</a>` : ''}</form></details>
      <div class="card">${list.length ? html`<div class="list">${list.map((b) => row(s, b, place, canW))}</div>` : empty(v === 'area' && !base.length ? 'Khu giống chưa có chim. Bấm "Tuyển từ lồng phóng" hoặc "Thêm chim giống".' : 'Không có chim phù hợp.', mascot(64))}</div>`,
    mount(root) {
      root.querySelector('[data-add]')?.addEventListener('click', () => openBirdForm(app, null, { stay: true }));
      root.querySelector('[data-select]')?.addEventListener('click', () => openSelectToArea(app, null));
      root.querySelector('[data-pen-new]')?.addEventListener('click', () => openPenForm(app, null, { kind: 'breeder' }));
      root.addEventListener('click', (e) => {
        const pe = e.target.closest('[data-pen-edit]');
        if (pe) return openPenForm(app, pe.closest('[data-pen]').dataset.pen);
        const a = e.target.closest('[data-bact]');
        if (!a) return;
        const id = a.closest('[data-bird]').dataset.bird;
        if (a.dataset.bact === 'edit') openBirdForm(app, id, { stay: true });
        else openAreaActions(app, id);
      });
      root.querySelector('[data-filter]').addEventListener('change', (e) => app.navigate(href({ [e.target.name]: e.target.value })));
      const qi = root.querySelector('[data-q]');
      let t;
      qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', href({ q: qi.value })); app.render(); const n = document.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    },
  };
}

/** Lưu kế hoạch; báo lỗi trong form nếu không được (không báo thành công giả). */
async function save(s, plan, msg) {
  if (plan.errors?.length) { showMessages(msg, plan.errors); return false; }
  const r = await s.run(plan, { requires: 'breeders.write' });
  if (!r.ok) { showMessages(msg, r.errors); return false; }
  return true;
}

/** Tuyển 1 hoặc nhiều con từ lồng phóng vào khu giống. */
export function openSelectToArea(app, penId) {
  const s = app.store;
  const pens = flightPens(s.db).filter((p) => penBalance(s.db.stock_movements, p.id) > 0 || p.id === penId);
  const bpens = breederPens(s.db);
  const clutches = s.db.clutches.filter((c) => !c.deleted).sort((a, b) => b.start_date.localeCompare(a.start_date)).slice(0, 80);
  const codes = () => [...document.querySelectorAll('[data-sel-row] [name=ring_code]')].map((i) => i.value.trim()).filter(Boolean);
  const rowHtml = (i, code) => html`<div class="item-line sel-row" data-sel-row>
    <div class="grid2">${field(`Con #${i} — mã chim *`, html`<input name="ring_code" value="${code}" autocomplete="off">`)}
      ${field('Giới tính', html`<select name="sexpick">${options(SEX_PICK, 'unknown')}</select>`)}</div>
    <div class="grid2">${field('Màu', html`<input name="phenotype" placeholder="VD: Xanh lá">`)}${field('Dòng / mutation (nếu biết)', html`<input name="mutation">`)}</div>
    ${field('Ghi chú', html`<input name="note" maxlength="300">`)}</div>`;
  let n = 1;
  openSheet({
    title: 'Tuyển từ lồng phóng', subtitle: 'Trừ số ở lồng phóng, tạo hồ sơ từng con ở khu giống',
    body: html`<form class="form" data-f novalidate>
      ${pens.length ? '' : html`<div class="msg warn">${icon('alert')} <div>Không có lồng phóng nào còn chim.</div></div>`}
      <div class="grid2">${field('Từ lồng phóng *', html`<select name="from_pen_id">${options(Object.fromEntries(pens.map((p) => [p.id, `${p.name} (còn ${penBalance(s.db.stock_movements, p.id)})`])), penId)}</select>`)}
        ${field('Vào lồng giống', html`<select name="to_pen_id">${options({ ...Object.fromEntries(bpens.map((p) => [p.id, p.name])), '': 'Chưa xếp lồng' }, bpens[0]?.id || '')}</select>`)}</div>
      <div class="grid2">${field('Ngày tuyển', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}
        ${field('Lứa gốc (nếu biết)', html`<select name="source_clutch_id"><option value="">Chưa xác định</option>${raw(clutches.map((c) => { const p = s.byId('pairs', c.pair_id); return `<option value="${c.id}">${esc(c.code)} · ${esc(p ? `${s.birdName(p.male_id)} × ${s.birdName(p.female_id)}` : 'chưa rõ bố mẹ')}</option>`; }).join(''))}</select>`, 'Chỉ chọn khi chắc chắn — bố mẹ chép từ cặp của lứa này')}</div>
      <p class="small muted">Giới tính: (đoán) = phỏng đoán · (nhìn) = xem ngoại hình mũi / da mũi · (DNA) = xét nghiệm. Không chắc thì để "Chưa xác định".</p>
      <div data-rows class="sel-rows">${rowHtml(1, nextBreederCodes(s.db, 1, s.today())[0])}</div>
      <button type="button" class="btn soft" data-addrow>${icon('plus')} Thêm 1 con</button>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn gold" data-save>${icon('bird')} Tuyển giống</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-addrow]').addEventListener('click', () => {
        const code = nextBreederCodes(s.db, 1, s.today(), codes())[0];
        el.querySelector('[data-rows]').insertAdjacentHTML('beforeend', String(rowHtml(++n, code)));
        el.querySelector('[data-rows] [data-sel-row]:last-child [name=ring_code]').focus();
      });
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = el.querySelector('[data-f]');
        const birds = [...f.querySelectorAll('[data-sel-row]')].map((r) => ({
          ring_code: r.querySelector('[name=ring_code]').value, ...sexPick(r.querySelector('[name=sexpick]').value),
          phenotype: r.querySelector('[name=phenotype]').value, mutation: r.querySelector('[name=mutation]').value, note: r.querySelector('[name=note]').value,
        }));
        const plan = planSelectToArea(s.db, { date: f.date.value, from_pen_id: f.from_pen_id.value, to_pen_id: f.to_pen_id.value || null, source_clutch_id: f.source_clutch_id.value || null, birds }, s.ctx());
        if (await save(s, plan, el.querySelector('[data-msg]'))) { toast(`Đã tuyển ${plan.birds.length} con vào khu giống`); close(); }
      }));
    },
  });
}

/** Chọn thao tác cho 1 con ở khu giống. */
export function openAreaActions(app, birdId) {
  const s = app.store; const b = s.byId('birds', birdId);
  openSheet({
    title: b.ring_code, subtitle: `${sexText(b)} · ${b.phenotype || 'chưa ghi màu'} · ${penName(s, b.pen_id) || 'chưa xếp lồng giống'}`,
    body: html`<div class="act-list">
      <button class="btn soft" data-a="move">${icon('swap')} Chuyển sang lồng giống khác</button>
      <button class="btn primary" data-a="pair">${icon('heart')} Ghép cặp vào lồng sinh sản</button>
      <button class="btn ghost" data-a="stop">${icon('minus')} Ngừng giữ giống</button>
      <button class="btn ghost" data-a="hist">${icon('history')} Xem lịch sử</button></div>`,
    onMount: (el, close) => el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      ({ move: openMoveSheet, pair: openPairSheet, stop: openStopSheet, hist: openBirdHistory })[a](app, birdId);
    }),
  });
}

/** Chuyển 1 hoặc nhiều con (cùng chỗ hiện tại) sang lồng giống khác. */
export function openMoveSheet(app, birdId) {
  const s = app.store; const b = s.byId('birds', birdId);
  const pens = breederPens(s.db);
  const mates = areaBirds(s.db).filter((x) => (x.pen_id || '') === (b.pen_id || '')).sort((x, y) => x.ring_code.localeCompare(y.ring_code, 'vi', { numeric: true }));
  const targets = pens.filter((p) => p.id !== b.pen_id);
  openSheet({
    title: 'Chuyển lồng giống', subtitle: `Từ ${penName(s, b.pen_id) || 'chưa xếp lồng'}`,
    body: html`<form class="form" data-f novalidate>
      ${targets.length ? '' : html`<div class="msg warn">${icon('alert')} <div>Chưa có lồng giống khác để chuyển.${s.can('settings.write') ? ' Tạo lồng giống ở màn hình Chim giống.' : ' Nhờ chủ trại tạo lồng giống.'}</div></div>`}
      <div class="grid2">${field('Sang lồng giống *', html`<select name="to_pen_id">${options(Object.fromEntries(targets.map((p) => [p.id, p.name])), targets[0]?.id)}</select>`)}
        ${field('Ngày chuyển', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}</div>
      <fieldset class="pick-birds"><legend>Chim chuyển (${mates.length} con cùng chỗ)</legend>
        ${mates.map((x) => html`<label class="check"><input type="checkbox" name="bird_ids" value="${x.id}" ${x.id === birdId ? 'checked' : ''}> <b>${x.ring_code}</b> · ${sexText(x)} · ${x.phenotype || '—'}</label>`)}</fieldset>
      ${field('Ghi chú', html`<input name="note" maxlength="300">`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Chuyển</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const f = el.querySelector('[data-f]');
      const ids = [...f.querySelectorAll('[name=bird_ids]:checked')].map((i) => i.value);
      const plan = planMoveInArea(s.db, { bird_ids: ids, to_pen_id: f.to_pen_id.value, date: f.date.value, note: f.note.value }, s.ctx());
      if (await save(s, plan, el.querySelector('[data-msg]'))) { toast(`Đã chuyển ${ids.length} con sang ${penName(s, f.to_pen_id.value)}`); close(); }
    })),
  });
}

/** Ghép cặp từ khu giống vào lồng sinh sản chưa có cặp. Không tạo lứa. */
export function openPairSheet(app, birdId) {
  const s = app.store; const b = s.byId('birds', birdId);
  const area = areaBirds(s.db).sort((x, y) => x.ring_code.localeCompare(y.ring_code, 'vi', { numeric: true }));
  const cages = s.db.cages.filter((c) => !c.archived && !c.deleted && !currentPair(s.db.pairs, c.id)).sort(byCageCode);
  const role = b.sex === 'female' ? 'female' : 'male';
  const opts = (r, sel) => raw(`<option value="">— Chọn —</option>${area.filter((x) => x.sex !== (r === 'male' ? 'female' : 'male'))
    .map((x) => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.ring_code)} · ${esc(sexText(x))}${x.phenotype ? ' · ' + esc(x.phenotype) : ''} · ${esc(penName(s, x.pen_id) || 'chưa xếp lồng')}</option>`).join('')}`);
  openSheet({
    title: 'Ghép cặp vào lồng sinh sản', subtitle: 'Chim rời khu giống, vẫn tính là chim giống',
    body: html`<form class="form" data-f novalidate>
      ${cages.length ? '' : html`<div class="msg warn">${icon('alert')} <div>Không có lồng sinh sản trống (lồng đã có cặp: dùng Thay trống / Thay mái trong lồng).</div></div>`}
      ${field('Chim trống *', html`<select name="male_id">${opts('male', role === 'male' ? birdId : '')}</select>`)}
      ${field('Chim mái *', html`<select name="female_id">${opts('female', role === 'female' ? birdId : '')}</select>`)}
      <div class="grid2">${field('Lồng sinh sản *', html`<select name="cage_id">${options(Object.fromEntries(cages.map((c) => [c.id, c.code])), cages[0]?.id)}</select>`, 'Chỉ lồng chưa có cặp')}
        ${field('Ngày ghép', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}</div>
      <div data-kin></div>
      <p class="small muted">Không tạo lứa: lứa bắt đầu khi có trứng (Thêm lứa / Cập nhật hôm nay ở lồng).</p>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Ghép cặp</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-f]');
      const kin = () => {
        const m = s.byId('birds', f.male_id.value); const w = s.byId('birds', f.female_id.value);
        const k = m && w && m.id !== w.id ? pairKinship(s.db, m, w) : null;
        el.querySelector('[data-kin]').innerHTML = k ? String(html`<div class="kin ${k.result}">${k.result === 'related' ? icon('alert') : icon('info')} ${k.message}${k.findings?.length ? `: ${k.findings.map((x) => x.name).join('; ')}` : ''}</div>
          ${k.result === 'related' ? html`<label class="check"><input type="checkbox" name="confirmKinship"> Tôi đã biết và vẫn muốn ghép</label>` : ''}`) : '';
      };
      f.addEventListener('change', (e) => { if (['male_id', 'female_id'].includes(e.target.name)) kin(); });
      kin();
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f);
        const plan = planPairFromArea(s.db, { male_id: v.male_id, female_id: v.female_id, cage_id: v.cage_id, date: v.date, confirmKinship: !!v.confirmKinship }, s.ctx());
        if (await save(s, plan, el.querySelector('[data-msg]'))) { toast(`Đã ghép cặp vào ${s.byId('cages', v.cage_id)?.code}`); close(); }
      }));
    },
  });
}

/** Ngừng giữ giống: trả về lồng phóng hoặc chết. Bán: dùng Bán hàng. */
export function openStopSheet(app, birdId) {
  const s = app.store; const b = s.byId('birds', birdId);
  const pens = flightPens(s.db);
  openSheet({
    title: `Ngừng giữ giống ${b.ring_code}`,
    body: html`<form class="form" data-f novalidate>
      <label class="check"><input type="radio" name="reason" value="release" checked> Trả về lồng phóng (lồng phóng +1 con)</label>
      <label class="check"><input type="radio" name="reason" value="dead"> Đã chết</label>
      <div data-to>${field('Lồng phóng nhận *', html`<select name="to_pen_id">${options(Object.fromEntries(pens.map((p) => [p.id, `${p.name} (còn ${penBalance(s.db.stock_movements, p.id)})`])), pens[0]?.id)}</select>`)}</div>
      <div class="grid2">${field('Ngày', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}
        ${field('Ghi chú / nguyên nhân', html`<input name="note" maxlength="300">`, 'Bắt buộc khi chim chết')}</div>
      <p class="small muted">Bán chim giống: tạo đơn ở Bán hàng (chọn loại Chim giống). Hồ sơ và lịch sử giữ nguyên.</p>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-f]');
      const sync = () => { el.querySelector('[data-to]').hidden = formValues(f).reason !== 'release'; };
      f.addEventListener('change', sync);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(f);
        const plan = planStopBreeder(s.db, { bird_id: birdId, reason: v.reason, to_pen_id: v.to_pen_id, date: v.date, note: v.note }, s.ctx());
        if (await save(s, plan, el.querySelector('[data-msg]'))) { toast(v.reason === 'release' ? `${b.ring_code} đã trả về ${penName(s, v.to_pen_id)}` : `Đã ghi ${b.ring_code} chết`); close(); }
      }));
    },
  });
}

export function timelineHtml(s, birdId) {
  const items = birdTimeline(s.db, birdId);
  if (!items.length) return empty('Chưa có lịch sử.');
  return html`<div class="tl">${items.map((x) => html`<div class="tl-item"><div class="small muted">${fmtDate(x.date)}${x.by ? ` · ${s.userName?.(x.by) || ''}` : ''}</div>
    <b>${x.title}</b>${x.detail ? html` <span class="small">${x.detail}</span>` : ''}${x.note ? html`<div class="small">${x.note}</div>` : ''}</div>`)}</div>`;
}

/** Lịch sử 1 con: tuyển / chuyển / ghép / trả về; chủ trại xem thêm lịch sử sửa hồ sơ. */
export function openBirdHistory(app, birdId) {
  const s = app.store; const b = s.byId('birds', birdId);
  openSheet({
    title: `Lịch sử ${b.ring_code}`, subtitle: `Lồng phóng nguồn: ${penName(s, b.source_pen_id) || 'chưa xác định'}`,
    body: html`${timelineHtml(s, birdId)}${s.can('settings.write') ? html`<button class="btn ghost" data-audit style="margin-top:10px">${icon('history')} Lịch sử sửa hồ sơ</button>` : ''}`,
    onMount: (el) => el.querySelector('[data-audit]')?.addEventListener('click', () => openEditHistory(app, 'birds', birdId)),
  });
}
