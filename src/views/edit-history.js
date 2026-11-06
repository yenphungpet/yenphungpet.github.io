// Lịch sử sửa của một bản ghi (V2.2.1): ai sửa, lúc nào, giá trị cũ / mới. Lấy từ audit_log do trigger máy chủ ghi; chỉ vai trò đọc được audit.
import { html } from '../ui/html.js';
import { openSheet, empty } from '../ui/components.js';
import { fmtDateTime } from '../core/dates.js';

const LABELS = {
  log_date: 'Ngày', eggs: 'Trứng đã đẻ', fertile: 'Có cồ', infertile: 'Không cồ', damaged: 'Hỏng', hatched: 'Đã nở', chicks: 'Chim non', fledged: 'Ra ràng',
  parents_status: 'Bố mẹ', nest_status: 'Tổ', photo_ids: 'Ảnh', text: 'Nội dung', note_date: 'Ngày ghi chú', deleted: 'Đã xoá',
  needs_action: 'Cần xử lý', resolved_at: 'Xử lý lúc', name: 'Tên', purpose: 'Mục đích', archived: 'Ngừng sử dụng',
};
const show = (v) => {
  if (v === null || v === undefined || v === '') return 'trống';
  if (v === true) return 'có';
  if (v === false) return 'không';
  if (Array.isArray(v)) return `${v.length} mục`;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

function rows(list) {
  const edits = list.filter((a) => a.action !== 'insert' && a.changed?.length);
  if (!edits.length) return empty('Chưa có lần sửa nào được ghi lại.');
  return html`${edits.map((a) => html`<div class="audit-row"><b>${fmtDateTime(a.at)}</b> · ${a.actor_name || 'Không rõ'}${a.action === 'delete' ? ' · Xoá' : ''}
    <ul>${a.changed.map((k) => html`<li>${LABELS[k] || k}: ${show(a.before?.[k])} → <b>${show(a.after?.[k])}</b></li>`)}</ul></div>`)}`;
}

export function openEditHistory(app, table, id) {
  openSheet({
    title: 'Lịch sử sửa', subtitle: 'Ai sửa, lúc nào, giá trị cũ → mới',
    body: html`<div data-audit-list><p class="small muted">Đang tải…</p></div>`,
    onMount: async (el) => {
      const box = el.querySelector('[data-audit-list]');
      try { box.innerHTML = String(rows(await app.store.recordAudit(table, id))); } catch (e) { box.textContent = `Không tải được: ${e.message}`; }
    },
  });
}
