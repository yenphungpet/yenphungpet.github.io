// Danh sách bảng V2 — dùng chung cho adapter demo (IndexedDB) và Supabase.
export const TABLES = [
  'cages', 'pairs', 'clutches', 'daily_logs', 'rest_periods', 'mate_changes',
  'birds', 'flight_pens', 'stock_movements',
  'health_cases', 'health_followups',
  'customers', 'orders', 'payments', 'transactions',
  'inventory_items', 'inventory_movements', 'inventory_costs', 'cage_notes',
  'photos', 'checklist', 'audit_log', 'settings', 'listings',
  // V2.1 (0012): nhóm trứng / chim non — chỉ đọc trực tiếp; ghi qua RPC v2.brood_*. Server chưa có bảng ⇒ tải về rỗng.
  'brood_groups', 'brood_events',
  // V2.2 (0013): kiểm tra trong ngày + soi trứng, ngày tham chiếu — chỉ đọc trực tiếp; ghi qua RPC.
  'cage_checks', 'brood_refs',
  // V2.2.3 (0016): lịch sử từng chim giống (tuyển, chuyển lồng giống, ghép cặp, trả về lồng phóng). Server chưa có bảng ⇒ tải về rỗng.
  'bird_events',
];

// Bảng quan trọng cần ghi audit trail khi sửa/xoá
export const AUDITED = new Set(['flight_pens', 'cage_notes', 'daily_logs', 'clutches', 'rest_periods', 'pairs', 'birds', 'stock_movements', 'orders', 'payments', 'transactions', 'health_cases', 'inventory_items', 'inventory_movements', 'inventory_costs', 'cage_notes']);

export function emptyDb() {
  const db = {};
  for (const t of TABLES) db[t] = [];
  return db;
}
