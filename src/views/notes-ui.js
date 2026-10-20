// Giao diện ghi chú lồng (B19): khối ghi chú trên thẻ lồng / đầu Chi tiết lồng, danh sách trong Lịch sử, sửa / xoá / đã xử lý.
import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { badge, openSheet, field, showMessages, formValues, busy, toast, confirmDialog } from '../ui/components.js';
import { fmtDate, fmtDateTime } from '../core/dates.js';
import { isOpenAction, canEditNote, planEditNote, planResolveNote, notesOfCage, NOTE_MAX } from '../domain/notes.js';

const edited = (n) => n.updated_at && n.created_at && Date.parse(n.updated_at) - Date.parse(n.created_at) > 5000 && !n.resolved_at;

/** Dòng tiêu đề: ngày · người viết · trạng thái "Cần xử lý" / "Đã xử lý". */
function head(store, n) {
  const who = store.userName(n.created_by);
  return html`<div class="note-head">${icon('note')}<span class="date">${fmtDate(n.note_date)}</span>${who ? html`<span class="who">· ${who}</span>` : ''}
    ${edited(n) ? html`<span class="who">· đã sửa</span>` : ''}
    ${isOpenAction(n) ? badge('Cần xử lý', 'danger') : n.needs_action && n.resolved_at ? badge(`Đã xử lý${store.userName(n.resolved_by) ? ` · ${store.userName(n.resolved_by)}` : ''}`, 'ok') : ''}</div>`;
}

/** Nút theo quyền: Đã xử lý (mọi thành viên ghi được nhật ký), Sửa / Xoá (chủ trại hoặc người viết). */
export function noteActions(store, n) {
  const canResolve = isOpenAction(n) && !n.synthetic && store.can('breeding.write');
  const canEdit = canEditNote(n, store.user);
  if (!canResolve && !canEdit) return '';
  return html`<div class="note-actions">
    ${canResolve ? html`<button type="button" class="btn soft sm" data-note-resolve="${n.id}">${icon('check')} Đã xử lý</button>` : ''}
    ${canEdit ? html`<button type="button" class="btn ghost sm" data-note-edit="${n.id}">${icon('edit')} Sửa</button>` : ''}</div>`;
}

/**
 * Khối ghi chú mới nhất (thẻ lồng: tối đa 3 dòng + Xem thêm). Không có ghi chú => "Chưa có ghi chú" (không tự tạo nội dung).
 * openCount: số ghi chú "Cần xử lý" đang mở của lồng (nhắc khi việc cần xử lý không phải ghi chú mới nhất).
 */
export function noteBlock(store, n, { openCount = 0, actions = false } = {}) {
  if (!n) return html`<div class="cc-note empty" data-note><p>Chưa có ghi chú</p></div>`;
  const others = openCount - (isOpenAction(n) ? 1 : 0);
  const long = n.text.length > 110 || n.text.split('\n').length > 3;
  return html`<div class="cc-note ${isOpenAction(n) ? 'action' : ''}" data-note>
    ${head(store, n)}
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
    if (ed) { e.stopPropagation(); openNoteEdit(app, ed.dataset.noteEdit); }
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
      <label class="check"><input type="checkbox" name="needs_action" ${n.needs_action ? 'checked' : ''}> Cần xử lý (hiện ở "Việc cần làm hôm nay")</label>
      <p class="small muted">Lần sửa được lưu vết trong nhật ký thay đổi. Ghi chú các ngày khác không bị ảnh hưởng.</p>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-del>${icon('trash')}</button><button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('[data-note-form]');
      const msg = form.querySelector('[data-msg]');
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const v = formValues(form);
        const r = await store.run(planEditNote(store.db, id, { text: v.text, needs_action: !!v.needs_action, expectedUpdatedAt: openedAt }, store.ctx(), store.user), { requires: 'breeding.write' });
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
