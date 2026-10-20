// Danh sách bảng V2 — dùng chung cho adapter demo (IndexedDB) và Supabase.
export const TABLES = [
  'cages', 'pairs', 'clutches', 'daily_logs', 'rest_periods', 'mate_changes',
  'birds', 'flight_pens', 'stock_movements',
  'health_cases', 'health_followups',
  'customers', 'orders', 'payments', 'transactions',
  'inventory_items', 'inventory_movements', 'inventory_costs', 'cage_notes',
  'photos', 'checklist', 'audit_log', 'settings', 'listings',
];

// Bảng quan trọng cần ghi audit trail khi sửa/xoá
export const AUDITED = new Set(['daily_logs', 'clutches', 'rest_periods', 'pairs', 'birds', 'stock_movements', 'orders', 'payments', 'transactions', 'health_cases', 'inventory_items', 'inventory_movements', 'inventory_costs', 'cage_notes']);

export function emptyDb() {
  const db = {};
  for (const t of TABLES) db[t] = [];
  return db;
}
