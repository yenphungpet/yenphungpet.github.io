// Giao diện ghi chú lồng (B19): khối ghi chú trên thẻ lồng / đầu Chi tiết lồng, danh sách trong Lịch sử, sửa / xoá / đã xử lý.
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { badge, openSheet, field, showMessages, formValues, busy, toast, confirmDialog } from '../ui/components.js';
import { fmtDate, fmtDateTime } from '../core/dates.js';
import { isOpenAction, canEditNote, planEditNote, planResolveNote, notesOfCage, NOTE_MAX } from '../domain/notes.js';
import { openEditHistory } from './edit-history.js';

// Ghi chú nhập từ V1 giữ created_at gốc của V1, updated_at = lúc nhập ⇒ so với lúc nhập (settings v1_import) thay vì created_at
const edited = (store, n) => {
  if (!n.updated_at || !n.created_at || n.resolved_at) return false;
  const since = n.legacy_log_note ? Date.parse(store.db.settings.find((s) => s.id === 'v1_import')?.value?.converted_at || n.created_at) + 15 * 60e3 : Date.parse(n.created_at);
  return Date.parse(n.updated_at) - since > 5000;
};

/** Dòng tiêu đề: ngày · người viết · trạng thái "Cần xử lý" / "Đã xử lý". card: thẻ lồng, có giờ + nút cây bút, không hiện trạng thái xử lý. */
function head(store, n, { card = false, plain = false } = {}) {
  const who = store.userName(n.created_by);
  const stamp = n.created_at && !n.legacy_log_note ? fmtDateTime(n.created_at) : '';
  return html`<div class="note-head">${icon('note')}<span class="date">${card && stamp.includes(fmtDate(n.note_date)) ? stamp : fmtDate(n.note_date)}</span>${who ? html`<span class="who">· ${who}</span>` : ''}
    ${edited(store, n) ? html`<span class="who">· đã sửa</span>` : ''}
    ${plain ? '' : isOpenAction(n) ? badge('Cần xử lý', 'danger') : n.needs_action && n.resolved_at ? badge(`Đã xử lý${store.userName(n.resolved_by) ? ` · ${store.userName(n.resolved_by)}` : ''}`, 'ok') : ''}
    ${card && canEditNote(n, store.user) ? html`<button type="button" class="note-pen" data-note-edit="${n.id}" aria-label="Sửa ghi chú">${icon('edit')}</button>` : ''}</div>`;
}

/** Nút theo quyền: Đã xử lý (mọi thành viên ghi được nhật ký), Sửa / Xoá (chủ trại hoặc người viết). */
export function noteActions(store, n) {
  const canResolve = isOpenAction(n) && !n.synthetic && store.can('breeding.write');
  const canEdit = canEditNote(n, store.user);
  const canHistory = !n.synthetic && edited(store, n) && store.can('audit.read');
  if (!canResolve && !canEdit && !canHistory) return '';
  return html`<div class="note-actions">
    ${canResolve ? html`<button type="button" class="btn soft sm" data-note-resolve="${n.id}">${icon('check')} Đã xử lý</button>` : ''}
    ${canEdit ? html`<button type="button" class="btn ghost sm" data-note-edit="${n.id}">${icon('edit')} Sửa</button>` : ''}
    ${canHistory ? html`<button type="button" class="btn ghost sm" data-audit="cage_notes" data-id="${n.id}">${icon('history')} Lịch sử sửa</button>` : ''}</div>`;
}

/**
 * Khối ghi chú mới nhất (thẻ lồng: tối đa 3 dòng + Xem thêm). Không có ghi chú => "Chưa có ghi chú" (không tự tạo nội dung).
 * openCount: số ghi chú "Cần xử lý" đang mở của lồng (nhắc khi việc cần xử lý không phải ghi chú mới nhất).
 * plain: thẻ lồng không hiện trạng thái "Cần xử lý" (dữ liệu giữ nguyên, xử lý ở Chi tiết lồng / Tổng quan).
 * card: thẻ thu gọn V2.2: chưa có ghi chú thì không chiếm chỗ, có giờ và nút cây bút.
 */
export function noteBlock(store, n, { openCount = 0, actions = false, plain = false, card = false } = {}) {
  if (!n) return card ? '' : html`<div class="cc-note empty" data-note><p>Chưa có ghi chú</p></div>`;
  if (card) plain = true;
  const others = plain ? 0 : openCount - (isOpenAction(n) ? 1 : 0);
  const long = n.text.length > 110 || n.text.split('\n').length > 3;
  return html`<div class="cc-note ${!plain && isOpenAction(n) ? 'action' : ''}" data-note>
    ${head(store, n, { card, plain })}
    <p>${n.text}</p>${long ? html`<button type="button" class="link" data-expand>Xem thêm</button>` : ''}
    ${others > 0 ? html`<div class="note-more">${badge(`+ ${others} việc cần xử lý khác`, 'warn')}</div>` : ''}
    ${actions ? noteActions(store, n) : ''}</div>`;
}

/** Danh sách ghi chú (Lịch sử theo ngày, việc cần xử lý ở Chi tiết lồng). */
export function noteList(store, notes) {
  return notes.length ? html`<div class="note-list">${notes.map((n) => html`<div class="note-item ${isOpenAction(n) ? 'action' : ''}" data-note-id="${n.id}">
    ${head(store, n)}<p>${n.text}</p>${n.resolve_note ? html`<p class="small muted">Xử lý: ${n.resolve_note}</p>` : ''}${noteActions(store, n)}</div>`)}</div>` : '';
}

/** Gắn sự kiện cho các nút ghi chú bên trong root (dùng 1 lần cho mỗi màn hình; "Xem thêm" do bindCageCards xử lý). */
export function bindNoteActions(root, app) {
  root.addEventListener('click', async (e) => {
    const res = e.target.closest('[data-note-resolve]');
    if (res) { e.stopPropagation(); await resolveNote(app, res.dataset.noteResolve); return; }
    const ed = e.target.closest('[data-note-edit]');
    if (ed) { e.stopPropagation(); openNoteEdit(app, ed.dataset.noteEdit); return; }
    const au = e.target.closest('[data-audit]');
    if (au) { e.stopPropagation(); openEditHistory(app, au.dataset.audit, au.dataset.id); }
  });
}

async function resolveNote(app, id) {
  const store = app.store;
  const r = await store.run(planResolveNote(store.db, id, store.ctx()), { requires: 'breeding.write' });
  if (r.ok) toast('Đã xác nhận xử lý — việc này rời khỏi "Việc cần làm hôm nay"');
  else toast(r.errors.join('; '), 'error');
}

/** Sửa / xoá ghi chú (chủ trại hoặc người viết). */
export function openNoteEdit(app, id) {
  const store = app.store;
  const n = (store.db.cage_notes || []).find((x) => x.id === id && !x.deleted)
    || store.db.cages.flatMap((c) => notesOfCage(store.db, c.id)).find((x) => x.id === id);
  if (!n) { toast('Không tìm thấy ghi chú', 'error'); return; }
  if (!canEditNote(n, store.user)) { toast('Chỉ người viết hoặc chủ trại được sửa ghi chú này', 'error'); return; }
  const openedAt = n.synthetic ? undefined : (n.updated_at || null);
  openSheet({
    title: 'Sửa ghi chú', subtitle: `${store.byId('cages', n.cage_id)?.code || ''} · ${fmtDate(n.note_date)} · tạo ${fmtDateTime(n.created_at)}`,
    body: html`<form class="form" data-note-form novalidate>
      ${field('Nội dung', html`<textarea name="text" rows="5" maxlength="${NOTE_MAX}" enterkeyhint="done">${n.text}</textarea>`)}
      <p class="small muted">Lần sửa được lưu vết trong nhật ký thay đổi. Ghi chú các ngày khác không bị ảnh hưởng.</p>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-del>${icon('trash')}</button><button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('[data-note-form]');
      const msg = form.querySelector('[data-msg]');
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(form);
        const r = await store.run(planEditNote(store.db, id, { text: v.text, expectedUpdatedAt: openedAt }, store.ctx(), store.user), { requires: 'breeding.write' });
        if (!r.ok) { showMessages(msg, r.errors); return; }
        toast('Đã lưu ghi chú'); close();
      }));
      el.querySelector('[data-del]').addEventListener('click', async () => {
        if (!(await confirmDialog('Xoá ghi chú này? Ghi chú được xoá mềm và lưu vết trong nhật ký thay đổi.', { danger: true, ok: 'Xoá' }))) return;
        const r = await store.run(planEditNote(store.db, id, { delete: true, expectedUpdatedAt: openedAt }, store.ctx(), store.user), { requires: 'breeding.write' });
        if (!r.ok) { showMessages(msg, r.errors); return; }
        toast('Đã xoá ghi chú'); close();
      });
    },
  });
}
