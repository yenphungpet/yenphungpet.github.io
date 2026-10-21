// Checklist hằng ngày — danh sách công việc (bổ sung từ V1: chủ trại thêm / sửa / xoá công việc).
// Xoá công việc chỉ bỏ khỏi danh sách; lịch sử đánh dấu các ngày trước (done) giữ nguyên.
import { uid } from '../core/ids.js';

export const TASK_GROUPS = ['Sáng', 'Trưa', 'Chiều', 'Tối'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(input) {
  const title = String(input.title || '').trim();
  const group = String(input.group || '').trim();
  const time = String(input.time || '').trim();
  const errors = [];
  if (!title) errors.push('Nhập tên công việc');
  else if (title.length > 80) errors.push('Tên công việc tối đa 80 ký tự');
  if (!group) errors.push('Chọn buổi');
  else if (group.length > 20) errors.push('Tên buổi tối đa 20 ký tự');
  if (time && !TIME.test(time)) errors.push('Giờ theo dạng HH:MM (VD 06:30) hoặc để trống');
  return { errors, task: { title, group, time: time || '—' } };
}

// Chèn vào cuối nhóm (giữ thứ tự nhóm như hiện tại; nhóm mới đặt cuối)
function placeInGroup(tasks, task) {
  const last = tasks.map((t) => t.group).lastIndexOf(task.group);
  const out = [...tasks];
  out.splice(last < 0 ? out.length : last + 1, 0, task);
  return out;
}

export function planTaskAdd(row, input) {
  const { errors, task } = clean(input);
  if (errors.length) return { errors, record: null };
  if (row.tasks.some((t) => t.group === task.group && t.title.toLowerCase() === task.title.toLowerCase())) return { errors: ['Công việc này đã có trong buổi đó'], record: null };
  return { errors: [], record: { ...row, tasks: placeInGroup(row.tasks, { id: `tc-${uid()}`, ...task }) } };
}

export function planTaskEdit(row, id, input) {
  const cur = row.tasks.find((t) => t.id === id);
  if (!cur) return { errors: ['Không tìm thấy công việc'], record: null };
  const { errors, task } = clean(input);
  if (errors.length) return { errors, record: null };
  const next = { ...cur, ...task };
  const tasks = cur.group === next.group ? row.tasks.map((t) => (t.id === id ? next : t)) : placeInGroup(row.tasks.filter((t) => t.id !== id), next);
  return { errors: [], record: { ...row, tasks } };
}

export function planTaskDelete(row, id) {
  if (!row.tasks.some((t) => t.id === id)) return { errors: ['Không tìm thấy công việc'], record: null };
  return { errors: [], record: { ...row, tasks: row.tasks.filter((t) => t.id !== id) } }; // done (lịch sử) giữ nguyên
}
