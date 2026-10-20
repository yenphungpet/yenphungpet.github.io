// Bán hàng: khách hàng, đơn hàng, thanh toán, công nợ, đồng bộ tồn lồng phóng.
//
// Chống trừ tồn 2 lần: mỗi dòng hàng (order item) có tối đa 1 biến động xuất kho đang hiệu lực,
// khớp theo cặp (order_id, order_item_id). Đổi trạng thái bao nhiêu lần cũng chỉ "đồng bộ" về đúng trạng thái mong muốn.
// Chống cộng trùng thu chi: mỗi thanh toán sinh đúng 1 giao dịch tài chính, khớp theo payment_id.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';
import { findNegative, penBalance } from './stock.js';

export const ORDER_STATUS = {
  draft: 'Nháp / báo giá',
  confirmed: 'Đã chốt',
  shipping: 'Đang giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};
export const STOCK_HOLD = new Set(['confirmed', 'shipping', 'completed']);
const TRANSITIONS = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'completed', 'cancelled', 'draft'],
  shipping: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: [],
};
export function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }

export const PAYMENT_KIND = { deposit: 'Đặt cọc', payment: 'Thanh toán', refund: 'Hoàn tiền' };
export const PAY_METHOD = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', other: 'Khác' };

export function orderSubtotal(order) {
  return (order.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
}
export function orderTotal(order) {
  return orderSubtotal(order) + (Number(order.shipping?.fee_charged) || 0) - (Number(order.discount) || 0);
}
export function orderPaid(payments, orderId) {
  return payments.filter((p) => p.order_id === orderId && !p.deleted)
    .reduce((s, p) => s + (p.kind === 'refund' ? -1 : 1) * (Number(p.amount) || 0), 0);
}
/** Công nợ khách còn phải trả (>0) hoặc trại cần hoàn lại (<0). Đơn nháp/huỷ không phát sinh nợ phải thu. */
export function orderBalance(order, payments) {
  const paid = orderPaid(payments, order.id);
  if (order.status === 'cancelled') return -paid; // đã thu bao nhiêu thì phải hoàn bấy nhiêu
  if (order.status === 'draft') return 0;
  return orderTotal(order) - paid;
}
export function paymentStatus(order, payments) {
  const paid = orderPaid(payments, order.id);
  const total = orderTotal(order);
  if (order.status === 'cancelled') return paid > 0 ? 'refund_due' : 'none';
  if (paid <= 0) return 'unpaid';
  if (paid < total) return payments.some((p) => p.order_id === order.id && !p.deleted && p.kind === 'payment') ? 'partial' : 'deposit';
  if (paid === total) return 'paid';
  return 'overpaid';
}
export const PAYMENT_STATUS_LABEL = { unpaid: 'Chưa thu', deposit: 'Đã cọc', partial: 'Thu một phần', paid: 'Đã thu đủ', overpaid: 'Thu dư', refund_due: 'Cần hoàn tiền', none: '—' };

export function debtSummary(orders, payments) {
  let receivable = 0; let refundDue = 0; let count = 0;
  for (const o of orders.filter((x) => !x.deleted)) {
    const b = orderBalance(o, payments);
    if (b > 0) { receivable += b; count += 1; } else if (b < 0) refundDue += -b;
  }
  return { receivable, refundDue, count };
}

export function validateOrder(order, db) {
  const errors = [];
  if (!isISODate(order.date)) errors.push('Ngày đơn không hợp lệ');
  if (!order.customer_id || !db.customers.some((c) => c.id === order.customer_id)) errors.push('Chọn khách hàng');
  if (!order.items?.length) errors.push('Đơn hàng cần ít nhất 1 dòng hàng');
  const birdSeen = new Set();
  (order.items || []).forEach((it, i) => {
    const n = `Dòng ${i + 1}`;
    if (!Number.isInteger(Number(it.qty)) || Number(it.qty) <= 0) errors.push(`${n}: số lượng phải là số nguyên > 0`);
    if (!(Number(it.unit_price) >= 0)) errors.push(`${n}: giá bán không hợp lệ`);
    if (it.kind === 'pen' && !db.flight_pens.some((p) => p.id === it.pen_id)) errors.push(`${n}: chọn lồng phóng xuất chim`);
    if (it.kind === 'breeder') {
      const b = db.birds.find((x) => x.id === it.bird_id);
      if (!b) errors.push(`${n}: chọn cá thể chim giống`);
      else {
        if (Number(it.qty) !== 1) errors.push(`${n}: chim giống bán theo từng cá thể (số lượng = 1)`);
        if (birdSeen.has(b.id)) errors.push(`${n}: cá thể bị chọn 2 lần`);
        birdSeen.add(b.id);
        if (b.status === 'dead') errors.push(`${n}: cá thể ${b.ring_code} đã chết`);
        if (b.status === 'sold' && b.sold_order_id !== order.id) errors.push(`${n}: cá thể ${b.ring_code} đã bán ở đơn khác`);
        if (b.status === 'paired' && STOCK_HOLD.has(order.status)) errors.push(`${n}: cá thể ${b.ring_code} đang ghép sinh sản — thay chim trong lồng trước khi bán`);
      }
    }
    if (it.kind === 'other' && !it.description?.trim()) errors.push(`${n}: nhập mô tả sản phẩm`);
  });
  if ((Number(order.discount) || 0) < 0) errors.push('Giảm giá không hợp lệ');
  if (orderTotal(order) < 0) errors.push('Tổng tiền âm — kiểm tra giảm giá');
  return errors;
}

/** Tính các thao tác để tồn kho khớp với trạng thái đơn (idempotent). */
export function planStockSync(db, order, ctx) {
  const { actor, now } = ctx;
  const ops = [];
  const hold = STOCK_HOLD.has(order.status);
  const current = db.stock_movements.filter((m) => m.order_id === order.id && !m.deleted);
  const want = hold ? (order.items || []).filter((it) => it.kind === 'pen') : [];
  const trial = db.stock_movements.slice();
  const upsert = (rec) => { const i = trial.findIndex((m) => m.id === rec.id); if (i >= 0) trial[i] = rec; else trial.push(rec); };
  for (const it of want) {
    const ex = current.find((m) => m.order_item_id === it.id);
    const desired = { type: 'sale', date: order.date, qty: Number(it.qty), from_pen_id: it.pen_id, to_pen_id: null };
    if (ex) {
      if (ex.qty !== desired.qty || ex.from_pen_id !== desired.from_pen_id || ex.date !== desired.date) {
        const rec = { ...ex, ...desired, updated_at: now, updated_by: actor };
        ops.push({ table: 'stock_movements', op: 'put', record: rec, before: ex }); upsert(rec);
      }
    } else {
      const rec = { id: uid(), ...desired, order_id: order.id, order_item_id: it.id, note: `Đơn ${order.code}`, created_at: now, created_by: actor };
      ops.push({ table: 'stock_movements', op: 'put', record: rec }); upsert(rec);
    }
  }
  for (const m of current) {
    if (!want.some((it) => it.id === m.order_item_id)) {
      const rec = { ...m, deleted: true, deleted_at: now, deleted_by: actor, note: `${m.note || ''} (hoàn tồn do ${order.status === 'cancelled' ? 'huỷ đơn' : 'sửa đơn'})` };
      ops.push({ table: 'stock_movements', op: 'put', record: rec, before: m }); upsert(rec);
    }
  }
  const errors = [];
  const neg = findNegative(trial, db.flight_pens);
  if (neg.length) {
    const n = neg[0];
    errors.push(`${n.pen.name} không đủ chim: hiện còn ${penBalance(db.stock_movements, n.pen.id)} con, đơn sẽ làm âm tồn vào ngày ${n.date}`);
  }
  // Chim giống bán theo cá thể
  const wantBirds = new Set(hold ? (order.items || []).filter((it) => it.kind === 'breeder').map((it) => it.bird_id) : []);
  for (const b of db.birds) {
    if (wantBirds.has(b.id) && !(b.status === 'sold' && b.sold_order_id === order.id)) {
      ops.push({ table: 'birds', op: 'put', before: b, record: { ...b, status: 'sold', status_before_sale: b.status, sold_order_id: order.id, updated_at: now, updated_by: actor } });
    } else if (!wantBirds.has(b.id) && b.sold_order_id === order.id && b.status === 'sold') {
      ops.push({ table: 'birds', op: 'put', before: b, record: { ...b, status: b.status_before_sale || 'holding', sold_order_id: null, status_before_sale: null, updated_at: now, updated_by: actor } });
    }
  }
  return { errors, ops };
}

function nextOrderCode(db, date) {
  const prefix = `DH${date.slice(2, 4)}${date.slice(5, 7)}`;
  const n = db.orders.filter((o) => o.code?.startsWith(prefix)).length + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** Tạo / sửa đơn (không đổi trạng thái ở đây trừ khi tạo mới). */
export function planOrderSave(db, input, ctx) {
  const { actor, now } = ctx;
  const existing = input.id ? db.orders.find((o) => o.id === input.id) : null;
  const order = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor, history: [] }),
    date: input.date,
    customer_id: input.customer_id,
    status: existing ? existing.status : (input.status || 'draft'),
    items: (input.items || []).map((it) => ({ ...it, id: it.id || uid(), qty: Number(it.qty), unit_price: Number(it.unit_price) || 0 })),
    discount: Number(input.discount) || 0,
    shipping: { ...(input.shipping || {}), fee_charged: Number(input.shipping?.fee_charged) || 0 },
    note: (input.note || '').trim(),
    updated_at: now, updated_by: actor,
  };
  if (!order.code) order.code = isISODate(order.date) ? nextOrderCode(db, order.date) : 'DH';
  if (existing?.status === 'cancelled') return { errors: ['Đơn đã huỷ, không thể sửa'], ops: [] };
  const errors = validateOrder(order, db);
  if (errors.length) return { errors, ops: [] };
  order.history = [...(order.history || []), { at: now, by: actor, action: existing ? 'Sửa đơn' : 'Tạo đơn', detail: `Tổng ${orderTotal(order)}` }];
  const sync = planStockSync(db, order, ctx);
  if (sync.errors.length) return { errors: sync.errors, ops: [] };
  return { errors: [], ops: [{ table: 'orders', op: 'put', record: order, before: existing || null }, ...sync.ops], record: order };
}

export function planOrderStatus(db, orderId, to, ctx, reason = '') {
  const { actor, now } = ctx;
  const o = db.orders.find((x) => x.id === orderId);
  if (!o) return { errors: ['Không tìm thấy đơn'], ops: [] };
  if (o.status === to) return { errors: [], ops: [] }; // idempotent
  if (!canTransition(o.status, to)) return { errors: [`Không thể chuyển từ "${ORDER_STATUS[o.status]}" sang "${ORDER_STATUS[to]}"`], ops: [] };
  if (to === 'cancelled' && !reason.trim()) return { errors: ['Nhập lý do huỷ đơn'], ops: [] };
  const rec = { ...o, status: to, updated_at: now, updated_by: actor,
    history: [...(o.history || []), { at: now, by: actor, action: `Trạng thái: ${ORDER_STATUS[o.status]} → ${ORDER_STATUS[to]}`, detail: reason }] };
  if (to === 'cancelled') { rec.cancel_reason = reason; rec.cancelled_at = now; }
  if (STOCK_HOLD.has(to)) {
    const errs = validateOrder(rec, db);
    if (errs.length) return { errors: errs, ops: [] };
  }
  const sync = planStockSync(db, rec, ctx);
  if (sync.errors.length) return { errors: sync.errors, ops: [] };
  return { errors: [], ops: [{ table: 'orders', op: 'put', record: rec, before: o }, ...sync.ops] };
}

/** Thanh toán / đặt cọc / hoàn tiền. Mỗi thanh toán sinh đúng 1 giao dịch tài chính (khớp payment_id). */
export function planPayment(db, input, ctx) {
  const { actor, now, today } = ctx;
  const errors = [];
  const o = db.orders.find((x) => x.id === input.order_id);
  if (!o) return { errors: ['Không tìm thấy đơn'], ops: [] };
  const existing = input.id ? db.payments.find((p) => p.id === input.id) : null;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Số tiền phải > 0');
  if (!isISODate(input.date)) errors.push('Ngày thanh toán không hợp lệ');
  else if (input.date > today) errors.push('Ngày thanh toán không được ở tương lai');
  if (!PAYMENT_KIND[input.kind]) errors.push('Chọn loại thanh toán');
  if (o.status === 'draft' && input.kind !== 'deposit') errors.push('Đơn nháp chỉ nhận đặt cọc. Hãy chốt đơn trước.');
  if (o.status === 'cancelled' && input.kind !== 'refund') errors.push('Đơn đã huỷ — chỉ ghi nhận hoàn tiền');
  const others = db.payments.filter((p) => p.order_id === o.id && !p.deleted && p.id !== existing?.id);
  const paidOthers = others.reduce((s, p) => s + (p.kind === 'refund' ? -1 : 1) * p.amount, 0);
  if (input.kind === 'refund' && amount > paidOthers) errors.push(`Hoàn tiền vượt số đã thu (${paidOthers})`);
  const warnings = [];
  if (input.kind !== 'refund' && o.status !== 'cancelled' && paidOthers + amount > orderTotal(o)) warnings.push('Tổng đã thu sẽ vượt giá trị đơn');
  if (errors.length) return { errors, warnings, ops: [] };
  const pay = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor }),
    order_id: o.id, date: input.date, kind: input.kind, amount, method: input.method || 'cash', note: (input.note || '').trim(),
    updated_at: now, updated_by: actor,
  };
  const customer = db.customers.find((c) => c.id === o.customer_id);
  const txExisting = db.transactions.find((t) => t.payment_id === pay.id);
  const tx = {
    ...(txExisting || { id: uid(), created_at: now, created_by: actor }),
    date: pay.date,
    type: pay.kind === 'refund' ? 'expense' : 'income',
    amount,
    category: pay.kind === 'refund' ? 'Hoàn tiền khách' : 'Bán chim',
    description: `${PAYMENT_KIND[pay.kind]} đơn ${o.code}${customer ? ' — ' + customer.name : ''}`,
    note: pay.note, source: 'payment', payment_id: pay.id, order_id: o.id, deleted: false,
    updated_at: now, updated_by: actor,
  };
  const hist = { ...o, history: [...(o.history || []), { at: now, by: actor, action: `${existing ? 'Sửa' : 'Ghi'} ${PAYMENT_KIND[pay.kind].toLowerCase()}`, detail: String(amount) }], updated_at: now };
  return { errors: [], warnings, ops: [
    { table: 'payments', op: 'put', record: pay, before: existing || null },
    { table: 'transactions', op: 'put', record: tx, before: txExisting || null },
    { table: 'orders', op: 'put', record: hist, before: o },
  ] };
}

export function planDeletePayment(db, paymentId, ctx) {
  const { actor, now } = ctx;
  const p = db.payments.find((x) => x.id === paymentId && !x.deleted);
  if (!p) return { errors: ['Không tìm thấy thanh toán'], ops: [] };
  const tx = db.transactions.find((t) => t.payment_id === p.id);
  const ops = [{ table: 'payments', op: 'put', before: p, record: { ...p, deleted: true, deleted_at: now, deleted_by: actor } }];
  if (tx) ops.push({ table: 'transactions', op: 'put', before: tx, record: { ...tx, deleted: true, deleted_at: now, deleted_by: actor } });
  return { errors: [], ops };
}

/** Doanh thu bán hàng (theo giá trị đơn đã chốt, không phải dòng tiền). */
export function salesRevenue(orders, from, to) {
  return orders.filter((o) => !o.deleted && STOCK_HOLD.has(o.status) && (!from || o.date >= from) && (!to || o.date <= to))
    .reduce((s, o) => s + orderTotal(o), 0);
}
