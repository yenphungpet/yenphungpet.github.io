// Ghép cặp — luồng đơn giản 3 thao tác: chọn trống (có sẵn | "Trống mới"), chọn mái (có sẵn | "Mái mới"), lưu.
// Quy tắc bắt buộc:
//  - Không chọn cùng 1 cá thể cho 2 vị trí; không cá thể nào ở 2 cặp đang hoạt động cùng lúc.
//  - Chọn chim đã có => dùng lại hồ sơ (không tạo trùng). Chim mới => tự sinh mã nội bộ duy nhất, giới tính "dự đoán".
//  - Huyết thống: phát hiện quan hệ => phải xác nhận mới lưu; thiếu phả hệ => "chưa đủ dữ liệu", KHÔNG mặc định an toàn.
//  - Thay trống/mái & kết thúc cặp: đóng cặp cũ (giữ nguyên), lứa cũ giữ đúng bố mẹ, ghi nhật ký thay chim.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';
import { currentPair, openClutch } from './breeding.js';
import { kinshipCheck } from './breeders.js';

const SEX_FOR = { male: 'male', female: 'female' };
const OTHER = { male: 'female', female: 'male' };

export function activePairOfBird(db, birdId) {
  return db.pairs.find((p) => !p.end_date && !p.deleted && (p.male_id === birdId || p.female_id === birdId)) || null;
}

/** Ứng viên cho vị trí trống/mái: còn ở Lồng Chim Giống, chưa ở cặp nào đang hoạt động, giới tính không ngược. */
export function slotCandidates(db, role) {
  return db.birds.filter((b) => !b.deleted && b.status === 'holding' && b.sex !== OTHER[role] && !activePairOfBird(db, b.id))
    .sort((a, b) => (a.sex === SEX_FOR[role] ? 0 : 1) - (b.sex === SEX_FOR[role] ? 0 : 1) || a.ring_code.localeCompare(b.ring_code));
}

/** Mã nội bộ duy nhất, VD "L07-T1", "L07-M2" (không phải số vòng chân). */
export function nextInternalCode(db, cage, role, taken = new Set()) {
  const used = new Set(db.birds.map((b) => String(b.ring_code || '').toLowerCase()));
  const base = `${cage.code}-${role === 'male' ? 'T' : 'M'}`;
  for (let n = 1; n < 1000; n++) {
    const code = `${base}${n}`;
    if (!used.has(code.toLowerCase()) && !taken.has(code.toLowerCase())) return code;
  }
  return `${base}-${uid().slice(0, 6)}`;
}

export const SEX_STATE_LABEL = {
  dna: 'Đã xác minh (DNA)', confirmed: 'Đã xác minh (sinh sản)', visual: 'Dự đoán qua ngoại hình', guess: 'Dự đoán', null: 'Chưa xác minh',
};
export function sexStateLabel(b) {
  if (!b) return '';
  if (!b.sex || b.sex === 'unknown') return 'Giới tính chưa xác định';
  return SEX_STATE_LABEL[b.sex_confidence] || 'Chưa xác minh';
}
export function sexVerified(b) { return ['dna', 'confirmed'].includes(b?.sex_confidence); }

/**
 * Chuẩn hoá 1 vị trí. slot = { birdId } | { isNew: true, ring_code?, phenotype?, mutation?, sex_confidence? }
 * Trả về { bird, newRecord, errors }
 */
function resolveSlot(db, slot, role, cage, ctx, taken) {
  const errors = [];
  const label = role === 'male' ? 'trống' : 'mái';
  if (!slot || (!slot.birdId && !slot.isNew)) return { errors: [`Chọn chim ${label} (có sẵn hoặc "${role === 'male' ? 'Trống' : 'Mái'} mới")`] };
  if (slot.birdId) {
    const b = db.birds.find((x) => x.id === slot.birdId && !x.deleted);
    if (!b) return { errors: [`Không tìm thấy chim ${label} đã chọn`] };
    if (['dead', 'sold'].includes(b.status)) errors.push(`${b.ring_code} đã chết hoặc đã bán`);
    const ap = activePairOfBird(db, b.id);
    if (ap) errors.push(`${b.ring_code} đang ở một cặp khác (lồng ${db.cages.find((c) => c.id === ap.cage_id)?.code || '?'}) — không thể ghép 2 cặp cùng lúc`);
    else if (b.status === 'paired') errors.push(`${b.ring_code} đang ở trạng thái đã ghép`);
    if (b.sex === OTHER[role]) errors.push(`${b.ring_code} đang ghi là ${role === 'male' ? 'mái' : 'trống'}, không thể đặt vào vị trí ${label}`);
    return { bird: b, newRecord: null, errors };
  }
  const code = (slot.ring_code || '').trim() || nextInternalCode(db, cage, role, taken);
  if (db.birds.some((x) => !x.deleted && x.ring_code?.trim().toLowerCase() === code.toLowerCase()) || taken.has(code.toLowerCase())) {
    errors.push(`Mã "${code}" đã có hồ sơ — chọn chim đó trong danh sách thay vì tạo mới (tránh tạo trùng)`);
  }
  taken.add(code.toLowerCase());
  const rec = {
    id: uid(), ring_code: code, sex: SEX_FOR[role], sex_confidence: slot.sex_confidence || 'guess',
    phenotype: (slot.phenotype || '').trim(), mutation: (slot.mutation || '').trim(), mutation_verified: false,
    father_id: null, mother_id: null, origin: slot.origin || 'purchased', selected_date: null, status: 'paired', photo_ids: [],
    note: (slot.ring_code || '').trim() ? 'Tạo khi ghép cặp' : 'Mã nội bộ tự tạo khi ghép cặp — chưa có số vòng chân',
    created_at: ctx.now, created_by: ctx.actor,
  };
  return { bird: rec, newRecord: rec, errors };
}

/** Kết quả huyết thống cho cặp (có chim mới => thiếu phả hệ). */
export function pairKinship(db, male, female, { maleNew = false, femaleNew = false } = {}) {
  if (!male || !female) return null;
  if (maleNew || femaleNew) return { result: 'insufficient', message: 'Chưa đủ dữ liệu phả hệ (chim mới chưa có bố mẹ) — không thể kết luận an toàn', findings: [] };
  return kinshipCheck(db.birds, male.id, female.id, 4);
}

function kinshipGate(kin, confirm) {
  if (kin?.result === 'related' && !confirm) {
    return [`${kin.message}: ${kin.findings.map((f) => f.name).join('; ')}. Đánh dấu "Tôi đã biết và vẫn muốn ghép" nếu vẫn tiếp tục.`];
  }
  return [];
}

/** Ghép cặp mới cho lồng chưa có cặp. input: { male: slot, female: slot, start_date, note, confirmKinship } */
export function planCreatePair(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const cage = db.cages.find((c) => c.id === cageId);
  if (!cage) return { errors: ['Không tìm thấy lồng'], ops: [] };
  const errors = [];
  if (currentPair(db.pairs, cageId)) errors.push('Lồng đã có cặp — dùng "Thay trống", "Thay mái" hoặc "Kết thúc cặp"');
  if (!isISODate(input.start_date)) errors.push('Ngày ghép không hợp lệ');
  else if (input.start_date > today) errors.push('Ngày ghép không được ở tương lai');
  const taken = new Set();
  const m = resolveSlot(db, input.male, 'male', cage, ctx, taken);
  const f = resolveSlot(db, input.female, 'female', cage, ctx, taken);
  errors.push(...m.errors, ...f.errors);
  if (m.bird && f.bird && m.bird.id === f.bird.id) errors.push('Không thể chọn cùng một cá thể cho cả trống và mái');
  const kin = m.bird && f.bird ? pairKinship(db, m.bird, f.bird, { maleNew: !!m.newRecord, femaleNew: !!f.newRecord }) : null;
  if (!errors.length) errors.push(...kinshipGate(kin, input.confirmKinship));
  if (errors.length) return { errors, ops: [], kinship: kin };
  const ops = [];
  for (const r of [m, f]) {
    if (r.newRecord) ops.push({ table: 'birds', op: 'put', record: r.newRecord });
    else ops.push({ table: 'birds', op: 'put', before: r.bird, record: { ...r.bird, status: 'paired', updated_at: now, updated_by: actor } });
  }
  const pair = { id: uid(), cage_id: cageId, male_id: m.bird.id, female_id: f.bird.id, start_date: input.start_date, end_date: null, created_at: now, created_by: actor };
  ops.push({ table: 'pairs', op: 'put', record: pair });
  return { errors: [], ops, record: pair, kinship: kin, created: [m.newRecord, f.newRecord].filter(Boolean) };
}

/** Thay trống / thay mái. input: { role, slot, date, reason?, old_bird_status?, note?, confirmKinship } */
export function planReplaceMate(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const cage = db.cages.find((c) => c.id === cageId);
  const pair = currentPair(db.pairs, cageId);
  if (!cage || !pair) return { errors: ['Lồng chưa có cặp để thay'], ops: [] };
  const errors = [];
  const warnings = [];
  if (!['male', 'female'].includes(input.role)) errors.push('Chọn thay trống hay mái');
  if (!isISODate(input.date)) errors.push('Ngày thay không hợp lệ');
  else {
    if (input.date > today) errors.push('Ngày thay không được ở tương lai');
    if (pair.start_date && input.date < pair.start_date) errors.push('Ngày thay sớm hơn ngày ghép cặp hiện tại');
  }
  if (errors.length) return { errors, ops: [] };
  const keepId = input.role === 'male' ? pair.female_id : pair.male_id;
  const oldId = input.role === 'male' ? pair.male_id : pair.female_id;
  const keep = db.birds.find((b) => b.id === keepId);
  const r = resolveSlot(db, input.slot, input.role, cage, ctx, new Set());
  errors.push(...r.errors);
  if (r.bird && (r.bird.id === keepId || r.bird.id === oldId)) errors.push(r.bird.id === oldId ? 'Đây là chim đang ở vị trí này — chọn chim khác' : 'Không thể chọn cùng một cá thể cho cả trống và mái');
  const male = input.role === 'male' ? r.bird : keep;
  const female = input.role === 'female' ? r.bird : keep;
  const kin = male && female ? pairKinship(db, male, female, { maleNew: input.role === 'male' && !!r.newRecord, femaleNew: input.role === 'female' && !!r.newRecord }) : null;
  if (!errors.length) errors.push(...kinshipGate(kin, input.confirmKinship));
  if (errors.length) return { errors, ops: [], kinship: kin };
  const ops = [{ table: 'pairs', op: 'put', before: pair, record: { ...pair, end_date: input.date, end_reason: 'mate_change', updated_at: now, updated_by: actor } }];
  if (r.newRecord) ops.push({ table: 'birds', op: 'put', record: r.newRecord });
  else ops.push({ table: 'birds', op: 'put', before: r.bird, record: { ...r.bird, status: 'paired', updated_at: now, updated_by: actor } });
  const newPair = { id: uid(), cage_id: cageId, male_id: male.id, female_id: female.id, start_date: input.date, end_date: null, created_at: now, created_by: actor };
  ops.push({ table: 'pairs', op: 'put', record: newPair });
  ops.push({ table: 'mate_changes', op: 'put', record: {
    id: uid(), cage_id: cageId, date: input.date, role: input.role, old_bird_id: oldId, new_bird_id: r.bird.id, old_pair_id: pair.id, new_pair_id: newPair.id,
    reason: (input.reason || '').trim() || 'Không ghi lý do', note: (input.note || '').trim(), photo_ids: [], created_at: now, created_by: actor,
  } });
  const old = db.birds.find((b) => b.id === oldId);
  if (old) ops.push({ table: 'birds', op: 'put', before: old, record: { ...old, status: input.old_bird_status || 'holding', updated_at: now, updated_by: actor } });
  if (openClutch(db.clutches, cageId)) warnings.push('Lồng đang có lứa mở — lứa này vẫn giữ bố mẹ cũ.');
  return { errors: [], warnings, ops, kinship: kin, record: newPair };
}

/** Kết thúc cặp (tách cặp). Chim về Lồng Chim Giống (hoặc trạng thái chọn). Không xoá lịch sử. */
export function planEndPair(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const pair = currentPair(db.pairs, cageId);
  if (!pair) return { errors: ['Lồng chưa có cặp'], ops: [] };
  const errors = [];
  if (!isISODate(input.date)) errors.push('Ngày kết thúc không hợp lệ');
  else {
    if (input.date > today) errors.push('Ngày kết thúc không được ở tương lai');
    if (pair.start_date && input.date < pair.start_date) errors.push('Ngày kết thúc sớm hơn ngày ghép');
  }
  if (openClutch(db.clutches, cageId)) errors.push('Lồng còn lứa đang mở — hãy "Kết thúc lứa" trước khi tách cặp');
  if (db.rest_periods.some((p) => p.cage_id === cageId && !p.end_date && !p.deleted)) errors.push('Lồng đang trong kỳ nghỉ đẻ — kết thúc kỳ nghỉ (Sửa kỳ nghỉ) trước khi tách cặp');
  if (errors.length) return { errors, ops: [] };
  const ops = [{ table: 'pairs', op: 'put', before: pair, record: { ...pair, end_date: input.date, end_reason: (input.reason || '').trim() || 'Tách cặp', updated_at: now, updated_by: actor } }];
  for (const id of [pair.male_id, pair.female_id]) {
    const b = db.birds.find((x) => x.id === id);
    if (b && b.status === 'paired') ops.push({ table: 'birds', op: 'put', before: b, record: { ...b, status: input.bird_status || 'holding', updated_at: now, updated_by: actor } });
  }
  return { errors: [], ops };
}
