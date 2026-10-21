// Menu "Thêm" theo rà soát V1 ↔ V2 (docs/V1_V2_REVIEW.md mục 3): chức năng trùng hoặc trại chưa dùng được gom vào
// "Chức năng ít dùng" — chỉ đổi chỗ lối vào, KHÔNG xoá dữ liệu / mã; đường dẫn vẫn mở được. Có dữ liệu ⇒ tự hiện lại ở menu chính.
const hasLive = (rows) => (rows || []).some((r) => !r.deleted);

/** Trả về { [route]: true } cho các mục được hiện ở menu chính; mục còn lại vào "Chức năng ít dùng". */
export function primaryMenuRoutes(db) {
  const selling = hasLive(db.orders) || hasLive(db.customers);
  return {
    '#/health': hasLive(db.health_cases),
    '#/sales': selling,
    '#/customers': selling,
    // Ghép cặp đã tự kiểm tra huyết thống; Chim giống vẫn có nút "Huyết thống"
    '#/kinship': false,
  };
}
