// Kiểm tra cấu hình Supabase TRƯỚC khi kết nối (dùng chung: app, tools/use-config.mjs, unit test).
// Chặn: URL Production, URL khác dự án staging đã khai báo, khoá bí mật (service_role / sb_secret_), khoá của dự án khác.

export const PRODUCTION_REF = 'bnumqtjzbyrtavsdlleq';
export const STAGING_REF = 'cynpwmjkflhlrdqxoyhx';

function b64urlDecode(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(t)));
  return Buffer.from(t, 'base64').toString('utf8');
}

export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(String(url || '').trim());
  return m ? m[1] : null;
}

/** Trả về { errors, warnings, ref, keyKind } */
export function checkSupabaseConfig(cfg) {
  const errors = []; const warnings = [];
  const ref = refFromUrl(cfg?.url);
  if (!ref) errors.push('URL phải có dạng https://<mã-dự-án>.supabase.co');
  if (ref === PRODUCTION_REF || String(cfg?.url || '').includes(PRODUCTION_REF)) errors.push('URL trỏ vào dự án PRODUCTION — từ chối');
  const expected = cfg?.expectedRef || STAGING_REF;
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
      if (payload.ref && ref && payload.ref !== ref) errors.push(`Khoá thuộc dự án ${payload.ref}, không khớp URL ${ref}`);
      if (payload.ref === PRODUCTION_REF) errors.push('Khoá thuộc dự án PRODUCTION — từ chối');
    }
  } else errors.push('Định dạng khoá không nhận ra (cần khoá anon "eyJ..." hoặc "sb_publishable_...")');
  return { errors, warnings, ref, keyKind };
}
