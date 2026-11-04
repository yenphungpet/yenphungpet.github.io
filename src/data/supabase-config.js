// Kiểm tra cấu hình Supabase TRƯỚC khi kết nối (dùng chung: app, tools/use-config.mjs, unit test).
// Chặn: URL Production, URL khác dự án staging đã khai báo, khoá bí mật (service_role / sb_secret_), khoá của dự án khác.
// LOCAL (Giai đoạn B, cfg.local === true): Supabase chạy bằng Docker trên CHÍNH máy này — chỉ nhận http://127.0.0.1|localhost:<cổng>,
//   không bao giờ nhận URL *.supabase.co; cấu hình thường thì ngược lại (không nhận địa chỉ local). Hai loại không lẫn được.

export const PRODUCTION_REF = 'bnumqtjzbyrtavsdlleq';
export const STAGING_REF = 'cynpwmjkflhlrdqxoyhx';
// Lưu ý tên gọi lịch sử: PRODUCTION_REF = V1 cũ; STAGING_REF = dự án đang chạy V2 PRODUCTION từ GO 21/10/2026.
export const LOCAL_REF = 'local';

function b64urlDecode(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(t)));
  return Buffer.from(t, 'base64').toString('utf8');
}

export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(String(url || '').trim());
  return m ? m[1] : null;
}

/** Demo LAN (cfg.lan === true): cổng demo trên IP NỘI BỘ (10.x, 172.16–31.x, 192.168.x) — không bao giờ IP công cộng. */
export function lanPortFromUrl(url) {
  const m = /^http:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{2,5})\/?$/.exec(String(url || '').trim());
  if (!m) return null;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const priv = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  return priv && m.slice(1, 5).every((x) => Number(x) <= 255) ? Number(m[5]) : null;
}

export function localPortFromUrl(url) {
  const m = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\/?$/.exec(String(url || '').trim());
  return m ? Number(m[1]) : null;
}

/** Trả về { errors, warnings, ref, keyKind } */
export function checkSupabaseConfig(cfg) {
  const errors = []; const warnings = [];
  const local = cfg?.local === true;
  const ref = local ? ((localPortFromUrl(cfg?.url) || (cfg?.lan === true && lanPortFromUrl(cfg?.url))) ? LOCAL_REF : null) : refFromUrl(cfg?.url);
  if (!ref) errors.push(local ? 'Cấu hình LOCAL chỉ được trỏ tới http://127.0.0.1:<cổng>, http://localhost:<cổng> (hoặc IP nội bộ khi bật demo LAN)' : 'URL phải có dạng https://<mã-dự-án>.supabase.co');
  if (ref === PRODUCTION_REF || String(cfg?.url || '').includes(PRODUCTION_REF)) errors.push('URL trỏ vào dự án PRODUCTION — từ chối');
  if (local && String(cfg?.url || '').includes(STAGING_REF)) errors.push('Cấu hình LOCAL trỏ vào dự án V2 PRODUCTION — từ chối');
  const expected = local ? LOCAL_REF : (cfg?.expectedRef || STAGING_REF);
  if (local && cfg?.expectedRef && cfg.expectedRef !== LOCAL_REF) errors.push('Cấu hình LOCAL không được khai báo mã dự án cloud');
  if (ref && ref !== expected) errors.push(`URL thuộc dự án ${ref}, không phải dự án staging đã khai báo (${expected})`);
  const key = String(cfg?.anonKey || '').trim();
  let keyKind = null;
  if (!key) errors.push('Thiếu khoá công khai (anon / publishable)');
  else if (/^sb_secret_/i.test(key)) errors.push('Đây là SECRET key — tuyệt đối không dùng ở trình duyệt. Hãy dùng khoá "anon" hoặc "publishable".');
  else if (/^sb_publishable_/i.test(key)) { keyKind = 'publishable'; warnings.push('Khoá publishable mới — nếu đăng nhập/lưu lỗi, dùng khoá "anon" (Legacy API keys).'); }
  else if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    let payload = null;
    try { payload = JSON.parse(b64urlDecode(key.split('.')[1])); } catch { errors.push('Khoá JWT không đọc được'); }
    if (payload) {
      keyKind = 'anon-jwt';
      if (payload.role !== 'anon') errors.push(`Khoá có quyền "${payload.role}" — chỉ chấp nhận khoá "anon". KHÔNG dùng service_role.`);
      if (local && payload.ref) errors.push(`Khoá thuộc dự án cloud ${payload.ref} — cấu hình LOCAL chỉ nhận khoá của Supabase trên máy này`);
      if (!local && payload.ref && ref && payload.ref !== ref) errors.push(`Khoá thuộc dự án ${payload.ref}, không khớp URL ${ref}`);
      if (payload.ref === PRODUCTION_REF) errors.push('Khoá thuộc dự án PRODUCTION — từ chối');
    }
  } else errors.push('Định dạng khoá không nhận ra (cần khoá anon "eyJ..." hoặc "sb_publishable_...")');
  return { errors, warnings, ref, keyKind };
}
