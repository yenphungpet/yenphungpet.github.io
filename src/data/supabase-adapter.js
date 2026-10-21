// Adapter SUPABASE (dành cho dự án Supabase STAGING riêng — KHÔNG trỏ vào Production).
// - Xác thực: Supabase Auth (email + mật khẩu). Quyền do RLS phía database quyết định.
// - Ghi dữ liệu: gọi RPC public.apply_ops(ops) => mọi thao tác của 1 nghiệp vụ chạy trong 1 transaction,
//   trigger phía DB kiểm tra âm tồn, ghi audit trail, gán created_by/updated_by theo auth.uid().
// - Ảnh: Supabase Storage bucket riêng tư 'farm-photos', tải lên bằng XHR để có tiến trình thật, xem bằng signed URL.
// - Chỉ dùng anon key (công khai theo thiết kế của Supabase). TUYỆT ĐỐI không dùng service_role key ở trình duyệt.
// - Đồng bộ thiết bị: Supabase Realtime (postgres_changes, tôn trọng RLS) + tải lại khi mở lại app.
// - An toàn: kiểm tra URL/khoá trước khi kết nối; sau khi đăng nhập đối chiếu dấu dự án v2.settings('deploy').
// TRẠNG THÁI: migration + RLS đã kiểm thử trên PostgreSQL 17 cục bộ (tools/sql-test.mjs);
// adapter này CHƯA kiểm thử tích hợp với Supabase thật (chờ Henry chạy STEP1–4 trên dự án staging).

import { TABLES, emptyDb } from './schema.js';
import { checkSupabaseConfig } from './supabase-config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const BUCKET = 'farm-photos';
const PAGE = 1000;

export class SupabaseAdapter {
  constructor(cfg) {
    const chk = checkSupabaseConfig(cfg);
    if (chk.errors.length) throw new Error(`Cấu hình Supabase không an toàn: ${chk.errors.join('; ')}`);
    this.cfg = cfg;
    this.ref = chk.ref;
    this.configWarnings = chk.warnings;
    this.kind = 'supabase';
    this.serverAudit = true;
    this.urlCache = new Map();
  }

  async init() {
    const { createClient } = await import(SUPABASE_JS);
    this.sb = createClient(this.cfg.url, this.cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    // Toàn bộ bảng V2 nằm trong schema riêng (không đụng bảng cũ ở "public")
    this.v2 = this.sb.schema(this.cfg.schema || 'v2');
  }

  async getSession() {
    const { data } = await this.sb.auth.getSession();
    return data.session;
  }

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
  }

  async signOut() { await this.sb.auth.signOut(); }

  /** Đổi mật khẩu qua Supabase Auth: xác thực mật khẩu hiện tại (đăng nhập lại chính tài khoản đang dùng) rồi mới đổi. */
  async changePassword(current, next) {
    const s = await this.getSession();
    if (!s?.user?.email) throw new Error('Chưa đăng nhập');
    const chk = await this.sb.auth.signInWithPassword({ email: s.user.email, password: current });
    if (chk.error) { const e = new Error(chk.error.message); e.code = chk.error.code === 'invalid_credentials' || /invalid login/i.test(chk.error.message) ? 'wrong_current' : chk.error.code; throw e; }
    if (chk.data.user?.id !== s.user.id) throw new Error('Tài khoản không khớp phiên đăng nhập');
    const { error } = await this.sb.auth.updateUser({ password: next });
    if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  }

  async profile() {
    const s = await this.getSession();
    if (!s) return null;
    const { data, error } = await this.v2.from('profiles').select('id, display_name, role').eq('id', s.user.id).maybeSingle();
    if (error) throw new Error(error.message);
    this.role = data?.role || 'public';
    return data ? { ...data, email: s.user.email } : { id: s.user.id, role: 'public', email: s.user.email };
  }

  /** Tên hiển thị { id: display_name } — chủ trại đọc tất cả; thành viên đọc được từ migration 0011. */
  async loadProfiles() {
    const { data, error } = await this.v2.from('profiles').select('id, display_name');
    if (error) return {};
    return Object.fromEntries((data || []).map((p) => [p.id, p.display_name || '']));
  }

  async loadAll() {
    const out = emptyDb();
    await Promise.all(TABLES.filter((t) => t !== 'audit_log').map(async (t) => {
      let from = 0;
      for (;;) {
        const { data, error } = await this.v2.from(t).select('*').order('id').range(from, from + PAGE - 1);
        if (error) {
          // Bảng không có quyền đọc theo vai trò => để trống (RLS phía server là nguồn sự thật)
          if (error.code === '42501' || /permission/i.test(error.message)) break;
          // Bảng mới chưa có trên server (VD inventory_costs trước migration 0009) => để trống, app vẫn chạy
          if (error.code === 'PGRST205' || error.code === '42P01') break;
          throw new Error(`Không tải được ${t}: ${error.message}`);
        }
        out[t].push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }));
    // Đối chiếu dấu dự án do STEP1 ghi: database phải đúng là dự án staging trong URL
    const mark = out.settings.find((x) => x.id === 'deploy');
    if (!['owner', 'staff'].includes(this.role)) return out; // chưa có vai trò: RLS không cho đọc settings — chỉ xem trang công khai
    if (!mark) throw new Error('Database chưa được triển khai V2 (thiếu dấu dự án). Hãy chạy STEP1_core.sql trên dự án staging, hoặc tài khoản chưa được gán vai trò (STEP4).');
    if (mark.value?.project_ref !== this.ref) throw new Error(`Dấu dự án trong database (${mark.value?.project_ref}) không khớp URL (${this.ref}) — dừng để an toàn.`);
    return out;
  }

  /** Nhận thay đổi từ thiết bị khác (Realtime). Trả về hàm huỷ. */
  subscribe(onChange, onStatus) {
    let ch = null;
    let stopped = false;
    // Realtime phải dùng token của người đăng nhập — nếu dùng anon key, RLS sẽ chặn mọi sự kiện một cách âm thầm
    this.getSession().then((s) => {
      if (stopped) return;
      if (s?.access_token) this.sb.realtime.setAuth(s.access_token);
      ch = this.sb.channel('yp-v2-sync')
        .on('postgres_changes', { event: '*', schema: 'v2' }, (p) => onChange(p.table))
        .subscribe((status) => onStatus?.(status));
    });
    this.sb.auth.onAuthStateChange((ev, s) => { if (s?.access_token && ['TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED'].includes(ev)) this.sb.realtime.setAuth(s.access_token); });
    return () => { stopped = true; if (ch) this.sb.removeChannel(ch); };
  }

  /** Chẩn đoán kết nối (Cài đặt → Công cụ kỹ thuật → Kiểm tra kết nối). Không ghi dữ liệu nghiệp vụ. */
  async diagnose({ testUpload = false, isOwner = false } = {}) {
    const res = [];
    const add = (name, ok, detail = '') => res.push({ name, ok, detail });
    add('URL & khoá hợp lệ, đúng dự án V2', true, `${this.ref}${this.configWarnings.length ? ' · ' + this.configWarnings.join(' ') : ''}`);
    const s = await this.getSession();
    add('Đã đăng nhập', !!s, s?.user?.email || 'chưa đăng nhập');
    if (!s) return res;
    try { const p = await this.profile(); add('Vai trò', ['owner', 'staff'].includes(p.role), p.role === 'public' ? 'chưa được gán vai trò (chạy STEP4)' : p.role); } catch (e) { add('Vai trò', false, e.message); }
    try {
      const { data, error } = await this.v2.from('settings').select('value').eq('id', 'deploy').maybeSingle();
      add('Dấu dự án trong database khớp URL', !error && data?.value?.project_ref === this.ref, error?.message || JSON.stringify(data?.value || null));
    } catch (e) { add('Dấu dự án trong database khớp URL', false, e.message); }
    try { const { count, error } = await this.v2.from('daily_logs').select('id', { count: 'exact', head: true }); add('Đọc dữ liệu (RLS)', !error, error?.message || `${count} nhật ký`); } catch (e) { add('Đọc dữ liệu (RLS)', false, e.message); }
    try { const { error } = await this.v2.rpc('apply_ops', { ops: [] }); add('Gọi được RPC ghi nguyên tử apply_ops', !error, error?.message || ''); } catch (e) { add('Gọi được RPC ghi nguyên tử apply_ops', false, e.message); }
    if (testUpload) {
      const key = `diagnostics/${Date.now()}.webp`;
      try {
        const blob = new Blob([new Uint8Array([82, 73, 70, 70, 26, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 13, 0, 0, 0, 47, 0, 0, 0, 16, 7, 16, 17, 17, 136, 136, 254, 7, 0])], { type: 'image/webp' });
        await this.uploadPhoto(key, blob);
        add('Tải ảnh lên Storage (bucket riêng tư)', true, key);
        const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(key, 60);
        add('Tạo link xem ảnh có hạn (signed URL)', !error && !!data?.signedUrl, error?.message || 'hết hạn sau 60 giây');
        const pub = await fetch(`${this.cfg.url}/storage/v1/object/public/${BUCKET}/${key}`);
        add('Ảnh KHÔNG xem được qua link công khai', !pub.ok, `HTTP ${pub.status}`);
        if (isOwner) { const { error: e2 } = await this.sb.storage.from(BUCKET).remove([key]); add('Dọn ảnh thử (chủ trại)', !e2, e2?.message || 'đã xoá'); }
      } catch (e) { add('Tải ảnh lên Storage', false, e.message); }
    }
    return res;
  }

  async loadAudit(limit = 200) {
    const { data, error } = await this.v2.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data;
  }

  async commit(ops) {
    if (!ops.length) return;
    const payload = ops.map((o) => ({ table: o.table, op: o.op, record: o.record }));
    const { error } = await this.v2.rpc('apply_ops', { ops: payload });
    if (error) throw new Error(error.message);
  }

  async uploadPhoto(key, blob, onProgress) {
    const s = await this.getSession();
    if (!s) throw new Error('Chưa đăng nhập');
    const url = `${this.cfg.url}/storage/v1/object/${BUCKET}/${encodeURI(key)}`;
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${s.access_token}`);
      xhr.setRequestHeader('apikey', this.cfg.anonKey);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      xhr.setRequestHeader('Cache-Control', 'max-age=31536000');
      xhr.timeout = 120000;
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Tải ảnh thất bại (${xhr.status}): ${xhr.responseText.slice(0, 120)}`)));
      xhr.onerror = () => reject(new Error('Lỗi mạng khi tải ảnh'));
      xhr.ontimeout = () => reject(new Error('Hết thời gian chờ khi tải ảnh'));
      xhr.send(blob);
    });
    return { key };
  }

  async photoUrl(key) {
    const c = this.urlCache.get(key);
    if (c && c.exp > Date.now()) return c.url;
    const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(key, 3600);
    if (error) return null;
    this.urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 3300 * 1000 });
    return data.signedUrl;
  }
}
