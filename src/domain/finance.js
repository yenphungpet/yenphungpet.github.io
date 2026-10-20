// Tài chính: thu chi (dòng tiền). "Chênh lệch thu − chi" KHÔNG phải lợi nhuận ròng
// vì chưa đủ dữ liệu giá vốn (chim giống, khấu hao lồng, công lao động...).

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';

export const EXPENSE_CATEGORIES = ['Thức ăn', 'Thuốc / khoáng', 'Vật tư', 'Chim giống', 'Lương', 'Điện nước', 'Vận chuyển', 'Giấy phép', 'Hoàn tiền khách', 'Khác'];
export const INCOME_CATEGORIES = ['Bán chim', 'Bán phụ kiện', 'Khác'];

/** Loại bỏ bản ghi trùng id và bản ghi đã xoá — tránh cộng trùng khi đồng bộ nhiều lần. */
export function dedupeActive(txs) {
  const m = new Map();
  for (const t of txs) if (!t.deleted) m.set(t.id, t);
  return [...m.values()];
}

export function filterTx(txs, { from = null, to = null, type = null, category = null } = {}) {
  return dedupeActive(txs).filter((t) => isISODate(t.date)
    && (!from || t.date >= from) && (!to || t.date <= to)
    && (!type || t.type === type) && (!category || t.category === category));
}

export function summarize(txs) {
  let income = 0; let expense = 0;
  const byCategory = {};
  for (const t of dedupeActive(txs)) {
    const a = Number(t.amount) || 0;
    if (t.type === 'income') income += a; else if (t.type === 'expense') expense += a;
    const k = `${t.type}|${t.category || 'Khác'}`;
    byCategory[k] = (byCategory[k] || 0) + a;
  }
  return { income, expense, diff: income - expense, byCategory };
}

/** Chuỗi theo tháng trong 1 năm: [{month:'2026-01', income, expense, diff}] */
export function monthlySeries(txs, year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const s = summarize(dedupeActive(txs).filter((t) => t.date?.startsWith(key)));
    out.push({ month: key, ...s });
  }
  return out;
}

export function yearlySeries(txs) {
  const years = [...new Set(dedupeActive(txs).map((t) => t.date?.slice(0, 4)).filter(Boolean))].sort();
  return years.map((y) => ({ year: y, ...summarize(dedupeActive(txs).filter((t) => t.date.startsWith(y))) }));
}

/** Dấu hiệu dữ liệu cần kiểm tra lại (không tự sửa). */
export function dataQualityFlags(t) {
  const f = [];
  if (t.type === 'income' && EXPENSE_CATEGORIES.includes(t.category) && !INCOME_CATEGORIES.includes(t.category)) f.push('Khoản THU nhưng danh mục là chi phí');
  if (t.type === 'expense' && t.category === 'Bán chim') f.push('Khoản CHI nhưng danh mục là bán chim');
  if (!(Number(t.amount) > 0)) f.push('Số tiền không hợp lệ');
  return f;
}

export function planTransaction(db, input, ctx) {
  const { actor, now, today } = ctx;
  const errors = [];
  const existing = input.id ? db.transactions.find((t) => t.id === input.id) : null;
  if (existing?.source === 'payment') return { errors: ['Giao dịch sinh từ thanh toán đơn hàng — hãy sửa trong đơn hàng'], ops: [] };
  if (existing?.source === 'inventory') return { errors: ['Giao dịch sinh từ phiếu nhập kho — hãy sửa trong Kho & thức ăn'], ops: [] };
  const linked = existing && (db.inventory_movements || []).find((m) => m.transaction_id === existing.id && !m.deleted);
  if (linked && (Number(input.amount) !== Number(existing.amount) || input.type !== existing.type)) {
    return { errors: ['Khoản chi này đang liên kết với một phiếu nhập kho — đổi số tiền/loại sẽ lệch với kho. Hãy bỏ liên kết trong Kho trước.'], ops: [] };
  }
  const amount = Number(input.amount);
  if (!['income', 'expense'].includes(input.type)) errors.push('Chọn Thu hoặc Chi');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Số tiền phải > 0');
  if (!isISODate(input.date)) errors.push('Ngày không hợp lệ');
  else if (input.date > today) errors.push('Ngày không được ở tương lai');
  if (!input.description?.trim()) errors.push('Nhập nội dung');
  if (errors.length) return { errors, ops: [] };
  const rec = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor, source: 'manual' }),
    type: input.type, amount, date: input.date, category: input.category || 'Khác',
    description: input.description.trim(), note: (input.note || '').trim(), updated_at: now, updated_by: actor,
  };
  return { errors: [], ops: [{ table: 'transactions', op: 'put', record: rec, before: existing || null }], record: rec };
}

export function planDeleteTransaction(db, id, ctx) {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) return { errors: ['Không tìm thấy giao dịch'], ops: [] };
  if (t.source === 'payment') return { errors: ['Giao dịch sinh từ thanh toán đơn hàng — xoá thanh toán trong đơn hàng'], ops: [] };
  if (t.source === 'inventory') return { errors: ['Giao dịch sinh từ phiếu nhập kho — xoá/sửa phiếu trong Kho & thức ăn'], ops: [] };
  if ((db.inventory_movements || []).some((m) => m.transaction_id === t.id && !m.deleted)) return { errors: ['Khoản chi đang liên kết với phiếu nhập kho — bỏ liên kết trong Kho trước khi xoá'], ops: [] };
  return { errors: [], ops: [{ table: 'transactions', op: 'put', before: t, record: { ...t, deleted: true, deleted_at: ctx.now, deleted_by: ctx.actor } }] };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
