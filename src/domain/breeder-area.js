// Khu Chim Giống (V2.2.3): chim đẹp tuyển từ lồng phóng, giữ ở các lồng giống, sau đó ghép cặp vào lồng sinh sản.
// Nguyên tắc đếm (không đếm trùng):
//  - Lồng phóng đếm theo sổ số lượng (stock_movements). Lồng giống đếm theo hồ sơ từng con (birds.pen_id), không có dòng trong sổ.
//  - Tuyển giống: sổ lồng phóng −N (1 dòng select_breeder) + N hồ sơ chim. Trả về lồng phóng: hồ sơ "đã trả về" + sổ +1.
//  - Ghép cặp: chim rời khu giống (thuộc cặp đang mở), vẫn là chim giống ⇒ tổng chim giống không đổi.
// Không suy đoán: lồng phóng nguồn, bố mẹ, giới tính, mutation chỉ ghi khi người dùng nhập.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';
import { birdPlacement, validateBird, BIRD_STATUS } from './breeders.js';
import { planCreatePair } from './pairing.js';
import { isBreederPen, findNegative, flightPens, penBalance } from './stock.js';

export const BIRD_EVENT_LABELS = {
  select: 'Tuyển từ lồng phóng', add: 'Thêm vào khu giống', move: 'Chuyển lồng giống', pair: 'Ghép vào lồng sinh sản',
  release: 'Trả về lồng phóng', dead: 'Chết', retire: 'Ngưng sử dụng',
};
export const PREDICTED = new Set(['visual', 'guess']);

/** Lồng giống. archived: false = đang dùng, true = đã ngừng, null = tất cả. */
export function breederPens(db, archived = false) {
  return (db.flight_pens || []).filter((p) => isBreederPen(p) && (archived === null || !!p.archived === archived))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
}

/** Chim đang ở khu giống: còn giữ, không thuộc cặp đang mở, không thuộc lồng sinh sản đã lưu trữ. */
export function areaBirds(db, place = birdPlacement(db)) {
  return (db.birds || []).filter((b) => !b.deleted && b.status === 'holding' && !place.activePaired.has(b.id) && !place.archivedCage.has(b.id));
}

/** Tổng hợp khu giống: theo lồng, chưa xếp lồng, theo giới tính (kèm số "dự đoán"). */
export function areaSummary(db) {
  const list = areaBirds(db);
  const pens = breederPens(db, null);
  const byPen = pens.map((pen) => ({ pen, n: list.filter((b) => b.pen_id === pen.id).length })).filter((x) => !x.pen.archived || x.n);
  const sex = (k) => list.filter((b) => (b.sex || 'unknown') === k);
  return {
    total: list.length, byPen,
    unplaced: list.filter((b) => !b.pen_id || !pens.some((p) => p.id === b.pen_id)).length,
    male: sex('male').length, female: sex('female').length, unknown: sex('unknown').length,
    malePredicted: sex('male').filter((b) => PREDICTED.has(b.sex_confidence)).length,
    femalePredicted: sex('female').filter((b) => PREDICTED.has(b.sex_confidence)).length,
  };
}

/** Gợi ý mã chim giống chưa dùng: CG-<năm>-001… (người dùng sửa được; trùng thì không lưu). */
export function nextBreederCodes(db, n, today, taken = []) {
  const used = new Set((db.birds || []).map((b) => String(b.ring_code || '').trim().toLowerCase()).concat(taken.map((x) => x.toLowerCase())));
  const base = `CG-${String(today).slice(2, 4)}-`;
  const out = [];
  for (let i = 1; out.length < n && i < 100000; i++) {
    const code = `${base}${String(i).padStart(3, '0')}`;
    if (!used.has(code.toLowerCase())) { out.push(code); used.add(code.toLowerCase()); }
  }
  return out;
}

const ev = (bird, type, date, ctx, extra = {}) => ({
  id: uid(), bird_id: bird.id, type, event_date: date, from_pen_id: null, to_pen_id: null, cage_id: null, pair_id: null, movement_id: null,
  note: '', created_at: ctx.now, created_by: ctx.actor, ...extra,
});
const dateErrors = (date, today, label) => (!isISODate(date) ? [`${label} không hợp lệ`] : date > today ? [`${label} không được ở tương lai`] : []);
const openBreederPen = (db, id) => (db.flight_pens || []).find((p) => p.id === id && isBreederPen(p) && !p.archived);

/**
 * Tuyển 1 hoặc nhiều con từ lồng phóng: sổ lồng phóng −N, tạo N hồ sơ (lồng phóng nguồn, lồng giống nhận), N dòng lịch sử.
 * input: { date, from_pen_id, to_pen_id?, source_clutch_id?, birds: [{ ring_code, sex, sex_confidence, phenotype, mutation, note, photo_ids }] }
 * Bố mẹ chỉ ghi khi chọn lứa gốc; không chọn thì để trống (không suy đoán nguồn gốc).
 */
export function planSelectToArea(db, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [...dateErrors(input.date, today, 'Ngày tuyển')];
  const list = (input.birds || []).filter((x) => (x.ring_code || '').trim());
  if (!list.length) errors.push('Nhập mã cho ít nhất 1 con');
  const from = flightPens(db, false).find((p) => p.id === input.from_pen_id);
  if (!from) errors.push('Chọn lồng phóng nguồn');
  const to = input.to_pen_id ? openBreederPen(db, input.to_pen_id) : null;
  if (input.to_pen_id && !to) errors.push('Lồng giống nhận không còn dùng');
  const clutch = input.source_clutch_id ? db.clutches.find((c) => c.id === input.source_clutch_id && !c.deleted) : null;
  const pair = clutch?.pair_id ? db.pairs.find((p) => p.id === clutch.pair_id) : null;
  const seen = new Set();
  const birds = list.map((x, i) => {
    const sex = ['male', 'female'].includes(x.sex) ? x.sex : 'unknown';
    const b = {
      id: uid(), ring_code: x.ring_code.trim(), sex, sex_confidence: sex === 'unknown' ? null : (x.sex_confidence || 'guess'),
      phenotype: (x.phenotype || '').trim(), mutation: (x.mutation || '').trim(), mutation_verified: false,
      father_id: pair?.male_id || null, mother_id: pair?.female_id || null,
      origin: clutch ? 'farm' : null, origin_cage_id: clutch?.cage_id || null, origin_clutch_id: clutch?.id || null,
      source_pen_id: from?.id || null, pen_id: to?.id || null,
      selected_date: input.date, status: 'holding', photo_ids: x.photo_ids || [], note: (x.note || '').trim(),
      created_at: now, created_by: actor, updated_at: now, updated_by: actor,
    };
    validateBird(b, db.birds).forEach((m) => errors.push(`Con #${i + 1} (${b.ring_code}): ${m}`));
    const k = b.ring_code.toLowerCase();
    if (seen.has(k)) errors.push(`Con #${i + 1}: mã ${b.ring_code} bị nhập 2 lần`);
    seen.add(k);
    return b;
  });
  const movement = {
    id: uid(), type: 'select_breeder', date: input.date, qty: birds.length, from_pen_id: from?.id || null, to_pen_id: null,
    source_cage_id: clutch?.cage_id || null, source_clutch_id: clutch?.id || null, bird_ids: birds.map((b) => b.id),
    note: `Tuyển ${birds.length} con làm giống${to ? ` → ${to.name}` : ''}: ${birds.map((b) => b.ring_code).join(', ')}`,
    created_at: now, created_by: actor, updated_at: now, updated_by: actor,
  };
  if (!errors.length) {
    const neg = findNegative(db.stock_movements.concat(movement), [from]);
    if (neg.length) errors.push(`${from.name} chỉ còn ${penBalance(db.stock_movements, from.id)} con — không đủ ${birds.length} con để tuyển`);
  }
  if (errors.length) return { errors, ops: [] };
  return { errors, record: movement, birds, ops: [
    { table: 'stock_movements', op: 'put', record: movement, before: null },
    ...birds.map((b) => ({ table: 'birds', op: 'put', record: b, before: null })),
    ...birds.map((b) => ({ table: 'bird_events', op: 'put', before: null,
      record: ev(b, 'select', input.date, ctx, { from_pen_id: from.id, to_pen_id: to?.id || null, movement_id: movement.id }) })),
  ] };
}

/** Thêm / sửa hồ sơ. Thêm mới: ghi 1 dòng lịch sử "Thêm vào khu giống". Sửa: không đổi lồng (đổi lồng dùng Chuyển để có lịch sử). */
export function planSaveBird(db, input, before, ctx) {
  const { now, actor, today } = ctx;
  const isNew = !before;
  const rec = { ...(before || { id: uid(), created_at: now, created_by: actor, status: 'holding' }), ...input, updated_at: now, updated_by: actor };
  rec.ring_code = String(rec.ring_code || '').trim();
  if (rec.sex === 'unknown') rec.sex_confidence = null;
  if (!isNew) { rec.pen_id = before.pen_id ?? null; rec.source_pen_id = before.source_pen_id ?? null; }
  const errors = validateBird(rec, db.birds);
  if (isNew && rec.pen_id && !openBreederPen(db, rec.pen_id)) errors.push('Lồng giống không còn dùng');
  if (isNew && rec.status !== 'holding') rec.pen_id = null;
  if (errors.length) return { errors, ops: [] };
  const ops = [{ table: 'birds', op: 'put', record: rec, before: before || null }];
  if (isNew && rec.status === 'holding') ops.push({ table: 'bird_events', op: 'put', before: null, record: ev(rec, 'add', rec.selected_date && rec.selected_date <= today ? rec.selected_date : today, ctx, { to_pen_id: rec.pen_id || null }) });
  return { errors, ops, record: rec };
}

/** Chuyển 1 hoặc nhiều con sang lồng giống khác. */
export function planMoveInArea(db, input, ctx) {
  const { today, now, actor } = ctx;
  const errors = [...dateErrors(input.date, today, 'Ngày chuyển')];
  const to = openBreederPen(db, input.to_pen_id);
  if (!to) errors.push('Chọn lồng giống nhận');
  const area = new Map(areaBirds(db).map((b) => [b.id, b]));
  const ids = [...new Set(input.bird_ids || [])];
  if (!ids.length) errors.push('Chọn ít nhất 1 con');
  const birds = ids.map((id) => area.get(id));
  ids.forEach((id, i) => { if (!birds[i]) errors.push(`${db.birds.find((b) => b.id === id)?.ring_code || id} không còn ở khu giống`); });
  if (to) birds.forEach((b) => { if (b && b.pen_id === to.id) errors.push(`${b.ring_code} đang ở ${to.name}`); });
  if (errors.length) return { errors, ops: [] };
  const note = (input.note || '').trim();
  return { errors, ops: birds.flatMap((b) => [
    { table: 'birds', op: 'put', before: b, record: { ...b, pen_id: to.id, updated_at: now, updated_by: actor } },
    { table: 'bird_events', op: 'put', before: null, record: ev(b, 'move', input.date, ctx, { from_pen_id: b.pen_id || null, to_pen_id: to.id, note }) },
  ]) };
}

/**
 * Ghép trống + mái từ khu giống vào lồng sinh sản chưa có cặp. Dùng đúng luồng ghép cặp có sẵn (kiểm tra huyết thống, chống ghép 2 cặp).
 * KHÔNG tạo lứa: lứa chỉ bắt đầu khi có trứng (Thêm lứa / Cập nhật hôm nay).
 */
export function planPairFromArea(db, input, ctx) {
  const area = new Map(areaBirds(db).map((b) => [b.id, b]));
  const errors = [];
  for (const [k, l] of [['male_id', 'trống'], ['female_id', 'mái']]) {
    if (!input[k]) errors.push(`Chọn chim ${l}`);
    else if (!area.has(input[k])) errors.push(`${db.birds.find((b) => b.id === input[k])?.ring_code || 'Chim đã chọn'} không còn ở khu giống`);
  }
  const cage = db.cages.find((c) => c.id === input.cage_id && !c.archived && !c.deleted);
  if (!cage) errors.push('Chọn lồng sinh sản');
  if (errors.length) return { errors, ops: [] };
  const plan = planCreatePair(db, cage.id, { male: { birdId: input.male_id }, female: { birdId: input.female_id }, start_date: input.date, confirmKinship: input.confirmKinship }, ctx);
  if (plan.errors.length) return plan;
  const pair = plan.record;
  const note = (input.note || '').trim();
  const ops = plan.ops.map((o) => (o.table === 'birds' ? { ...o, record: { ...o.record, pen_id: null } } : o));
  for (const id of [input.male_id, input.female_id]) {
    const b = area.get(id);
    ops.push({ table: 'bird_events', op: 'put', before: null, record: ev(b, 'pair', input.date, ctx, { from_pen_id: b.pen_id || null, cage_id: cage.id, pair_id: pair.id, note }) });
  }
  return { ...plan, ops };
}

/**
 * Ngừng giữ giống: trả về lồng phóng (sổ lồng phóng +1, hồ sơ "đã trả về") hoặc chết. Bán: dùng Bán hàng như cũ.
 * input: { bird_id, reason: 'release' | 'dead', to_pen_id?, date, note }
 */
export function planStopBreeder(db, input, ctx) {
  const { today, now, actor } = ctx;
  const errors = [...dateErrors(input.date, today, 'Ngày')];
  const b = areaBirds(db).find((x) => x.id === input.bird_id);
  if (!b) errors.push('Chim không còn ở khu giống (đang ghép cặp thì tách cặp ở lồng sinh sản trước)');
  if (!['release', 'dead'].includes(input.reason)) errors.push('Chọn lý do');
  const pen = input.reason === 'release' ? flightPens(db, false).find((p) => p.id === input.to_pen_id) : null;
  if (input.reason === 'release' && !pen) errors.push('Chọn lồng phóng nhận');
  const note = (input.note || '').trim();
  if (input.reason === 'dead' && !note) errors.push('Nhập nguyên nhân / ghi chú');
  if (errors.length) return { errors, ops: [] };
  const ops = [];
  let movement = null;
  if (pen) {
    movement = {
      id: uid(), type: 'in_other', date: input.date, qty: 1, from_pen_id: null, to_pen_id: pen.id, bird_ids: [b.id],
      note: `Từ khu Chim Giống: ${b.ring_code}${note ? ` — ${note}` : ''}`, origin_status: 'known', origin_note: `Chim giống ${b.ring_code} trả về`,
      created_at: now, created_by: actor, updated_at: now, updated_by: actor,
    };
    ops.push({ table: 'stock_movements', op: 'put', record: movement, before: null });
  }
  ops.push({ table: 'birds', op: 'put', before: b, record: { ...b, status: input.reason === 'release' ? 'released' : 'dead', pen_id: null, updated_at: now, updated_by: actor } });
  ops.push({ table: 'bird_events', op: 'put', before: null, record: ev(b, input.reason, input.date, ctx, { from_pen_id: b.pen_id || null, to_pen_id: pen?.id || null, movement_id: movement?.id || null, note }) });
  return { errors, ops, record: movement };
}

/** Lịch sử 1 con: các lần tuyển / chuyển / ghép / trả về + các cặp từng ghép (kể cả trước V2.2.3). Mới nhất trước. */
export function birdTimeline(db, birdId) {
  const name = (t, id) => db[t]?.find((x) => x.id === id);
  const pen = (id) => name('flight_pens', id)?.name || null;
  const out = [];
  const events = (db.bird_events || []).filter((e) => e.bird_id === birdId && !e.deleted);
  const covered = new Set(events.map((e) => e.pair_id).filter(Boolean));
  for (const e of events) {
    const parts = [];
    if (e.from_pen_id) parts.push(`từ ${pen(e.from_pen_id) || '?'}`);
    if (e.to_pen_id) parts.push(`sang ${pen(e.to_pen_id) || '?'}`);
    if (e.cage_id) parts.push(`lồng ${name('cages', e.cage_id)?.code || '?'}`);
    if (e.type === 'select' && !e.to_pen_id) parts.push('chưa xếp lồng giống');
    out.push({ date: e.event_date, at: e.created_at, kind: e.type, title: BIRD_EVENT_LABELS[e.type] || e.type, detail: parts.join(' · '), note: e.note || '', by: e.created_by });
  }
  for (const p of (db.pairs || []).filter((x) => !x.deleted && (x.male_id === birdId || x.female_id === birdId))) {
    const cage = name('cages', p.cage_id)?.code || '?';
    const mate = name('birds', p.male_id === birdId ? p.female_id : p.male_id)?.ring_code || 'chưa có hồ sơ';
    if (!covered.has(p.id) && p.start_date) out.push({ date: p.start_date, at: p.created_at, kind: 'pair', title: 'Ghép cặp', detail: `lồng ${cage} · với ${mate}`, note: '' });
    if (p.end_date) out.push({ date: p.end_date, at: p.updated_at, kind: 'unpair', title: p.end_reason === 'mate_change' ? 'Thay chim trong cặp' : 'Tách cặp', detail: `lồng ${cage} · với ${mate}`, note: p.end_reason && p.end_reason !== 'mate_change' ? p.end_reason : '' });
  }
  const b = name('birds', birdId);
  if (b && !events.some((e) => ['select', 'add'].includes(e.type))) {
    out.push({ date: String(b.created_at || '').slice(0, 10), at: b.created_at, kind: 'created', title: 'Tạo hồ sơ', detail: b.status ? BIRD_STATUS[b.status] || '' : '', note: '' });
  }
  // Cùng ngày, cùng thời điểm: theo thứ tự nghiệp vụ (tạo → tuyển → chuyển → ghép → tách → rời khu giống)
  const rank = { created: 0, select: 1, add: 1, move: 2, pair: 3, unpair: 4, release: 5, dead: 5, retire: 5 };
  return out.sort((x, y) => String(y.date).localeCompare(String(x.date)) || String(y.at || '').localeCompare(String(x.at || '')) || (rank[y.kind] ?? 9) - (rank[x.kind] ?? 9));
}
