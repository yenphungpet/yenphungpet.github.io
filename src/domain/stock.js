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
