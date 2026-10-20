import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { mascot } from '../ui/brand.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, empty, badge, statTile, thumb } from '../ui/components.js';
import { photoPickerHtml, mountPhotoPicker, photosReady } from '../ui/photo-picker.js';
import { BIRD_STATUS, SEX_LABEL, SEX_CONFIDENCE, breederStats, birdPlacement, validateBird, planSelectBreeders, kinshipCheck, pedigreeCompleteness } from '../domain/breeders.js';
import { penBalance } from '../domain/stock.js';
import { fmtDate } from '../core/dates.js';
import { matches } from '../core/format.js';
import { uid } from '../core/ids.js';

const STATUS_TONE = { holding: 'ok', paired: 'info', isolated: 'danger', retired: 'muted', sold: 'muted', dead: 'muted' };
const FILTERS = [['current', 'Hiện tại'], ['holding', 'Trong Lồng Giống'], ['paired', 'Đã ghép'], ['male', 'Trống'], ['female', 'Mái'], ['unknown', 'Chưa rõ giới'], ['past', 'Đã bán/chết/ngưng']];
const CUR = new Set(['holding', 'paired', 'isolated', 'retired']);
// "Đã ghép" theo cặp đang mở thật sự (birdPlacement); cá thể chỉ thuộc lồng đã lưu trữ bị ẩn như lồng đó.
const FF = {
  current: (b) => CUR.has(b.status), holding: (b, p) => b.status === 'holding' && !p.activePaired.has(b.id), paired: (b, p) => p.activePaired.has(b.id),
  male: (b) => CUR.has(b.status) && b.sex === 'male', female: (b) => CUR.has(b.status) && b.sex === 'female',
  unknown: (b) => CUR.has(b.status) && (!b.sex || b.sex === 'unknown'), past: (b) => ['sold', 'dead', 'retired'].includes(b.status),
};

function birdRow(s, b) {
  return html`<a class="row" href="#/bird/${b.id}">
    ${b.photo_ids?.length ? html`<span class="thumb" style="width:52px;height:52px"><img data-photo="${b.photo_ids[0]}" data-size="thumb" alt="Ảnh ${b.ring_code}" loading="lazy"></span>` : html`<span class="row-icon">${icon('bird')}</span>`}
    <span class="grow"><span class="title">${b.ring_code}</span> ${badge(BIRD_STATUS[b.status] || b.status, STATUS_TONE[b.status])}<br>
    <span class="desc">${SEX_LABEL[b.sex || 'unknown']}${b.sex !== 'unknown' && b.sex_confidence ? ` (${b.sex_confidence === 'dna' || b.sex_confidence === 'confirmed' ? 'đã xác minh' : 'chưa xác minh'})` : ''} · ${b.phenotype || b.mutation || 'chưa ghi màu'}${b.selected_date ? ` · tuyển ${fmtDate(b.selected_date)}` : ''}</span></span>${icon('chevron')}</a>`;
}

export function renderList(app, _p, query) {
  const s = app.store;
  const st = breederStats(s.db.birds, s.db);
  const place = birdPlacement(s.db);
  const shown = (k) => (b) => !b.deleted && !place.archivedCage.has(b.id) && FF[k](b, place);
  const f = FF[query.f] ? query.f : 'current';
  const q = query.q || '';
  const list = s.db.birds.filter((b) => shown(f)(b) && matches(q, b.ring_code, b.phenotype, b.mutation, b.note))
    .sort((a, b) => a.ring_code.localeCompare(b.ring_code));
  const canW = s.can('breeders.write');
  return {
    html: html`
      <div class="page-head"><div class="grow"><h1>Lồng Chim Giống</h1><div class="sub">Quản lý từng cá thể đã tuyển chọn</div></div>
        <a class="btn soft sm" href="#/kinship">${icon('dna')} Huyết thống</a></div>
      <div class="stats">
        ${statTile('Tổng chim giống hiện tại', st.total, { tone: 'gold', sub: 'còn sống, thuộc trại' })}
        ${statTile('Trong Lồng Chim Giống', st.inBreederPen, { tone: 'green' })}
        ${statTile('Đang ghép ở lồng SS', st.paired, { sub: 'thuộc cặp đang mở' })}
        ${statTile('Chưa xác định giới', st.unknownSex)}
        ${statTile('Trống đã xác minh', st.maleVerified, { sub: `+ ${st.maleUnverified} chưa xác minh` })}
        ${statTile('Mái đã xác minh', st.femaleVerified, { sub: `+ ${st.femaleUnverified} chưa xác minh` })}
        ${statTile('Cách ly', st.isolated)}
        ${statTile('Ngưng sử dụng', st.retired)}
      </div>
      <p class="def">"Đã xác minh" = xét nghiệm DNA hoặc đã xác nhận qua sinh sản. Tổng chim giống = Trong Lồng Chim Giống + Đang ghép + Cách ly + Ngưng sử dụng. “Đang ghép” đếm theo cặp đang mở của lồng sinh sản đang dùng.${st.hiddenArchived ? ` Ẩn ${st.hiddenArchived} cá thể thuộc lồng đã lưu trữ.` : ''}</p>
      ${canW ? html`<div class="btn-row" style="margin:12px 0"><button class="btn primary" data-add>${icon('plus')} Thêm cá thể</button><button class="btn gold" data-select>${icon('bird')} Tuyển từ lồng phóng</button></div>` : ''}
      <label class="search">${icon('search')}<input type="search" placeholder="Tìm mã vòng, màu, ghi chú…" value="${q}" data-q aria-label="Tìm chim giống"></label>
      <div class="chips">${FILTERS.map(([k, l]) => html`<a class="chip ${k === f ? 'active' : ''}" href="#/breeders?f=${k}">${l} <b>${s.db.birds.filter(shown(k)).length}</b></a>`)}</div>
      <div class="card">${list.length ? html`<div class="list">${list.map((b) => birdRow(s, b))}</div>` : empty('Không có cá thể phù hợp.', mascot(64))}</div>`,
    mount(root) {
      root.querySelector('[data-add]')?.addEventListener('click', () => openBirdForm(app, null));
      root.querySelector('[data-select]')?.addEventListener('click', () => openSelectBreeders(app, null));
      const qi = root.querySelector('[data-q]');
      let t;
      qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', `#/breeders?f=${f}&q=${encodeURIComponent(qi.value)}`); app.render(); const n = document.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
    },
  };
}

function pedigreeNode(s, id, label) {
  const b = id ? s.byId('birds', id) : null;
  return html`<div class="tl-item" style="padding:8px 10px"><div class="small muted">${label}</div>${b ? html`<a href="#/bird/${b.id}"><b>${b.ring_code}</b></a> <span class="small">${b.phenotype || ''}</span>` : html`<span class="muted">Chưa có dữ liệu</span>`}</div>`;
}

export function renderProfile(app, { id }) {
  const s = app.store;
  const b = s.byId('birds', id);
  if (!b) return { html: empty('Không tìm thấy cá thể.') };
  const father = b.father_id ? s.byId('birds', b.father_id) : null;
  const mother = b.mother_id ? s.byId('birds', b.mother_id) : null;
  const kids = s.db.birds.filter((x) => x.father_id === id || x.mother_id === id);
  const pairs = s.db.pairs.filter((p) => p.male_id === id || p.female_id === id);
  const clutches = s.db.clutches.filter((c) => pairs.some((p) => p.id === c.pair_id));
  const comp = pedigreeCompleteness(s.db.birds, id, 2);
  const originClutch = b.origin_clutch_id ? s.byId('clutches', b.origin_clutch_id) : null;
  const originCage = b.origin_cage_id ? s.byId('cages', b.origin_cage_id) : null;
  return {
    html: html`
      <div class="page-head"><a class="back" href="#/breeders">${icon('back')}</a><div class="grow"><h1>${b.ring_code}</h1><div class="sub">${BIRD_STATUS[b.status]}</div></div>
        ${s.can('breeders.write') ? html`<button class="btn soft sm" data-edit>${icon('edit')} Sửa</button>` : ''}</div>
      ${b.photo_ids?.length ? html`<div class="thumbs" style="margin-bottom:12px">${b.photo_ids.map((p) => thumb(p))}</div>` : ''}
      <div class="card"><dl class="kv">
        <dt>Mã / số vòng chân</dt><dd>${b.ring_code}</dd>
        <dt>Giới tính</dt><dd>${SEX_LABEL[b.sex || 'unknown']}${b.sex_confidence ? ` · ${SEX_CONFIDENCE[b.sex_confidence]}` : ''}</dd>
        <dt>Màu / phenotype</dt><dd>${b.phenotype || '—'}</dd>
        <dt>Mutation</dt><dd>${b.mutation || '—'} ${b.mutation ? badge(b.mutation_verified ? 'đã xác minh' : 'chưa xác minh', b.mutation_verified ? 'ok' : 'warn') : ''}</dd>
        <dt>Nguồn gốc</dt><dd>${b.origin === 'farm' ? 'Sinh tại trại' : b.origin === 'purchased' ? 'Mua / nhận về' : '—'}</dd>
        <dt>Ngày tuyển chọn</dt><dd>${b.selected_date ? fmtDate(b.selected_date) : '—'}</dd>
        <dt>Lồng sinh sản gốc</dt><dd>${originCage ? html`<a href="#/cage/${originCage.id}">${originCage.code}</a>` : '—'}</dd>
        <dt>Lứa gốc</dt><dd>${originClutch ? html`<a href="#/clutch/${originClutch.id}">${originClutch.code}</a>` : '—'}</dd>
        <dt>Trạng thái</dt><dd>${BIRD_STATUS[b.status]}</dd>
        <dt>Ghi chú</dt><dd style="white-space:pre-wrap">${b.note || '—'}</dd></dl></div>
      <div class="section"><h2>Phả hệ</h2><span class="small muted">Đủ ${comp.known}/${comp.total} tổ tiên (2 đời)</span></div>
      <div class="grid2">${pedigreeNode(s, b.father_id, 'Bố')}${pedigreeNode(s, b.mother_id, 'Mẹ')}
        ${pedigreeNode(s, father?.father_id, 'Ông nội')}${pedigreeNode(s, mother?.father_id, 'Ông ngoại')}
        ${pedigreeNode(s, father?.mother_id, 'Bà nội')}${pedigreeNode(s, mother?.mother_id, 'Bà ngoại')}</div>
      <div class="btn-row" style="margin-top:10px"><a class="btn soft" href="#/kinship?a=${b.id}">${icon('dna')} Kiểm tra huyết thống với cá thể khác</a></div>
      ${pairs.length ? html`<div class="section"><h2>Lịch sử ghép cặp</h2></div><div class="card"><div class="list">${pairs.map((p) => html`<a class="row" href="#/cage/${p.cage_id}"><span class="grow"><span class="title">${s.byId('cages', p.cage_id)?.code}</span> · với ${s.birdName(p.male_id === id ? p.female_id : p.male_id)}<br>
        <span class="desc">${fmtDate(p.start_date)} → ${p.end_date ? fmtDate(p.end_date) : 'hiện tại'} · ${clutches.filter((c) => c.pair_id === p.id).length} lứa</span></span>${icon('chevron')}</a>`)}</div></div>` : ''}
      ${kids.length ? html`<div class="section"><h2>Con đã tuyển làm giống</h2></div><div class="card"><div class="list">${kids.map((k) => birdRow(s, k))}</div></div>` : ''}`,
    mount(root) { root.querySelector('[data-edit]')?.addEventListener('click', () => openBirdForm(app, id)); },
  };
}

function birdSelect(s, name, sel, filter = () => true, placeholder = '— Không rõ —') {
  const list = s.db.birds.filter((b) => !b.deleted && filter(b)).sort((a, b) => a.ring_code.localeCompare(b.ring_code));
  return raw(`<select name="${name}"><option value="">${esc(placeholder)}</option>${list.map((b) => `<option value="${b.id}"${b.id === sel ? ' selected' : ''}>${esc(b.ring_code)}${b.phenotype ? ' · ' + esc(b.phenotype) : ''}</option>`).join('')}</select>`);
}

export function openBirdForm(app, id, opts = {}) {
  const s = app.store;
  const b = id ? s.byId('birds', id) : (opts.preset ? { ...opts.preset, _new: true } : null);
  let picker;
  openSheet({
    title: b && !b._new ? `Sửa hồ sơ ${b.ring_code}` : `Thêm ${b?.sex === 'male' ? 'chim trống' : b?.sex === 'female' ? 'chim mái' : 'cá thể chim giống'}`,
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Mã chim / số vòng chân', html`<input name="ring_code" value="${b?.ring_code || ''}" required>`)}
        ${field('Ngày tuyển chọn', html`<input type="date" name="selected_date" value="${b?.selected_date || s.today()}" max="${s.today()}">`)}</div>
      <div class="grid2">${field('Giới tính', html`<select name="sex">${options(SEX_LABEL, b?.sex || 'unknown')}</select>`)}
        ${field('Độ tin cậy giới tính', html`<select name="sex_confidence"><option value="">—</option>${options(SEX_CONFIDENCE, b?.sex_confidence)}</select>`)}</div>
      <div class="grid2">${field('Màu / phenotype', html`<input name="phenotype" value="${b?.phenotype || ''}" placeholder="VD: Xanh lá, Opaline…">`)}
        ${field('Mutation (nếu biết)', html`<input name="mutation" value="${b?.mutation || ''}">`)}</div>
      <label class="check"><input type="checkbox" name="mutation_verified" ${b?.mutation_verified ? 'checked' : ''}> Mutation đã được xác minh (qua phả hệ / xét nghiệm)</label>
      <div class="grid2">${field('Bố', birdSelect(s, 'father_id', b?.father_id, (x) => x.id !== id && x.sex !== 'female'))}
        ${field('Mẹ', birdSelect(s, 'mother_id', b?.mother_id, (x) => x.id !== id && x.sex !== 'male'))}</div>
      <div class="grid2">${field('Nguồn gốc', html`<select name="origin">${options({ farm: 'Sinh tại trại', purchased: 'Mua / nhận về' }, b?.origin || 'purchased')}</select>`)}
        ${field('Trạng thái', html`<select name="status">${options(b?.status === 'paired' || b?.status === 'sold' ? { [b.status]: BIRD_STATUS[b.status] } : { holding: BIRD_STATUS.holding, isolated: BIRD_STATUS.isolated, retired: BIRD_STATUS.retired, dead: BIRD_STATUS.dead }, b?.status || 'holding')}</select>`,
          b?.status === 'paired' ? 'Đang ghép: đổi qua chức năng Thay trống/mái của lồng' : b?.status === 'sold' ? 'Đã bán: đổi qua đơn hàng' : '')}</div>
      ${field('Ghi chú', html`<textarea name="note" rows="2">${b?.note || ''}</textarea>`)}
      <div class="field"><span>Ảnh</span>${photoPickerHtml(b?.photo_ids || [])}</div>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onClose: () => picker?.dispose(),
    onMount: (el, close) => {
      picker = mountPhotoPicker(el.querySelector('[data-photo-picker]'), s);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const msg = el.querySelector('[data-msg]');
        const pErr = await photosReady(picker, e.currentTarget);
        if (pErr.length) return showMessages(msg, pErr);
        const v = formValues(el.querySelector('[data-f]'));
        const now = new Date().toISOString();
        const base = b && !b._new ? b : { id: uid(), created_at: now, created_by: s.user?.id };
        const rec = { ...base, ...v,
          ring_code: v.ring_code.trim(), sex_confidence: v.sex === 'unknown' ? null : (v.sex_confidence || null),
          father_id: v.father_id || null, mother_id: v.mother_id || null, photo_ids: picker.ids(), updated_at: now, updated_by: s.user?.id };
        const errs = validateBird(rec, s.db.birds);
        if (errs.length) return showMessages(msg, errs);
        delete rec._new;
        const r = await s.run({ ops: [{ table: 'birds', op: 'put', record: rec, before: b && !b._new ? b : null }] }, { requires: 'breeders.write' });
        if (!r.ok) return showMessages(msg, r.errors);
        toast('Đã lưu hồ sơ'); close();
        opts.onSaved?.(rec);
        if ((!b || b._new) && !opts.stay) app.navigate(`#/bird/${rec.id}`);
      }));
    },
  });
}

/** Tuyển chim từ lồng phóng làm giống: nhập danh sách cá thể (mỗi dòng 1 con). */
export function openSelectBreeders(app, penId) {
  const s = app.store;
  const pens = s.db.flight_pens.filter((p) => !p.archived);
  const clutches = s.db.clutches.filter((c) => !c.deleted).sort((a, b) => b.start_date.localeCompare(a.start_date));
  let n = 1;
  const rowHtml = (i) => html`<div class="item-line" data-bird-row>
    <div class="grid2">${field(`Cá thể #${i} — mã vòng`, html`<input name="ring_code" placeholder="VD: YP-26-015">`)}
      ${field('Giới tính', html`<select name="sex">${options(SEX_LABEL, 'unknown')}</select>`)}</div>
    <div class="grid2">${field('Độ tin cậy', html`<select name="sex_confidence"><option value="">—</option>${options(SEX_CONFIDENCE, '')}</select>`)}
      ${field('Màu / phenotype', html`<input name="phenotype">`)}</div></div>`;
  openSheet({
    title: 'Tuyển chim làm giống', subtitle: 'Trừ số lượng ở lồng phóng và tạo hồ sơ cá thể',
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Từ lồng phóng', html`<select name="from_pen_id">${options(Object.fromEntries(pens.map((p) => [p.id, `${p.name} (còn ${penBalance(s.db.stock_movements, p.id)})`])), penId)}</select>`)}
        ${field('Ngày tuyển', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}</div>
      ${field('Lứa gốc (để ghi bố mẹ)', html`<select name="source_clutch_id"><option value="">— Không rõ lứa —</option>${raw(clutches.map((c) => { const p = s.byId('pairs', c.pair_id); return `<option value="${c.id}">${esc(c.code)} · ${esc(p ? `${s.birdName(p.male_id)} × ${s.birdName(p.female_id)}` : 'chưa rõ bố mẹ')}</option>`; }).join(''))}</select>`,
        'Bố mẹ được chép cố định từ cặp của lứa gốc — không bị thay đổi khi lồng thay chim sau này.')}
      <div data-rows style="display:flex;flex-direction:column;gap:8px">${rowHtml(1)}</div>
      <button type="button" class="btn soft" data-addrow>${icon('plus')} Thêm cá thể</button>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn gold" data-save>${icon('bird')} Tuyển giống</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-addrow]').addEventListener('click', () => el.querySelector('[data-rows]').insertAdjacentHTML('beforeend', String(rowHtml(++n))));
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = el.querySelector('[data-f]');
        const birds = [...f.querySelectorAll('[data-bird-row]')].map((r) => ({
          ring_code: r.querySelector('[name=ring_code]').value, sex: r.querySelector('[name=sex]').value,
          sex_confidence: r.querySelector('[name=sex_confidence]').value || 'visual', phenotype: r.querySelector('[name=phenotype]').value,
        })).filter((x) => x.ring_code.trim());
        const plan = planSelectBreeders(s.db, { date: f.date.value, from_pen_id: f.from_pen_id.value, source_clutch_id: f.source_clutch_id.value || null, birds }, s.ctx());
        const r = await s.run(plan, { requires: 'breeders.write' });
        if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
        toast(`Đã tuyển ${birds.length} con làm giống`); close();
      }));
    },
  });
}

export function renderKinship(app, _p, query) {
  const s = app.store;
  const a = query.a || ''; const b = query.b || '';
  const alive = (x) => !['dead', 'sold'].includes(x.status);
  let result = null;
  if (a && b) result = kinshipCheck(s.db.birds, a, b, 4);
  return {
    html: html`<div class="page-head"><a class="back" href="#/breeders">${icon('back')}</a><div class="grow"><h1>Kiểm tra huyết thống</h1><div class="sub">Trước khi ghép đôi, dựa trên phả hệ đã ghi nhận</div></div></div>
      <div class="card"><form class="form" data-f>
        ${field('Cá thể A', birdSelect(s, 'a', a, alive, '— Chọn —'))}
        ${field('Cá thể B', birdSelect(s, 'b', b, alive, '— Chọn —'))}
        <button class="btn primary" type="submit">${icon('dna')} Kiểm tra</button></form></div>
      ${result ? html`<div class="card" style="margin-top:12px">
        <div class="kin ${result.result}">${result.result === 'related' ? icon('alert') : result.result === 'not_found' ? icon('check') : icon('info')} ${result.message}</div>
        ${result.findings?.length ? html`<div class="list" style="margin-top:8px">${result.findings.map((f) => html`<div class="row"><span class="grow"><span class="title">${f.name}</span><br>
          <span class="desc">Tổ tiên chung: ${f.ancestor?.ring_code || '?'} (đời ${f.da} phía A, đời ${f.db} phía B)</span></span>${badge(f.close ? 'Gần' : 'Xa', f.close ? 'danger' : 'warn')}</div>`)}</div>` : ''}
        ${result.completeness ? html`<p class="small muted">Độ đầy đủ phả hệ 2 đời: A ${result.completeness[0].known}/${result.completeness[0].total}, B ${result.completeness[1].known}/${result.completeness[1].total}.</p>` : ''}
        <p class="def">Kết quả chỉ phản ánh dữ liệu phả hệ đã nhập. Hệ thống không bao giờ khẳng định "an toàn 100%". Ba mức kết quả: Phát hiện quan hệ / Chưa phát hiện trong dữ liệu hiện có / Thiếu dữ liệu.</p></div>` : ''}`,
    mount(root) {
      root.querySelector('[data-f]').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        if (!f.a.value || !f.b.value) { toast('Chọn đủ 2 cá thể', 'warn'); return; }
        app.navigate(`#/kinship?a=${f.a.value}&b=${f.b.value}`);
      });
    },
  };
}
