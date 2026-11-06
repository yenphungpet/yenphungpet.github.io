// Lồng phóng thương mại: quản lý theo SỐ LƯỢNG bằng sổ biến động (ledger).
// Tồn hiện tại = Σ nhập − Σ xuất. Mọi thay đổi là 1 dòng biến động => có lịch sử, không âm tồn.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';

export const MOVEMENT_TYPES = {
  in_breeding: { label: 'Nhập từ lồng sinh sản', from: false, to: true },
  in_other: { label: 'Nhập khác (mua/nhận)', from: false, to: true },
  transfer: { label: 'Chuyển lồng', from: true, to: true },
  select_breeder: { label: 'Tuyển làm giống', from: true, to: false },
  sale: { label: 'Bán', from: true, to: false },
  loss: { label: 'Hao hụt (chết/mất)', from: true, to: false },
  adjust_in: { label: 'Điều chỉnh kiểm đếm (+)', from: false, to: true },
  adjust_out: { label: 'Điều chỉnh kiểm đếm (−)', from: true, to: false },
};

const order = (a, b) => (a.date === b.date
  ? String(a.created_at || '').localeCompare(String(b.created_at || ''))
  : a.date.localeCompare(b.date));

export function activeMovements(movements) {
  return movements.filter((m) => !m.deleted);
}

export function penBalance(movements, penId, uptoDate = null) {
  let bal = 0;
  for (const m of activeMovements(movements)) {
    if (uptoDate && m.date > uptoDate) continue;
    if (m.to_pen_id === penId) bal += m.qty;
    if (m.from_pen_id === penId) bal -= m.qty;
  }
  return bal;
}

/** Kiểm tra số dư theo thời gian — không ngày nào được âm. Trả về lỗi đầu tiên mỗi lồng. */
export function findNegative(movements, pens) {
  const errs = [];
  const list = activeMovements(movements).slice().sort(order);
  for (const pen of pens) {
    let bal = 0;
    for (const m of list) {
      if (m.to_pen_id === pen.id) bal += m.qty;
      if (m.from_pen_id === pen.id) bal -= m.qty;
      if (bal < 0) { errs.push({ pen, date: m.date, balance: bal, movement: m }); break; }
    }
  }
  return errs;
}

export function validateMovementShape(m, pens) {
  const errors = [];
  const t = MOVEMENT_TYPES[m.type];
  if (!t) return ['Loại biến động không hợp lệ'];
  if (!isISODate(m.date)) errors.push('Ngày không hợp lệ');
  if (!Number.isInteger(m.qty) || m.qty <= 0) errors.push('Số lượng phải là số nguyên > 0');
  const has = (id) => pens.some((p) => p.id === id);
  if (t.from && !has(m.from_pen_id)) errors.push('Chọn lồng xuất');
  if (t.to && !has(m.to_pen_id)) errors.push('Chọn lồng nhận');
  if (!t.from && m.from_pen_id) errors.push('Loại này không có lồng xuất');
  if (!t.to && m.to_pen_id) errors.push('Loại này không có lồng nhận');
  if (t.from && t.to && m.from_pen_id === m.to_pen_id) errors.push('Lồng xuất và lồng nhận phải khác nhau');
  return errors;
}

/**
 * Lập kế hoạch thêm/sửa 1 biến động. Áp dụng thử lên sổ và kiểm tra âm tồn theo thời gian.
 */
export function planMovement(db, input, ctx) {
  const { today, actor, now } = ctx;
  const existing = input.id ? db.stock_movements.find((m) => m.id === input.id) : null;
  const rec = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor }),
    type: input.type,
    date: input.date,
    qty: Number(input.qty),
    from_pen_id: MOVEMENT_TYPES[input.type]?.from ? input.from_pen_id : null,
    to_pen_id: MOVEMENT_TYPES[input.type]?.to ? input.to_pen_id : null,
    source_cage_id: input.source_cage_id || null,
    source_clutch_id: input.source_clutch_id || null,
    order_id: input.order_id || existing?.order_id || null,
    note: (input.note || '').trim(),
    updated_at: now, updated_by: actor,
  };
  if (existing && (existing.qty !== rec.qty || existing.type !== rec.type)) rec.counted_total = null; // sửa tay thì không còn là số đếm được
  const errors = validateMovementShape(rec, db.flight_pens);
  if (isISODate(rec.date) && rec.date > today) errors.push('Không ghi biến động cho ngày tương lai');
  if (['adjust_in', 'adjust_out', 'loss'].includes(rec.type) && !rec.note) errors.push('Nhập lý do / ghi chú cho điều chỉnh hoặc hao hụt');
  if (errors.length) return { errors, ops: [] };
  const trial = db.stock_movements.filter((m) => m.id !== rec.id).concat(rec);
  const neg = findNegative(trial, db.flight_pens);
  if (neg.length) {
    const n = neg[0];
    return { errors: [`${n.pen.name} sẽ bị âm tồn (${n.balance}) vào ngày ${n.date}. Hiện còn ${penBalance(db.stock_movements, n.pen.id)} con.`], ops: [] };
  }
  return { errors: [], ops: [{ table: 'stock_movements', op: 'put', record: rec, before: existing || null }], record: rec };
}

export function planDeleteMovement(db, id, ctx) {
  const m = db.stock_movements.find((x) => x.id === id);
  if (!m) return { errors: ['Không tìm thấy biến động'], ops: [] };
  if (m.order_id) return { errors: ['Biến động thuộc đơn hàng — hãy sửa/huỷ đơn hàng thay vì xoá trực tiếp'], ops: [] };
  if (m.type === 'select_breeder') return { errors: ['Biến động tuyển giống gắn với hồ sơ chim giống — không xoá trực tiếp'], ops: [] };
  const trial = db.stock_movements.filter((x) => x.id !== id);
  const neg = findNegative(trial, db.flight_pens);
  if (neg.length) return { errors: [`Xoá sẽ làm ${neg[0].pen.name} âm tồn vào ngày ${neg[0].date}`], ops: [] };
  // Xoá mềm để giữ lịch sử
  return { errors: [], ops: [{ table: 'stock_movements', op: 'put', before: m, record: { ...m, deleted: true, deleted_at: ctx.now, deleted_by: ctx.actor } }] };
}

export const ORIGIN_LABELS = { unknown: 'Chưa xác định', known: 'Đã xác minh' };
export const PEN_NAME_MAX = 60;

/** Tách số hiện có theo nguồn: kiểm kê, chuyển đến, chuyển đi, hao hụt. balance = counted + movedIn − movedOut − lost. */
export function penSummary(movements, penId) {
  const s = { balance: 0, counted: 0, movedIn: 0, movedOut: 0, lost: 0, originUnknown: 0 };
  for (const m of activeMovements(movements)) {
    const into = m.to_pen_id === penId; const out = m.from_pen_id === penId;
    if (!into && !out) continue;
    s.balance += (into ? m.qty : 0) - (out ? m.qty : 0);
    if (m.type === 'adjust_in') { s.counted += m.qty; if (m.origin_status === 'unknown') s.originUnknown += m.qty; }
    else if (m.type === 'adjust_out') s.counted -= m.qty;
    else if (m.type === 'loss') s.lost += m.qty;
    else { if (into) s.movedIn += m.qty; if (out) s.movedOut += m.qty; }
  }
  return s;
}

/** Dòng kiểm kê: chênh lệch giữa số đếm được và sổ. Không tạo dòng chuyển giả. Số tăng mà chưa rõ nguồn = "Chưa xác định". */
function countMovement(db, { penId, counted, origin = '', note = '' }, ctx) {
  const book = penBalance(db.stock_movements, penId);
  const delta = counted - book;
  if (!delta) return null;
  const text = `Kiểm kê: đếm được ${counted} con, sổ ghi ${book} con${note ? ` — ${note}` : ''}`;
  return {
    id: uid(), type: delta > 0 ? 'adjust_in' : 'adjust_out', date: ctx.today, qty: Math.abs(delta),
    from_pen_id: delta < 0 ? penId : null, to_pen_id: delta > 0 ? penId : null, note: text, counted_total: counted,
    origin_status: delta > 0 ? (origin ? 'known' : 'unknown') : null, origin_note: delta > 0 && origin ? origin : null,
    created_at: ctx.now, created_by: ctx.actor, updated_at: ctx.now, updated_by: ctx.actor,
  };
}

const parseCount = (v) => (Number.isInteger(Number(v)) && v !== '' && v !== null && Number(v) >= 0 ? Number(v) : null);

/** Cập nhật số chim hiện có sau khi đếm. Khớp sổ thì không ghi gì. */
export function planPenCount(db, input, ctx) {
  const pen = db.flight_pens.find((p) => p.id === input.penId);
  if (!pen) return { errors: ['Không tìm thấy lồng phóng'], ops: [] };
  const counted = parseCount(input.counted);
  if (counted === null) return { errors: ['Số chim đếm được phải là số nguyên từ 0 trở lên'], ops: [] };
  const record = countMovement(db, { penId: pen.id, counted, origin: (input.origin || '').trim(), note: (input.note || '').trim() }, ctx);
  if (!record) return { errors: [], ops: [], unchanged: true };
  return { errors: [], ops: [{ table: 'stock_movements', op: 'put', record, before: null }], record };
}

/** Bổ sung nguồn gốc sau khi xác minh: chỉ đổi thông tin nguồn gốc, không đổi số lượng. */
export function planOrigin(db, id, originNote, ctx) {
  const m = db.stock_movements.find((x) => x.id === id && !x.deleted);
  if (!m) return { errors: ['Không tìm thấy dòng kiểm kê'], ops: [] };
  const text = (originNote || '').trim();
  if (!text) return { errors: ['Nhập nguồn gốc đã xác minh'], ops: [] };
  return { errors: [], ops: [{ table: 'stock_movements', op: 'put', before: m, record: { ...m, origin_status: 'known', origin_note: text, updated_at: ctx.now, updated_by: ctx.actor } }] };
}

/** Thêm / sửa / ngừng dùng lồng. Lồng còn chim không ngừng dùng được, để chim không biến mất khỏi tổng. */
export function planPenSave(db, input, ctx) {
  const existing = input.id ? db.flight_pens.find((p) => p.id === input.id) : null;
  const name = (input.name || '').trim();
  const archived = existing ? !!input.archived : false;
  const errors = [];
  if (!name) errors.push('Nhập tên lồng');
  else if (name.length > PEN_NAME_MAX) errors.push(`Tên lồng tối đa ${PEN_NAME_MAX} ký tự`);
  if (name && !archived && db.flight_pens.some((p) => p.id !== existing?.id && !p.archived && p.name.toLowerCase() === name.toLowerCase())) errors.push('Tên lồng đã tồn tại');
  if (existing && archived && !existing.archived) {
    const bal = penBalance(db.stock_movements, existing.id);
    if (bal > 0) errors.push(`${existing.name} còn ${bal} con. Hãy chuyển hết hoặc cập nhật số chim trước khi ngừng sử dụng.`);
  }
  const hasInitial = !existing && input.initial !== '' && input.initial !== undefined && input.initial !== null;
  const initial = hasInitial ? parseCount(input.initial) : 0;
  if (initial === null) errors.push('Số chim ban đầu phải là số nguyên từ 0 trở lên');
  if (errors.length) return { errors, ops: [] };
  const record = existing
    ? { ...existing, name, purpose: (input.purpose || '').trim(), archived, updated_at: ctx.now, updated_by: ctx.actor }
    : { id: uid(), name, purpose: (input.purpose || '').trim(), archived: false, sort: Math.max(0, ...db.flight_pens.map((p) => p.sort || 0)) + 1, created_at: ctx.now, created_by: ctx.actor, updated_at: ctx.now, updated_by: ctx.actor };
  const ops = [{ table: 'flight_pens', op: 'put', record, before: existing || null }];
  if (initial > 0) {
    ops.push({ table: 'stock_movements', op: 'put', before: null, record: countMovement({ stock_movements: [] }, { penId: record.id, counted: initial, origin: (input.origin || '').trim() }, ctx) });
  }
  return { errors: [], ops, record };
}

/** Lồng đã có dữ liệu liên quan (kể cả dòng đã xoá mềm) thì chỉ được ngừng sử dụng. Máy chủ kiểm tra lại khi xoá. */
export function penHasData(db, penId) {
  return db.stock_movements.some((m) => m.from_pen_id === penId || m.to_pen_id === penId)
    || (db.health_cases || []).some((h) => h.pen_id === penId)
    || (db.brood_events || []).some((e) => e.to_pen_id === penId)
    || (db.orders || []).some((o) => (o.items || []).some((it) => it.pen_id === penId));
}

/** Lịch sử biến động của 1 lồng kèm số dư sau từng dòng. */
export function penLedger(movements, penId) {
  const list = activeMovements(movements).filter((m) => m.from_pen_id === penId || m.to_pen_id === penId).sort(order);
  let bal = 0;
  return list.map((m) => {
    const delta = (m.to_pen_id === penId ? m.qty : 0) - (m.from_pen_id === penId ? m.qty : 0);
    bal += delta;
    return { ...m, delta, balance: bal };
  }).reverse();
}
