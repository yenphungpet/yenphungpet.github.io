// Ngày nghiệp vụ luôn là chuỗi 'YYYY-MM-DD' theo giờ Việt Nam (Asia/Ho_Chi_Minh).
// Không dùng new Date().toISOString() để lấy "hôm nay" vì sẽ lệch 1 ngày từ 0h–7h sáng.

const TZ = 'Asia/Ho_Chi_Minh';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Hôm nay theo giờ Việt Nam. `now` cho phép tiêm thời điểm khi test. */
export function todayVN(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Số ngày từ a đến b (b - a). Trả về null nếu thiếu/không hợp lệ. */
export function daysBetween(a, b) {
  if (!isISODate(a) || !isISODate(b)) return null;
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function addDays(s, n) {
  const dt = new Date(toUTC(s) + n * 86400000);
  return dt.toISOString().slice(0, 10);
}

export function fmtDate(s) {
  if (!isISODate(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateShort(s) {
  if (!isISODate(s)) return '—';
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
}

export function monthKey(s) { return isISODate(s) ? s.slice(0, 7) : null; }
export function yearKey(s) { return isISODate(s) ? s.slice(0, 4) : null; }

export function inRange(s, from, to) {
  if (!isISODate(s)) return false;
  if (from && s < from) return false;
  if (to && s > to) return false;
  return true;
}

export function nowISO() { return new Date().toISOString(); }

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function relativeDays(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return 'hôm nay';
  if (n === 1) return 'hôm qua';
  if (n < 0) return `${-n} ngày nữa`;
  return `${n} ngày trước`;
}
