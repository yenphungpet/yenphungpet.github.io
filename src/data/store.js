// Store trung tâm: giữ dữ liệu trong bộ nhớ, ghi qua adapter (demo/Supabase), ghi audit, phát sự kiện thay đổi.
// Nguyên tắc: GHI THÀNH CÔNG XUỐNG ADAPTER RỒI MỚI cập nhật giao diện — không báo thành công giả.

import { emptyDb, AUDITED } from './schema.js';
import { DEFAULT_SETTINGS } from '../domain/breeding.js';
import { todayVN } from '../core/dates.js';
import { uid } from '../core/ids.js';

const BROOD_SET = ['brood_groups', 'brood_events', 'daily_logs', 'stock_movements', 'cage_checks', 'brood_refs', 'clutches'];
const RELATED = { brood_groups: BROOD_SET, brood_events: BROOD_SET, cage_checks: BROOD_SET, brood_refs: BROOD_SET, clutches: [...BROOD_SET, 'rest_periods'], daily_logs: [...BROOD_SET, 'cage_notes'], cage_notes: ['cage_notes', 'daily_logs'], stock_movements: BROOD_SET, birds: ['birds', 'pairs', 'bird_events', 'stock_movements'], pairs: ['birds', 'pairs', 'bird_events'], bird_events: ['birds', 'pairs', 'bird_events', 'stock_movements'], flight_pens: ['flight_pens', 'birds'] };

const hhmm = (t) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

export const ROLES = { owner: 'Chủ trại', staff: 'Nhân viên', public: 'Khách' };

const PERMS = {
  owner: ['*'],
  staff: ['breeding.write', 'stock.write', 'breeders.write', 'health.write', 'checklist.write', 'inventory.use'],
  public: [],
};

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.db = emptyDb();
    this.listeners = new Set();
    this.user = null; // { id, name, role }
    this.status = { state: 'idle', message: '' };
  }

  async load() {
    this.setStatus('loading', 'Đang tải dữ liệu…');
    // Dữ liệu (có thể đã bắt đầu tải song song với đọc vai trò — adapter.profile({ prefetch })) + tên người dùng: cùng lúc
    const [db] = await Promise.all([this.adapter.takePrefetch?.() || this.adapter.loadAll(), this.loadProfiles()]);
    this.db = db;
    this.setStatus('ok', this.adapter.kind === 'demo' ? 'Dữ liệu DEMO trên máy này' : 'Đã đồng bộ');
    this.emit();
  }

  /**
   * Nhật ký thay đổi (Supabase: do trigger ghi, chỉ chủ trại đọc được — RLS). Chỉ trang "Nhật ký thay đổi" dùng
   * ⇒ tải khi mở trang đó, không tải lúc mở app (≈300 KB). Demo: audit nằm sẵn trong db.
   */
  async ensureAudit() {
    if (!this.adapter.loadAudit || !this.can('audit.read')) return;
    if (this.auditLoaded) return;
    this._auditP ||= (async () => {
      try { this.db.audit_log = await this.adapter.loadAudit(300); } catch { this.db.audit_log = []; }
      this.auditLoaded = true;
      this._auditP = null;
      this.emit();
    })();
    return this._auditP;
  }

  /**
   * Dữ liệu đang hiển thị có thể CŨ (mất mạng / mất kết nối trực tiếp / tải lại lỗi): giữ dữ liệu nhưng báo rõ
   * "bản lúc HH:MM, có thể chưa mới" + nút Tải lại — không bao giờ hiện "đã đồng bộ" khi chưa chắc chắn.
   */
  markStale(reason) {
    this.stale = { reason, since: this.lastLoad || Date.now() };
    this.setStatus('error', `${reason} — dữ liệu lúc ${hhmm(this.stale.since)}, có thể chưa mới`);
  }

  /** Đồng bộ giữa thiết bị: Realtime (nếu adapter hỗ trợ) + tải lại khi quay lại app sau ≥ 20 giây. */
  startSync() {
    if (this._syncing || this.adapter.kind === 'demo') return;
    this._syncing = true;
    this.lastLoad = Date.now();
    let everLive = false; let live = false;
    // Realtime cho biết BẢNG nào đổi ⇒ chỉ tải lại các bảng đó. Mở lại app / có mạng lại: có thể đã lỡ sự kiện ⇒ tải lại tất cả.
    let changed = new Set(); let full = false;
    const flush = async () => {
      if (this.status.state === 'saving') { this._reloadT = setTimeout(flush, 700); return; }
      const tables = full || this.stale || !this.adapter.loadTables ? null : [...changed]; // dữ liệu đang cũ ⇒ tải lại TOÀN BỘ
      changed = new Set(); full = false;
      try { await this.reload(tables); } catch (e) { this.markStale(navigator.onLine === false ? 'Mất mạng' : `Không tải được dữ liệu mới (${e.message})`); }
    };
    const schedule = (table) => {
      // Một thao tác ghi nhiều bảng trong 1 giao dịch; Realtime đôi khi chỉ báo MỘT phần ⇒ tải lại cả nhóm bảng liên quan cùng lúc
      if (table) for (const t of RELATED[table] || [table]) changed.add(t); else full = true;
      clearTimeout(this._reloadT);
      this._reloadT = setTimeout(flush, 700);
    };
    this._unsub = this.adapter.subscribe?.((table) => schedule(table), (st) => {
      this.realtime = st;
      if (st === 'SUBSCRIBED') {
        // Kết nối LẠI sau khi rớt (hoặc đang có dữ liệu cũ): có thể đã lỡ thay đổi ⇒ tải lại toàn bộ rồi mới báo "đã đồng bộ"
        const reconnect = everLive && !live;
        everLive = true; live = true;
        if (reconnect || this.stale) schedule();
        else this.setStatus('ok', `Đồng bộ trực tiếp · ${hhmm(this.lastLoad)}`);
      }
      if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(st) && (live || !everLive)) { live = false; this.markStale('Mất kết nối trực tiếp'); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - this.lastLoad > 20000) schedule();
      else this.probeFreshness().catch(() => {}); // vừa mở lại màn hình: kiểm tra độ mới ngay (Realtime có thể đã lỡ)
    });
    window.addEventListener('online', () => schedule());
    window.addEventListener('offline', () => this.markStale('Mất mạng'));
    this._schedule = schedule;
    // Kiểm tra mỗi 30 giây: mất mạng ⇒ báo; dữ liệu cũ / không có kết nối trực tiếp ⇒ tự tải lại (thay cho Realtime);
    // đang "trực tiếp" ⇒ mỗi 30 giây hỏi máy chủ lần sửa mới nhất (Realtime có thể lỡ sự kiện mà không báo lỗi)
    this._watch = setInterval(() => {
      if (this.status.state === 'saving' || this.status.state === 'loading') return;
      if (navigator.onLine === false) { if (!this.stale) this.markStale('Mất mạng'); return; }
      if (this.stale || (everLive && this.realtime !== 'SUBSCRIBED')) schedule();
      else if (document.visibilityState === 'visible') this.probeFreshness().catch(() => {});
    }, 30000);
  }

  /** So thời điểm sửa mới nhất trên máy chủ với dữ liệu đang có; bảng nào mới hơn ⇒ tải lại bảng đó. Trả về danh sách bảng đã lỡ. */
  async probeFreshness(tables = ['daily_logs', 'brood_events', 'brood_groups', 'cage_checks', 'cage_notes', 'clutches', 'stock_movements', 'flight_pens', 'birds', 'bird_events', 'pairs', 'cages', 'rest_periods']) {
    if (!this.adapter.latestStamps) return [];
    const have = tables.filter((t) => Array.isArray(this.db[t]));
    const server = await this.adapter.latestStamps(have);
    const newest = (t) => Math.max(0, ...this.db[t].map((r) => Date.parse(r.updated_at || r.created_at || 0) || 0));
    const missed = have.filter((t) => server[t] && Date.parse(server[t]) > newest(t));
    for (const t of missed) this._schedule?.(t);
    if (missed.length && !this._schedule) await this.reload(missed);
    this.lastProbe = Date.now();
    return missed;
  }

  stopSync() { clearInterval(this._watch); clearTimeout(this._reloadT); this._unsub?.(); this._syncing = false; }

  /** Nút "Tải lại" (người dùng bấm): tải toàn bộ, báo rõ kết quả. */
  async resync() {
    this.setStatus('loading', 'Đang tải dữ liệu mới…');
    try { await this.reload(); return true; } catch (e) { this.markStale(navigator.onLine === false ? 'Mất mạng' : `Không tải được dữ liệu mới (${e.message})`); return false; }
  }

  /** tables: chỉ tải lại các bảng này (Realtime báo đổi); bỏ trống = tải lại tất cả. */
  async reload(tables = null) {
    // Chống race: nếu có thao tác ghi xảy ra trong lúc đang tải, kết quả tải đã cũ => bỏ, tải lại lần nữa
    const seq = this.writeSeq || 0;
    const audit = this.auditLoaded && (!tables || tables.includes('audit_log'));
    const [part, auditRows] = await Promise.all([
      tables ? this.adapter.loadTables(tables) : this.adapter.loadAll(),
      audit ? this.adapter.loadAudit(300).catch(() => []) : null,
      !tables || tables.includes('profiles') ? this.loadProfiles() : null,
    ]);
    if ((this.writeSeq || 0) !== seq || this.status.state === 'saving') {
      clearTimeout(this._staleT);
      this._staleT = setTimeout(() => this.reload(tables).catch(() => {}), 400);
      return;
    }
    const db = tables ? { ...this.db, ...part } : part;
    db.audit_log = audit ? auditRows : (this.db.audit_log || []);
    this.db = db;
    this.lastLoad = Date.now();
    this.stale = null;
    // Tải được nhưng KHÔNG có kết nối trực tiếp ⇒ không gọi là "đồng bộ trực tiếp" (tự tải lại mỗi 30 giây)
    if (!this.adapter.subscribe || this.realtime === 'SUBSCRIBED') this.setStatus('ok', `Đồng bộ trực tiếp · ${hhmm(this.lastLoad)}`);
    else this.setStatus('warn', `Đã tải lúc ${hhmm(this.lastLoad)} · chưa có kết nối trực tiếp`);
    this.emit();
  }

  /** Tên hiển thị của người dùng (người viết ghi chú…). Supabase: v2.profiles (thành viên đọc được từ 0011). */
  async loadProfiles() {
    try { this.profiles = (await this.adapter.loadProfiles?.()) || {}; } catch { this.profiles = this.profiles || {}; }
  }

  userName(id) {
    if (!id) return '';
    const p = this.profiles?.[id];
    if (p) return p;
    if (id === this.user?.id) return this.user.name || '';
    const demo = /^demo-(owner|staff|public)$/.exec(id);
    return demo ? `Demo ${ROLES[demo[1]]}` : '';
  }

  setStatus(state, message) { this.status = { state, message, stale: !!this.stale }; this.emitStatus?.(this.status); }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.db); }

  get role() { return this.user?.role || 'public'; }
  can(perm) {
    const p = PERMS[this.role] || [];
    return p.includes('*') || p.includes(perm);
  }

  get settings() {
    const row = this.db.settings.find((s) => s.id === 'app');
    return { ...DEFAULT_SETTINGS, ...(row?.value || {}) };
  }

  /** V2.2.3 Lồng Chim Giống: cần database đã có 0016 (máy chủ cũ bỏ qua cột lạ khi ghi ⇒ phải chặn trước). Demo luôn bật. */
  get breederArea() {
    if (this.adapter.kind === 'demo') return true;
    const m = String(this.db.settings.find((s) => s.id === 'deploy')?.value?.migrations || '').match(/(\d{4})$/);
    return !!m && Number(m[1]) >= 16;
  }

  today() { return todayVN(); }
  ctx() {
    return { today: this.today(), now: new Date().toISOString(), actor: this.user?.id || 'anonymous', settings: this.settings };
  }

  /** V2.1 GROUP bật khi cấu hình có features.groups (chỉ trang thử nghiệm) và máy chủ hỗ trợ RPC. */
  get groupsEnabled() { return !!this.features?.groups && typeof this.adapter.rpc === 'function'; }

  /** V2.2 thẻ lồng thông minh: cần database đã có 0013. Tắt cờ ⇒ giao diện V2.1 như cũ. */
  get smartCards() { return this.groupsEnabled && !!this.features?.smartCards; }

  /**
   * Thao tác trứng / chim non theo nhóm: máy chủ kiểm tra quyền, số lượng, ngưỡng, chống trùng và ghi NGUYÊN TỬ;
   * xong tải lại các bảng liên quan (không tự sửa dữ liệu ở máy khách). Trả { ok, errors, result, overLimit }.
   */
  async brood(fn, p) {
    if (!this.groupsEnabled) return { ok: false, errors: ['Chức năng nhóm trứng / chim non chưa bật ở bản này'] };
    if (!this.can('breeding.write')) return { ok: false, errors: ['Bạn không có quyền thực hiện thao tác này'] };
    this.setStatus('saving', 'Đang lưu…');
    this.writeSeq = (this.writeSeq || 0) + 1;
    let result;
    try {
      result = await this.adapter.rpc(fn, p);
    } catch (e) {
      const msg = String(e.message || e);
      this.setStatus('error', 'Lưu thất bại');
      return { ok: false, overLimit: /VUOT_NGUONG/.test(msg), errors: [msg.replace(/^VUOT_NGUONG:\s*/, 'Vượt ngưỡng: ')] };
    }
    this.writeSeq += 1;
    this.setStatus('ok', result?.duplicate ? 'Đã lưu trước đó (không ghi trùng)' : 'Đã lưu');
    try { await this.reload(BROOD_SET); } catch { /* Realtime / lần mở lại sẽ tải */ }
    return { ok: true, errors: [], result };
  }

  /** Xoá vĩnh viễn lồng phóng chưa có dữ liệu: máy chủ kiểm tra lại. Demo xoá trực tiếp. */
  async deletePen(id) {
    if (!this.can('settings.write')) return { ok: false, errors: ['Chỉ chủ trại được xoá lồng phóng'] };
    if (!this.adapter.rpc) return this.run({ ops: [{ table: 'flight_pens', op: 'delete', record: { id }, before: this.byId('flight_pens', id) }] });
    try { await this.adapter.rpc('flight_pen_delete', { pen_id: id }); } catch (e) { return { ok: false, errors: [String(e.message || e)] }; }
    await this.reload(['flight_pens']);
    return { ok: true, errors: [] };
  }

  /** Lịch sử sửa của một bản ghi: chỉ vai trò đọc được audit. */
  async recordAudit(table, id) {
    if (!this.can('audit.read')) return [];
    if (this.adapter.loadRecordAudit) return this.adapter.loadRecordAudit(table, id);
    return (this.db.audit_log || []).filter((a) => a.table_name === table && a.record_id === id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  /** Thực thi kết quả lập kế hoạch {errors, warnings, ops}. Ném lỗi nếu ghi thất bại. */
  async run(plan, { requires } = {}) {
    if (requires && !this.can(requires)) return { ok: false, errors: ['Bạn không có quyền thực hiện thao tác này'], warnings: [] };
    if (plan.errors?.length) return { ok: false, errors: plan.errors, warnings: plan.warnings || [] };
    const ops = plan.ops || [];
    if (!ops.length) return { ok: true, errors: [], warnings: plan.warnings || [], noop: true };
    const all = ops.map(({ table, op, record }) => ({ table, op, record }));
    if (!this.adapter.serverAudit) all.push(...this.auditOps(ops));
    this.setStatus('saving', 'Đang lưu…');
    this.writeSeq = (this.writeSeq || 0) + 1; // đánh dấu: mọi lần tải lại đang chạy dở đều đã cũ
    try {
      await this.adapter.commit(all);
    } catch (e) {
      const msg = String(e.message || e);
      // Xung đột: thiết bị khác đã sửa trước => tải dữ liệu mới nhất, không ghi đè
      if (/đã được thiết bị\/người khác sửa/.test(msg)) {
        try { await this.reload(); } catch { /* giữ nguyên */ }
        this.setStatus('error', 'Dữ liệu vừa được sửa ở thiết bị khác');
        return { ok: false, conflict: true, errors: ['Bản ghi vừa được sửa ở thiết bị/người khác. Đã tải dữ liệu mới nhất — hãy đóng và mở lại biểu mẫu rồi sửa tiếp (dữ liệu của bạn chưa được lưu).'], warnings: [] };
      }
      this.setStatus('error', 'Lưu thất bại');
      return { ok: false, errors: [`Lưu thất bại: ${msg}`], warnings: [] };
    }
    this.writeSeq += 1; // tải lại nào bắt đầu TRONG lúc đang lưu cũng có thể đọc trạng thái trước khi ghi xong => bỏ
    for (const o of all) {
      const list = this.db[o.table];
      const i = list.findIndex((r) => r.id === o.record.id);
      if (o.op === 'delete') { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = o.record; else list.push(o.record);
    }
    this.setStatus('ok', this.adapter.kind === 'demo' ? 'Đã lưu (demo, trên máy này)' : 'Đã lưu');
    this.emit();
    // Máy chủ có thể đổi thêm số liệu khi ghi (trigger): đọc lại từ máy chủ, không phụ thuộc Realtime
    for (const o of ops) this._schedule?.(o.table);
    return { ok: true, errors: [], warnings: plan.warnings || [], record: plan.record };
  }

  auditOps(ops) {
    const at = new Date().toISOString();
    return ops.filter((o) => AUDITED.has(o.table)).map((o) => {
      const before = o.before || null;
      const action = !before ? 'insert' : (o.record.deleted && !before.deleted ? 'delete' : 'update');
      const changed = before ? Object.keys(o.record).filter((k) => !['updated_at', 'updated_by', 'version', 'history'].includes(k)
        && JSON.stringify(o.record[k]) !== JSON.stringify(before[k])) : [];
      if (before && action === 'update' && !changed.length) return null;
      return { table: 'audit_log', op: 'put', record: {
        id: uid(), at, actor: this.user?.id || 'anonymous', actor_name: this.user?.name || '',
        table_name: o.table, record_id: o.record.id, action, changed, before, after: o.record,
      } };
    }).filter(Boolean);
  }

  async saveSettings(patch) {
    if (!this.can('settings.write')) return { ok: false, errors: ['Chỉ chủ trại được đổi cài đặt'] };
    const row = this.db.settings.find((s) => s.id === 'app');
    return this.run({ ops: [{ table: 'settings', op: 'put', record: { id: 'app', value: { ...(row?.value || {}), ...patch }, updated_at: new Date().toISOString() } }] });
  }

  // Tra cứu tiện dụng
  byId(table, id) { return this.db[table].find((r) => r.id === id) || null; }
  birdName(id) {
    const b = this.byId('birds', id);
    if (!b) return 'Chưa ghi nhận';
    return b.ring_code + (b.phenotype || b.mutation ? ` · ${b.phenotype || b.mutation}` : '');
  }
}
