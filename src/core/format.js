export function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('vi-VN') + ' đ';
}

/** Dạng rút gọn cho thẻ thống kê: 1,5tr / 250k */
export function fmtMoneyShort(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' tỷ';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'tr';
  if (a >= 1e3) return sign + Math.round(a / 1e3) + 'k';
  return sign + a + 'đ';
}

export function fmtPct(ratio, digits = 0) {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) return '—';
  return (ratio * 100).toFixed(digits).replace('.', ',') + '%';
}

export function toInt(v, def = 0) {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export function toNum(v, def = 0) {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : def;
}

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu. */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function matches(query, ...fields) {
  const q = fold(query).trim();
  if (!q) return true;
  return fields.some((f) => fold(f).includes(q));
}

export function bytes(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1048576) return (n / 1048576).toFixed(2).replace('.', ',') + ' MB';
  return Math.round(n / 1024) + ' KB';
}

/** Số tiền VNĐ: bỏ mọi ký tự không phải số ("1.587.500 đ" → 1587500). Rỗng → def. */
export function toMoney(v, def = 0) {
  const digits = String(v ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : def;
}

/** Số lượng thập phân, chấp nhận dấu phẩy thập phân kiểu Việt ("1,5" → 1.5). */
export function toDecimal(v, def = NaN) {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return def;
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s);
  return Number.isFinite(n) ? n : def;
}
