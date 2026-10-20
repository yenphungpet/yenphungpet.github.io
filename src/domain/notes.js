// Ghi chú lồng sinh sản (B19): mỗi lần ghi là 1 dòng mới trong cage_notes — KHÔNG ghi đè ghi chú cũ.
// Có ngày, người viết, cờ "Cần xử lý" (hiện ở Việc cần làm hôm nay tới khi có người xác nhận "Đã xử lý").
// Quyền: chủ trại sửa/xoá mọi ghi chú; người viết sửa/xoá ghi chú của mình; thành viên khác chỉ xác nhận đã xử lý.
// (Máy chủ kiểm tra lại cùng quy tắc — migration 0011, trigger ab_note_guard.)

import { uid } from '../core/ids.js';
import { isISODate } from '../core/dates.js';

export const NOTE_MAX = 2000;
const legacyId = (logId) => `log-${logId}`;
const byNewest = (a, b) => b.note_date.localeCompare(a.note_date) || String(b.created_at || '').localeCompare(String(a.created_at || ''));

/**
 * Ghi chú của 1 lồng, mới nhất trước. Gồm cage_notes và ghi chú cũ còn nằm trong nhật ký mà chưa được chép sang
 * (dữ liệu demo / dữ liệu cũ xem thử cục bộ; trên Supabase migration 0011 đã chép với id 'log-<id nhật ký>').
 */
export function notesOfCage(db, cageId) {
  const all = db.cage_notes || [];
  const have = new Set(all.map((n) => n.id));
  const own = all.filter((n) => n.cage_id === cageId && !n.deleted);
  const legacy = (db.daily_logs || []).filter((l) => l.cage_id === cageId && !l.deleted && (l.note || '').trim() && !have.has(legacyId(l.id)))
    .map((l) => ({
      id: legacyId(l.id), cage_id: cageId, log_id: l.id, clutch_id: l.clutch_id, note_date: l.log_date, text: l.note.trim(),
      needs_action: false, resolved_at: null, legacy_log_note: true, deleted: false, synthetic: true,
      created_at: l.created_at, created_by: l.created_by, updated_at: l.updated_at, updated_by: l.updated_by,
    }));
  return [...own, ...legacy].sort(byNewest);
}

export function latestCageNote(db, cageId) { return notesOfCage(db, cageId)[0] || null; }

/** Ghi chú gắn với 1 nhật ký (theo thứ tự ghi). */
export function notesOfLog(db, log) {
  return notesOfCage(db, log.cage_id).filter((n) => n.log_id === log.id).reverse();
}

export const isOpenAction = (n) => !!n.needs_action && !n.resolved_at && !n.deleted;

/** Ghi chú "Cần xử lý" chưa xong của các lồng đang dùng (cũ nhất trước). */
export function openActionNotes(db) {
  const active = new Set((db.cages || []).filter((c) => !c.archived && !c.deleted).map((c) => c.id));
  return (db.cage_notes || []).filter((n) => isOpenAction(n) && active.has(n.cage_id)).sort((a, b) => -byNewest(a, b));
}

/** Người dùng được sửa / xoá ghi chú này không (chủ trại, hoặc chính người viết). */
export function canEditNote(note, user) {
  if (!note || !user) return false;
  return user.role === 'owner' || (!!note.created_by && note.created_by === user.id);
}

const cleanText = (t) => String(t ?? '').replace(/\r\n/g, '\n').trim();

/** Ghi chú mới (dùng trong "Cập nhật hôm nay" — cùng 1 lần lưu với nhật ký). Trả về op hoặc lỗi. */
export function planNewNote(db, input, ctx) {
  const { actor, now } = ctx;
  const text = cleanText(input.text);
  const errors = [];
  if (!text) return { errors: [], ops: [], skipped: true };
  if (text.length > NOTE_MAX) errors.push(`Ghi chú tối đa ${NOTE_MAX} ký tự (đang có ${text.length})`);
  if (!db.cages.some((c) => c.id === input.cage_id)) errors.push('Không tìm thấy lồng');
  if (!isISODate(input.note_date)) errors.push('Ngày ghi chú không hợp lệ');
  if (errors.length) return { errors, ops: [] };
  const record = {
    id: uid(), cage_id: input.cage_id, log_id: input.log_id || null, clutch_id: input.clutch_id || null,
    note_date: input.note_date, text, needs_action: !!input.needs_action, resolved_at: null, resolved_by: null, resolve_note: '',
    legacy_log_note: false, deleted: false, created_at: now, created_by: actor, updated_at: now, updated_by: actor,
  };
  return { errors: [], ops: [{ table: 'cage_notes', op: 'put', record }], record };
}

function baseOf(db, noteId) {
  const n = (db.cage_notes || []).find((x) => x.id === noteId && !x.deleted);
  if (n) return { note: n, before: n };
  // Ghi chú cũ chưa chép (chỉ có ở dữ liệu demo / xem thử): sửa lần đầu thì tạo bản ghi cage_notes cùng id
  const logId = noteId.startsWith('log-') ? noteId.slice(4) : null;
  const log = logId && db.daily_logs.find((l) => l.id === logId && !l.deleted);
  if (!log) return { note: null };
  const syn = notesOfCage(db, log.cage_id).find((x) => x.id === noteId);
  if (!syn) return { note: null };
  const { synthetic: _s, ...rec } = syn;
  return { note: rec, before: null };
}

/** Sửa nội dung / cờ "Cần xử lý", hoặc xoá mềm ghi chú — chỉ chủ trại hoặc người viết. */
export function planEditNote(db, noteId, input, ctx, user) {
  const { actor, now } = ctx;
  const { note, before } = baseOf(db, noteId);
  if (!note) return { errors: ['Không tìm thấy ghi chú'], ops: [] };
  if (!canEditNote(note, user)) return { errors: ['Chỉ người viết hoặc chủ trại được sửa / xoá ghi chú này'], ops: [] };
  if (input.expectedUpdatedAt !== undefined && before && (before.updated_at || null) !== (input.expectedUpdatedAt || null)) {
    return { errors: ['Ghi chú vừa được sửa ở thiết bị khác. Hãy đóng và mở lại (thay đổi của bạn chưa được lưu).'], ops: [], conflict: true };
  }
  const record = { ...note, updated_at: now, updated_by: actor };
  if (input.delete) Object.assign(record, { deleted: true, deleted_at: now, deleted_by: actor });
  else {
    const text = cleanText(input.text);
    if (!text) return { errors: ['Nội dung ghi chú không được để trống (muốn bỏ thì bấm Xoá)'], ops: [] };
    if (text.length > NOTE_MAX) return { errors: [`Ghi chú tối đa ${NOTE_MAX} ký tự`], ops: [] };
    record.text = text;
    if (input.needs_action !== undefined) {
      record.needs_action = !!input.needs_action;
      if (!record.needs_action) Object.assign(record, { resolved_at: null, resolved_by: null });
    }
  }
  return { errors: [], ops: [{ table: 'cage_notes', op: 'put', before, record }], record };
}

/** Xác nhận đã xử lý (mọi thành viên): chỉ đổi trường "đã xử lý", không đổi nội dung. */
export function planResolveNote(db, noteId, ctx, resolveNote = '') {
  const { actor, now } = ctx;
  const n = (db.cage_notes || []).find((x) => x.id === noteId && !x.deleted);
  if (!n) return { errors: ['Không tìm thấy ghi chú'], ops: [] };
  if (!isOpenAction(n)) return { errors: ['Ghi chú này không có việc cần xử lý đang mở'], ops: [] };
  const record = { ...n, resolved_at: now, resolved_by: actor, resolve_note: cleanText(resolveNote).slice(0, 500), updated_at: now, updated_by: actor };
  return { errors: [], ops: [{ table: 'cage_notes', op: 'put', before: n, record }], record };
}
