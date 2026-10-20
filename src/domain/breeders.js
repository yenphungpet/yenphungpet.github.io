// Lồng Chim Giống: quản lý từng cá thể đã tuyển chọn + kiểm tra huyết thống.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';
import { MOVEMENT_TYPES, findNegative } from './stock.js';

export const BIRD_STATUS = {
  holding: 'Trong Lồng Chim Giống',
  paired: 'Đã ghép sinh sản',
  isolated: 'Đang cách ly',
  retired: 'Ngưng sử dụng',
  sold: 'Đã bán',
  dead: 'Đã chết',
};
export const ALIVE_OWNED = new Set(['holding', 'paired', 'isolated', 'retired']);

export const SEX_LABEL = { male: 'Trống', female: 'Mái', unknown: 'Chưa xác định' };
export const SEX_CONFIDENCE = {
  dna: 'Xét nghiệm DNA',
  confirmed: 'Đã xác nhận (đẻ trứng / ghép thành công)',
  visual: 'Quan sát ngoại hình (mũi/da mũi)',
  guess: 'Phỏng đoán',
};

/**
 * Vị trí thực tế của cá thể theo CẶP ĐANG MỞ (nguồn sự thật là bảng pairs, không phải trường status):
 *  activePaired: thuộc cặp đang mở ở lồng đang dùng · archivedCage: chỉ thuộc cặp mở ở lồng đã lưu trữ
 *  (lồng lưu trữ = ẩn khỏi danh sách & thống kê, nên cá thể đó cũng được ẩn theo).
 */
export function birdPlacement(db) {
  const activeCage = new Set((db.cages || []).filter((c) => !c.archived && !c.deleted).map((c) => c.id));
  const activePaired = new Set(), inArchived = new Set();
  for (const p of db.pairs || []) {
    if (p.deleted || p.end_date) continue;
    for (const id of [p.male_id, p.female_id]) if (id) (activeCage.has(p.cage_id) ? activePaired : inArchived).add(id);
  }
  const archivedCage = new Set([...inArchived].filter((id) => !activePaired.has(id)));
  return { activePaired, archivedCage };
}

/** Trạng thái cá thể lệch với thực tế ghép cặp (không tự sửa — báo để chủ trại kiểm tra). */
export function birdAnomalies(db) {
  const { activePaired, archivedCage } = birdPlacement(db);
  const out = [];
  for (const b of db.birds || []) {
    if (b.deleted || archivedCage.has(b.id)) continue;
    if (b.status === 'paired' && !activePaired.has(b.id)) out.push({ bird: b, text: `${b.ring_code}: ghi "Đã ghép" nhưng không thuộc cặp nào đang mở` });
    else if (activePaired.has(b.id) && b.status !== 'paired') out.push({ bird: b, text: `${b.ring_code}: đang ở cặp ghép nhưng trạng thái là "${BIRD_STATUS[b.status] || b.status}"` });
  }
  return out;
}

/** Thống kê chim giống. Truyền db để "đã ghép" tính theo cặp đang mở thật sự (bỏ cá thể của lồng đã lưu trữ). */
export function breederStats(birds, db = null) {
  const place = db ? birdPlacement(db) : null;
  const live = birds.filter((b) => !b.deleted && ALIVE_OWNED.has(b.status) && !place?.archivedCage.has(b.id));
  const verified = (b) => ['dna', 'confirmed'].includes(b.sex_confidence);
  return {
    total: live.length,                                            // Tổng chim giống hiện tại (còn sống, thuộc trại)
    inBreederPen: live.filter((b) => b.status === 'holding' && !place?.activePaired.has(b.id)).length, // Đang ở Lồng Chim Giống
    paired: place ? place.activePaired.size : live.filter((b) => b.status === 'paired').length, // Đang ghép trong lồng sinh sản
    hiddenArchived: place ? place.archivedCage.size : 0,
    isolated: live.filter((b) => b.status === 'isolated').length,
    retired: live.filter((b) => b.status === 'retired').length,
    maleVerified: live.filter((b) => b.sex === 'male' && verified(b)).length,
    femaleVerified: live.filter((b) => b.sex === 'female' && verified(b)).length,
    maleUnverified: live.filter((b) => b.sex === 'male' && !verified(b)).length,
    femaleUnverified: live.filter((b) => b.sex === 'female' && !verified(b)).length,
    unknownSex: live.filter((b) => b.sex === 'unknown' || !b.sex).length,
  };
}

export function validateBird(b, birds) {
  const errors = [];
  if (!b.ring_code?.trim()) errors.push('Nhập mã chim / số vòng chân');
  else if (birds.some((x) => x.id !== b.id && !x.deleted && x.ring_code?.trim().toLowerCase() === b.ring_code.trim().toLowerCase())) errors.push('Mã chim / số vòng chân đã tồn tại');
  if (!['male', 'female', 'unknown'].includes(b.sex)) errors.push('Chọn giới tính');
  if (b.sex !== 'unknown' && !SEX_CONFIDENCE[b.sex_confidence]) errors.push('Chọn mức độ tin cậy giới tính');
  if (b.selected_date && !isISODate(b.selected_date)) errors.push('Ngày tuyển chọn không hợp lệ');
  if (b.father_id && b.father_id === b.id) errors.push('Bố không thể là chính nó');
  if (b.mother_id && b.mother_id === b.id) errors.push('Mẹ không thể là chính nó');
  if (b.father_id && b.mother_id && b.father_id === b.mother_id) errors.push('Bố và mẹ phải là hai cá thể khác nhau');
  const father = birds.find((x) => x.id === b.father_id);
  const mother = birds.find((x) => x.id === b.mother_id);
  if (father && father.sex === 'female') errors.push('Cá thể chọn làm bố đang ghi giới tính mái');
  if (mother && mother.sex === 'male') errors.push('Cá thể chọn làm mẹ đang ghi giới tính trống');
  if (b.id && (isAncestor(birds, b.id, b.father_id) || isAncestor(birds, b.id, b.mother_id))) errors.push('Phả hệ vòng lặp: cá thể không thể là tổ tiên của chính bố/mẹ nó');
  return errors;
}

function isAncestor(birds, candidateId, startId, depth = 0) {
  if (!startId || depth > 20) return false;
  if (startId === candidateId) return true;
  const s = birds.find((x) => x.id === startId);
  if (!s) return false;
  return isAncestor(birds, candidateId, s.father_id, depth + 1) || isAncestor(birds, candidateId, s.mother_id, depth + 1);
}

/**
 * Tuyển chim từ lồng phóng làm giống: xuất N con khỏi lồng phóng + tạo N hồ sơ cá thể.
 * Bố/mẹ lấy từ cặp của lứa gốc (nếu chọn lứa) — chép cố định vào hồ sơ để không bị ghi đè khi lồng thay chim.
 * input: { date, from_pen_id, source_clutch_id?, birds: [{ring_code, sex, sex_confidence, mutation, note}] }
 */
export function planSelectBreeders(db, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  const list = input.birds || [];
  if (!isISODate(input.date)) errors.push('Ngày tuyển không hợp lệ');
  else if (input.date > today) errors.push('Ngày tuyển không được ở tương lai');
  if (!list.length) errors.push('Nhập ít nhất 1 cá thể');
  if (!db.flight_pens.some((p) => p.id === input.from_pen_id)) errors.push('Chọn lồng phóng nguồn');
  const clutch = input.source_clutch_id ? db.clutches.find((c) => c.id === input.source_clutch_id) : null;
  const pair = clutch?.pair_id ? db.pairs.find((p) => p.id === clutch.pair_id) : null;
  const codes = new Set();
  const newBirds = list.map((x) => ({
    id: uid(), ring_code: (x.ring_code || '').trim(), sex: x.sex || 'unknown', sex_confidence: x.sex === 'unknown' ? null : (x.sex_confidence || 'visual'),
    mutation: (x.mutation || '').trim(), phenotype: (x.phenotype || '').trim(), mutation_verified: !!x.mutation_verified,
    father_id: pair?.male_id || null, mother_id: pair?.female_id || null,
    origin_cage_id: clutch?.cage_id || null, origin_clutch_id: clutch?.id || null,
    origin: 'farm', selected_date: input.date, status: 'holding', photo_ids: x.photo_ids || [], note: (x.note || '').trim(),
    created_at: now, created_by: actor,
  }));
  newBirds.forEach((b, i) => {
    const e = validateBird(b, db.birds);
    e.forEach((m) => errors.push(`Cá thể #${i + 1}: ${m}`));
    const k = b.ring_code.toLowerCase();
    if (k && codes.has(k)) errors.push(`Cá thể #${i + 1}: trùng mã trong danh sách`);
    codes.add(k);
  });
  const movement = {
    id: uid(), type: 'select_breeder', date: input.date, qty: newBirds.length, from_pen_id: input.from_pen_id, to_pen_id: null,
    source_cage_id: clutch?.cage_id || null, source_clutch_id: clutch?.id || null, bird_ids: newBirds.map((b) => b.id),
    note: `Tuyển ${newBirds.length} con làm giống: ${newBirds.map((b) => b.ring_code).join(', ')}`, created_at: now, created_by: actor,
  };
  if (!errors.length) {
    const neg = findNegative(db.stock_movements.concat(movement), db.flight_pens);
    if (neg.length) errors.push(`${neg[0].pen.name} không đủ chim (sẽ âm ${neg[0].balance} vào ngày ${neg[0].date})`);
  }
  if (errors.length) return { errors, ops: [] };
  return { errors, ops: [
    { table: 'stock_movements', op: 'put', record: movement },
    ...newBirds.map((b) => ({ table: 'birds', op: 'put', record: b })),
  ] };
}

// ---------------------------------------------------------------------------
// KIỂM TRA HUYẾT THỐNG
// ---------------------------------------------------------------------------

/** Map ancestorId -> số đời (1 = bố/mẹ, 2 = ông/bà...). */
export function ancestors(birds, id, maxDepth = 4) {
  const byId = new Map(birds.map((b) => [b.id, b]));
  const out = new Map();
  let frontier = [id];
  for (let gen = 1; gen <= maxDepth; gen++) {
    const next = [];
    for (const x of frontier) {
      const b = byId.get(x);
      if (!b) continue;
      for (const p of [b.father_id, b.mother_id]) {
        if (p && !out.has(p)) { out.set(p, gen); next.push(p); }
      }
    }
    frontier = next;
  }
  return out;
}

/** Mức độ đầy đủ phả hệ: số tổ tiên đã biết / tối đa trong `depth` đời. */
export function pedigreeCompleteness(birds, id, depth = 2) {
  const byId = new Map(birds.map((b) => [b.id, b]));
  let known = 0; let total = 0;
  let frontier = [id];
  for (let gen = 1; gen <= depth; gen++) {
    const next = [];
    for (const x of frontier) {
      const b = x ? byId.get(x) : null;
      for (const p of [b?.father_id, b?.mother_id]) {
        total += 1;
        if (p && byId.has(p)) known += 1;
        next.push(p && byId.has(p) ? p : null);
      }
    }
    frontier = next;
  }
  return { known, total };
}

function relationName(da, db_, aIsAnc, bIsAnc) {
  if (aIsAnc || bIsAnc) {
    const d = aIsAnc ? db_ : da;
    return d === 1 ? 'bố/mẹ – con' : d === 2 ? 'ông/bà – cháu' : `tổ tiên trực hệ đời thứ ${d}`;
  }
  if (da === 1 && db_ === 1) return 'anh chị em ruột/cùng cha hoặc mẹ';
  if ((da === 1 && db_ === 2) || (da === 2 && db_ === 1)) return 'cô/chú/bác – cháu';
  if (da === 2 && db_ === 2) return 'anh chị em họ đời thứ nhất';
  return `có chung tổ tiên (đời ${da} và ${db_})`;
}

/**
 * Kết quả:
 *  - 'related'      Phát hiện quan hệ huyết thống (kèm mức độ gần/xa)
 *  - 'not_found'    Chưa phát hiện quan hệ trong dữ liệu hiện có
 *  - 'insufficient' Thiếu dữ liệu phả hệ để kết luận
 * Không bao giờ trả về "an toàn 100%".
 */
export function kinshipCheck(birds, aId, bId, maxDepth = 4) {
  const a = birds.find((x) => x.id === aId);
  const b = birds.find((x) => x.id === bId);
  if (!a || !b) return { result: 'insufficient', message: 'Không tìm thấy hồ sơ cá thể', findings: [] };
  if (aId === bId) return { result: 'related', close: true, message: 'Hai lựa chọn là cùng một cá thể', findings: [] };
  const ancA = ancestors(birds, aId, maxDepth);
  const ancB = ancestors(birds, bId, maxDepth);
  ancA.set(aId, 0); ancB.set(bId, 0);
  const findings = [];
  for (const [id, da] of ancA) {
    if (!ancB.has(id)) continue;
    const dbb = ancB.get(id);
    if (da === 0 && dbb === 0) continue;
    // Bỏ tổ tiên chung "xa hơn" đã được giải thích bởi tổ tiên gần hơn (chỉ giữ tổ tiên chung gần nhất)
    findings.push({ ancestorId: id, ancestor: birds.find((x) => x.id === id), da, db: dbb });
  }
  findings.sort((x, y) => (x.da + x.db) - (y.da + y.db));
  // Chỉ giữ tổ tiên chung GẦN NHẤT: bỏ f nếu f là tổ tiên của một tổ tiên chung khác g (f đã được giải thích qua g)
  const nearest = findings.filter((f) => !findings.some((g) => g !== f && ancestors(birds, g.ancestorId, maxDepth).has(f.ancestorId)));
  const relations = nearest.map((f) => ({ ...f, name: relationName(f.da, f.db, f.da === 0, f.db === 0), close: Math.max(f.da, f.db) <= 2 || f.da === 0 || f.db === 0 }));
  const compA = pedigreeCompleteness(birds, aId, 2);
  const compB = pedigreeCompleteness(birds, bId, 2);
  if (relations.length) {
    const close = relations.some((r) => r.close);
    return { result: 'related', close, findings: relations, completeness: [compA, compB],
      message: close ? 'Phát hiện quan hệ huyết thống gần' : 'Phát hiện quan hệ huyết thống xa' };
  }
  const missingParents = !a.father_id || !a.mother_id || !b.father_id || !b.mother_id;
  if (missingParents) {
    return { result: 'insufficient', findings: [], completeness: [compA, compB],
      message: 'Thiếu dữ liệu phả hệ (chưa đủ bố/mẹ) — không thể kết luận' };
  }
  return { result: 'not_found', findings: [], completeness: [compA, compB],
    message: `Chưa phát hiện quan hệ huyết thống trong dữ liệu hiện có (kiểm tra ${maxDepth} đời). Điều này không đảm bảo hai cá thể không có họ hàng.` };
}

export { MOVEMENT_TYPES };
