// Kho vật tư & thức ăn — sổ biến động (ledger), giữ nghiệp vụ App cũ và sửa các điểm yếu:
//  App cũ: danh mục (Thức ăn / Thuốc–khoáng / Vật tư / Khác), đơn vị, ngưỡng cảnh báo, kiểm kê (ngày + số lượng + ghi chú),
//          nút ±1, "tiêu hao/ngày" để ƯỚC TÍNH tồn & số ngày còn lại, cảnh báo sắp hết.
//  V2: mọi thay đổi tồn là 1 dòng biến động có lịch sử; kiểm kê lưu số đếm thực tế và chênh lệch so với sổ;
//      tiêu hao/ngày chỉ dùng để ước tính số ngày còn lại — KHÔNG tự trừ tồn; chống âm tồn theo thời gian;
//      nhập mua có thể ghi chi phí vào Tài chính (1 phiếu ↔ tối đa 1 giao dịch, không cộng trùng).

import { isISODate, daysBetween, addDays } from '../core/dates.js';
import { uid } from '../core/ids.js';

export const INV_CATEGORIES = ['Thức ăn', 'Thuốc / khoáng', 'Vật tư', 'Khác'];
export const INV_TYPES = {
  opening: { label: 'Tồn đầu kỳ', sign: 1 },
  purchase: { label: 'Nhập mua', sign: 1 },
  in_other: { label: 'Nhập khác', sign: 1 },
  use: { label: 'Xuất dùng', sign: -1 },
  loss: { label: 'Hao hụt / hư hỏng', sign: -1 },
  count: { label: 'Kiểm kê', sign: 0 },
};
// Đơn vị chuẩn (viết thường). Nhập "Kg", "KG" => "kg".
export const UNITS = ['kg', 'g', 'gói', 'bao', 'túi', 'hộp', 'chai', 'lọ', 'lít', 'ml', 'cái', 'quả', 'trái', 'tờ', 'cuộn', 'thùng', 'viên', 'liều'];
const UNIT_ALIAS = { kilogram: 'kg', kgs: 'kg', gram: 'g', gr: 'g', l: 'lít', lit: 'lít', goi: 'gói', tui: 'túi', hop: 'hộp', cai: 'cái', qua: 'quả', trai: 'trái', to: 'tờ', thung: 'thùng' };

const EPS = 1e-9;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** Chuẩn hoá đơn vị. Trả về { unit, ok, raw, reason } — không đoán khi đơn vị chứa số (VD "8 Gói"). */
export function normalizeUnit(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { unit: '', ok: false, raw: s, reason: 'Thiếu đơn vị' };
  if (/\d/.test(s)) return { unit: '', ok: false, raw: s, reason: `Đơn vị "${s}" có chứa số — không rõ là đơn vị hay quy cách` };
  const low = s.toLowerCase().normalize('NFC');
  const ascii = low.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const unit = UNITS.includes(low) ? low : UNIT_ALIAS[ascii] || UNIT_ALIAS[low] || null;
  if (!unit) return { unit: low, ok: true, raw: s, reason: 'Đơn vị ngoài danh sách chuẩn (vẫn chấp nhận)' };
  return { unit, ok: true, raw: s, reason: unit !== s ? `Chuẩn hoá "${s}" → "${unit}"` : '' };
}

const order = (a, b) => (a.date === b.date
  ? String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id))
  : a.date.localeCompare(b.date));

/** Sổ của 1 vật tư theo thời gian, kèm chênh lệch kiểm kê và số dư sau từng dòng. */
export function itemLedger(movements, itemId) {
  let bal = 0;
  const rows = movements.filter((m) => m.item_id === itemId && !m.deleted).slice().sort(order).map((m) => {
    let delta;
    if (m.type === 'count') delta = round3(Number(m.counted_qty) - bal);
    else delta = round3((INV_TYPES[m.type]?.sign || 0) * Number(m.qty));
    bal = round3(bal + delta);
    return { ...m, delta, balance: bal, negative: bal < -EPS };
  });
  return rows;
}

export function itemBalance(movements, itemId, uptoDate = null) {
  const rows = itemLedger(movements, itemId).filter((r) => !uptoDate || r.date <= uptoDate);
  return rows.length ? rows[rows.length - 1].balance : 0;
}

/** Tiêu hao trung bình/ngày thực tế từ các dòng "xuất dùng" trong N ngày gần nhất (null nếu chưa có). */
export function avgDailyUse(movements, itemId, today, days = 30) {
  const from = addDays(today, -days + 1);
  const used = movements.filter((m) => m.item_id === itemId && !m.deleted && m.type === 'use' && m.date >= from && m.date <= today)
    .reduce((a, m) => a + Number(m.qty), 0);
  return used > 0 ? round3(used / days) : null;
}

/** Trạng thái hiển thị của 1 vật tư. */
export function itemStatus(item, movements, today) {
  const ledger = itemLedger(movements, item.id);
  const balance = ledger.length ? ledger[ledger.length - 1].balance : 0;
  const lastCount = [...ledger].reverse().find((r) => r.type === 'count') || null;
  const actualUse = avgDailyUse(movements, item.id, today);
  const rate = actualUse ?? (Number(item.daily_use_estimate) > 0 ? Number(item.daily_use_estimate) : null);
  const daysLeft = rate ? Math.floor(balance / rate) : null;
  const threshold = Number(item.threshold) || 0;
  const level = threshold > 0 && balance <= threshold + EPS ? 'low' : threshold > 0 && balance <= threshold * 1.5 + EPS ? 'warn' : 'ok';
  return {
    item, balance, level, ledger, lastCount,
    rate, rateSource: actualUse ? 'actual' : rate ? 'estimate' : null, daysLeft,
    daysSinceCount: lastCount ? daysBetween(lastCount.date, today) : null,
    needsReview: !!item.needs_review,
  };
}

export function lowStockItems(db, today) {
  return (db.inventory_items || []).filter((i) => !i.archived && !i.deleted)
    .map((i) => itemStatus(i, db.inventory_movements || [], today)).filter((s) => s.level === 'low');
}

export function validateItem(it, items) {
  const errors = [];
  if (!it.name?.trim()) errors.push('Nhập tên vật tư');
  else if (items.some((x) => x.id !== it.id && !x.deleted && x.name.trim().toLowerCase() === it.name.trim().toLowerCase())) errors.push('Tên vật tư đã tồn tại');
  if (!INV_CATEGORIES.includes(it.category)) errors.push('Chọn danh mục');
  const u = normalizeUnit(it.unit);
  if (!u.ok) errors.push(u.reason);
  if (!(Number(it.threshold) >= 0)) errors.push('Ngưỡng cảnh báo phải ≥ 0');
  if (it.daily_use_estimate !== null && it.daily_use_estimate !== undefined && it.daily_use_estimate !== '' && !(Number(it.daily_use_estimate) >= 0)) errors.push('Tiêu hao ước tính phải ≥ 0');
  return errors;
}

export function planItemSave(db, input, ctx) {
  const { actor, now } = ctx;
  const existing = input.id ? db.inventory_items.find((i) => i.id === input.id) : null;
  const u = normalizeUnit(input.unit);
  const rec = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor }),
    name: (input.name || '').trim(), category: input.category, unit: u.unit,
    threshold: round3(Number(input.threshold) || 0),
    daily_use_estimate: input.daily_use_estimate === '' || input.daily_use_estimate == null ? null : round3(Number(input.daily_use_estimate)),
    note: (input.note || '').trim(), archived: !!input.archived,
    needs_review: input.needs_review ?? existing?.needs_review ?? false,
    updated_at: now, updated_by: actor,
  };
  const errors = validateItem({ ...rec, unit: input.unit }, db.inventory_items);
  if (existing && existing.unit !== rec.unit && db.inventory_movements.some((m) => m.item_id === existing.id && !m.deleted)) {
    errors.push(`Không đổi đơn vị gốc "${existing.unit}" khi đã có lịch sử nhập/xuất (sẽ sai toàn bộ số liệu). Hãy tạo vật tư mới hoặc dùng "quy cách" khi nhập.`);
  }
  if (errors.length) return { errors, ops: [] };
  return { errors: [], ops: [{ table: 'inventory_items', op: 'put', record: rec, before: existing || null }], record: rec };
}

/**
 * Chi phí của 1 phiếu nhập mua (B12): nằm ở bảng inventory_costs, RLS chỉ chủ trại đọc được — nhân viên nhận 0 dòng
 * nên hàm trả null. Dữ liệu demo tạo trước 0009 còn chi phí trên chính phiếu: đọc tạm từ đó tới khi được chuyển.
 */
export function invCost(db, m) {
  if (!m) return null;
  const c = (db.inventory_costs || []).find((x) => x.id === m.id);
  if (c) return c;
  return m.total_cost != null || m.unit_cost != null ? { id: m.id, unit_cost: m.unit_cost ?? null, total_cost: m.total_cost ?? null } : null;
}

/** Chuyển chi phí còn nằm trên phiếu kho (dữ liệu demo trước 0009) sang inventory_costs — giống migration 0009 trên server. */
export function planMoveLegacyCosts(db) {
  const ops = [];
  for (const m of db.inventory_movements || []) {
    if (m.unit_cost == null && m.total_cost == null) continue;
    if (!(db.inventory_costs || []).some((c) => c.id === m.id)) {
      ops.push({ table: 'inventory_costs', op: 'put', record: { id: m.id, unit_cost: m.unit_cost ?? null, total_cost: m.total_cost ?? null, created_at: m.created_at, created_by: m.created_by, updated_at: m.updated_at, updated_by: m.updated_by } });
    }
    ops.push({ table: 'inventory_movements', op: 'put', record: { ...m, unit_cost: null, total_cost: null } });
  }
  return ops;
}

/**
 * Thêm / sửa 1 dòng kho.
 * input: { id?, item_id, type, date, qty (theo đơn vị gốc) | pack_qty + pack_size (quy cách), counted_qty (kiểm kê),
 *          unit_cost?, total_cost?, supplier?, note?, finance: 'none'|'create'|'link', link_transaction_id? }
 */
export function planInvMovement(db, input, ctx) {
  const { actor, now, today } = ctx;
  const errors = [];
  const item = db.inventory_items.find((i) => i.id === input.item_id && !i.deleted);
  if (!item) return { errors: ['Chọn vật tư'], ops: [] };
  const existing = input.id ? db.inventory_movements.find((m) => m.id === input.id && !m.deleted) : null;
  if (input.id && !existing) return { errors: ['Dòng kho cần sửa không còn tồn tại'], ops: [] };
  if (existing && input.expectedVersion !== undefined && input.expectedVersion !== null && (existing.version || 0) !== input.expectedVersion) {
    return { errors: ['Bản ghi vừa được sửa ở thiết bị/người khác sau khi bạn mở biểu mẫu. Dữ liệu mới đã được tải — hãy đóng và mở lại biểu mẫu rồi sửa tiếp (thay đổi của bạn chưa được lưu).'], ops: [], conflict: true };
  }
  const t = INV_TYPES[input.type];
  if (!t) errors.push('Chọn loại nhập/xuất');
  if (!isISODate(input.date)) errors.push('Ngày không hợp lệ');
  else if (input.date > today) errors.push('Không ghi kho cho ngày tương lai');

  // Số lượng theo đơn vị gốc; hỗ trợ quy cách: số gói × kg/gói
  let qty = null; let packQty = null; let packSize = null;
  if (input.type === 'count') {
    const c = Number(input.counted_qty);
    if (input.counted_qty === '' || input.counted_qty == null || !Number.isFinite(c) || c < 0) errors.push('Nhập số lượng đếm thực tế (≥ 0)');
  } else if (input.pack_qty !== undefined && input.pack_qty !== '' && input.pack_qty != null) {
    packQty = Number(input.pack_qty); packSize = Number(input.pack_size);
    if (!(packQty > 0)) errors.push('Số gói/bao phải > 0');
    if (!(packSize > 0)) errors.push(`Quy cách (${item.unit}/gói) phải > 0`);
    qty = round3(packQty * packSize);
  } else {
    qty = round3(Number(input.qty));
    if (!(qty > 0)) errors.push(`Số lượng (${item.unit}) phải > 0`);
  }

  // Chi phí & liên kết tài chính (chỉ cho nhập mua)
  const finance = input.type === 'purchase' ? (input.finance || 'none') : 'none';
  let totalCost = null;
  if (input.type === 'purchase') {
    if (input.total_cost !== '' && input.total_cost != null) totalCost = Math.round(Number(input.total_cost));
    else if (input.unit_cost !== '' && input.unit_cost != null && qty) totalCost = Math.round(Number(input.unit_cost) * qty);
    if (totalCost !== null && !(totalCost >= 0)) errors.push('Thành tiền không hợp lệ');
    if (finance === 'create' && !(totalCost > 0)) errors.push('Nhập thành tiền để ghi chi phí vào Tài chính');
    if (finance === 'link') {
      const tx = db.transactions.find((x) => x.id === input.link_transaction_id && !x.deleted);
      if (!tx) errors.push('Chọn khoản chi đã có trong Tài chính để liên kết');
      else {
        if (tx.type !== 'expense') errors.push('Chỉ liên kết được với khoản CHI');
        const usedBy = db.inventory_movements.find((m) => m.transaction_id === tx.id && !m.deleted && m.id !== existing?.id);
        if (usedBy) errors.push('Khoản chi này đã được liên kết với một phiếu nhập khác (tránh cộng trùng chi phí)');
        if (tx.source === 'inventory' && tx.inventory_movement_id !== existing?.id) errors.push('Khoản chi này do một phiếu kho khác tạo ra');
      }
    }
  } else if (input.total_cost || input.unit_cost) errors.push('Chỉ phiếu nhập mua mới có chi phí');
  if (['loss'].includes(input.type) && !input.note?.trim()) errors.push('Nhập lý do hao hụt / hư hỏng');
  if (errors.length) return { errors, ops: [] };

  const rec = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor, version: 0 }),
    item_id: item.id, type: input.type, date: input.date,
    qty: input.type === 'count' ? null : qty,
    counted_qty: input.type === 'count' ? round3(Number(input.counted_qty)) : null,
    unit: item.unit, pack_qty: packQty, pack_size: packSize,
    unit_cost: null, total_cost: null, // B12: chi phí ghi ở inventory_costs (chỉ chủ trại), cột cũ luôn rỗng
    supplier: input.type === 'purchase' ? (input.supplier || '').trim() : '',
    note: (input.note || '').trim(),
    updated_at: now, updated_by: actor,
    version: existing ? (existing.version || 0) + 1 : 0,
  };

  // Chống âm tồn theo thời gian (kiểm kê "đặt lại" số dư nên chỉ chặn xuất vượt tồn)
  const trial = db.inventory_movements.filter((m) => m.id !== rec.id).concat(rec);
  const bad = itemLedger(trial, item.id).find((r) => r.negative);
  if (bad) {
    return { errors: [`${item.name} sẽ bị âm tồn (${bad.balance} ${item.unit}) vào ngày ${bad.date}. Tồn sổ hiện tại: ${itemBalance(db.inventory_movements, item.id)} ${item.unit}. Nếu thực tế còn nhiều hơn, hãy ghi "Kiểm kê" trước.`], ops: [] };
  }

  const ops = [];
  // Tài chính: tạo / cập nhật / huỷ liên kết — 1 phiếu ↔ tối đa 1 giao dịch
  const ownTx = existing?.transaction_id ? db.transactions.find((x) => x.id === existing.transaction_id) : null;
  if (finance === 'create') {
    const base = ownTx && ownTx.source === 'inventory' ? ownTx : null;
    const tx = {
      ...(base || { id: uid(), created_at: now, created_by: actor }),
      date: rec.date, type: 'expense', amount: totalCost,
      category: item.category === 'Vật tư' ? 'Vật tư' : item.category === 'Thuốc / khoáng' ? 'Thuốc / khoáng' : 'Thức ăn',
      description: `Nhập kho: ${item.name} ${rec.qty} ${item.unit}${rec.supplier ? ` — ${rec.supplier}` : ''}`,
      note: rec.note, source: 'inventory', inventory_movement_id: rec.id, deleted: false, updated_at: now, updated_by: actor,
    };
    rec.transaction_id = tx.id; rec.finance_mode = 'created';
    ops.push({ table: 'transactions', op: 'put', record: tx, before: base }); // ghi khoản chi TRƯỚC phiếu (khoá ngoại transaction_id)
  } else if (finance === 'link') {
    rec.transaction_id = input.link_transaction_id; rec.finance_mode = 'linked';
  } else {
    rec.transaction_id = null; rec.finance_mode = 'none';
  }
  // Nếu trước đây phiếu tự tạo giao dịch mà nay đổi sang không ghi / liên kết khoản khác => xoá mềm giao dịch tự tạo cũ
  if (ownTx && ownTx.source === 'inventory' && rec.transaction_id !== ownTx.id) {
    ops.push({ table: 'transactions', op: 'put', before: ownTx, record: { ...ownTx, deleted: true, deleted_at: now, deleted_by: actor } });
  }
  // Thứ tự: [khoản chi mới] → phiếu kho → [xoá mềm khoản chi cũ]
  const createIdx = ops.findIndex((o) => o.table === 'transactions' && o.record.id === rec.transaction_id);
  ops.splice(createIdx + 1, 0, { table: 'inventory_movements', op: 'put', record: rec, before: existing || null });
  // Chi phí (chỉ chủ trại): 1 dòng inventory_costs / phiếu nhập; phiếu thôi có chi phí => đặt rỗng (không xoá cứng)
  const oldCost = existing ? (db.inventory_costs || []).find((c) => c.id === rec.id) : null;
  const unitCost = input.type === 'purchase' && totalCost !== null && qty ? Math.round(totalCost / qty) : null;
  const newTotal = input.type === 'purchase' ? totalCost : null;
  if (newTotal !== null || oldCost) {
    ops.push({ table: 'inventory_costs', op: 'put', before: oldCost || null,
      record: { ...(oldCost || { id: rec.id, created_at: now, created_by: actor }), unit_cost: unitCost, total_cost: newTotal, updated_at: now, updated_by: actor } });
  }
  return { errors: [], ops, record: rec, cost: newTotal };
}

/** Xoá mềm dòng kho (kèm xoá mềm giao dịch chi phí do chính phiếu tạo). */
export function planDeleteInvMovement(db, id, ctx) {
  const { actor, now } = ctx;
  const m = db.inventory_movements.find((x) => x.id === id && !x.deleted);
  if (!m) return { errors: ['Không tìm thấy dòng kho'], ops: [] };
  const trial = db.inventory_movements.filter((x) => x.id !== id);
  const bad = itemLedger(trial, m.item_id).find((r) => r.negative);
  if (bad) return { errors: [`Xoá dòng này sẽ làm âm tồn vào ngày ${bad.date}`], ops: [] };
  const ops = [{ table: 'inventory_movements', op: 'put', before: m, record: { ...m, deleted: true, deleted_at: now, deleted_by: actor } }];
  const tx = m.transaction_id ? db.transactions.find((x) => x.id === m.transaction_id) : null;
  if (tx && tx.source === 'inventory' && !tx.deleted) ops.push({ table: 'transactions', op: 'put', before: tx, record: { ...tx, deleted: true, deleted_at: now, deleted_by: actor } });
  return { errors: [], ops };
}

/** Đối chiếu tồn: sổ sách trước lần kiểm kê gần nhất so với số đếm thực tế. */
export function reconciliation(db, today) {
  return (db.inventory_items || []).filter((i) => !i.deleted && !i.archived).map((i) => {
    const st = itemStatus(i, db.inventory_movements, today);
    const c = st.lastCount;
    return {
      item: i, balance: st.balance,
      lastCountDate: c?.date || null, counted: c ? c.counted_qty : null,
      bookBeforeCount: c ? round3(c.balance - c.delta) : null, diff: c ? c.delta : null,
      daysSinceCount: st.daysSinceCount, needsReview: !!i.needs_review,
    };
  });
}

/** Chi phí nhập kho trong khoảng (chỉ phiếu có thành tiền). Không cộng vào thu chi — Tài chính đọc từ bảng giao dịch. */
export function purchaseCost(db, from, to) {
  return db.inventory_movements.filter((m) => !m.deleted && m.type === 'purchase' && (!from || m.date >= from) && (!to || m.date <= to))
    .reduce((a, m) => a + (invCost(db, m)?.total_cost || 0), 0);
}
