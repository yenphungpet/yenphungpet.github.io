// Store trung tâm: giữ dữ liệu trong bộ nhớ, ghi qua adapter (demo/Supabase), ghi audit, phát sự kiện thay đổi.
// Nguyên tắc: GHI THÀNH CÔNG XUỐNG ADAPTER RỒI MỚI cập nhật giao diện — không báo thành công giả.

import { emptyDb, AUDITED } from './schema.js';
import { DEFAULT_SETTINGS } from '../domain/breeding.js';
import { todayVN } from '../core/dates.js';
import { uid } from '../core/ids.js';

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

  /** Đồng bộ giữa thiết bị: Realtime (nếu adapter hỗ trợ) + tải lại khi quay lại app sau ≥ 20 giây. */
  startSync() {
    if (this._syncing || this.adapter.kind === 'demo') return;
    this._syncing = true;
    this.lastLoad = Date.now();
    // Realtime cho biết BẢNG nào đổi ⇒ chỉ tải lại các bảng đó. Mở lại app / có mạng lại: có thể đã lỡ sự kiện ⇒ tải lại tất cả.
    let changed = new Set(); let full = false;
    const flush = async () => {
      if (this.status.state === 'saving') { this._reloadT = setTimeout(flush, 700); return; }
      const tables = full || !this.adapter.loadTables ? null : [...changed];
      changed = new Set(); full = false;
      try { await this.reload(tables); } catch (e) { this.setStatus('error', `Mất đồng bộ: ${e.message}`); }
    };
    const schedule = (table) => {
      if (table) changed.add(table); else full = true;
      clearTimeout(this._reloadT);
      this._reloadT = setTimeout(flush, 700);
    };
    this._unsub = this.adapter.subscribe?.((table) => schedule(table), (st) => {
      this.realtime = st;
      if (st === 'SUBSCRIBED') this.setStatus('ok', 'Đồng bộ trực tiếp');
      if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') this.setStatus('error', 'Mất kết nối trực tiếp — sẽ tải lại khi mở lại app');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastLoad > 20000) schedule();
    });
    window.addEventListener('online', () => schedule());
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
    this.setStatus('ok', `Đã đồng bộ ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
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

  setStatus(state, message) { this.status = { state, message }; this.emitStatus?.(this.status); }

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

  today() { return todayVN(); }
  ctx() {
    return { today: this.today(), now: new Date().toISOString(), actor: this.user?.id || 'anonymous', settings: this.settings };
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
