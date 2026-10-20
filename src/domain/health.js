// Sức khoẻ & cách ly theo lồng. Ứng dụng chỉ GHI NHẬN quan sát — không chẩn đoán bệnh, không chỉ định thuốc.

import { isISODate } from '../core/dates.js';
import { uid } from '../core/ids.js';

export const ISOLATION = {
  none: 'Không cách ly',
  isolated: 'Đang cách ly',
  monitoring: 'Theo dõi tại chỗ',
  released: 'Đã kết thúc cách ly',
};

export function planHealthCase(db, input, ctx) {
  const { actor, now, today } = ctx;
  const errors = [];
  const existing = input.id ? db.health_cases.find((h) => h.id === input.id) : null;
  if (!isISODate(input.detected_date)) errors.push('Ngày phát hiện không hợp lệ');
  else if (input.detected_date > today) errors.push('Ngày phát hiện không được ở tương lai');
  if (!input.cage_id && !input.pen_id && !input.location?.trim()) errors.push('Chọn lồng liên quan');
  const n = Number(input.affected_count);
  if (!Number.isInteger(n) || n <= 0) errors.push('Số chim bị ảnh hưởng phải là số nguyên > 0');
  if (!input.symptoms?.trim()) errors.push('Mô tả triệu chứng quan sát được');
  if (!ISOLATION[input.isolation_status]) errors.push('Chọn trạng thái cách ly');
  if (errors.length) return { errors, ops: [] };
  const rec = {
    ...(existing || { id: input.id || uid(), created_at: now, created_by: actor, status: 'open' }),
    cage_id: input.cage_id || null, pen_id: input.pen_id || null, location: (input.location || '').trim(),
    detected_date: input.detected_date, affected_count: n, symptoms: input.symptoms.trim(),
    isolation_status: input.isolation_status, assignee: (input.assignee || '').trim(), vet_result: (input.vet_result || '').trim(),
    photo_ids: input.photo_ids || existing?.photo_ids || [], updated_at: now, updated_by: actor,
  };
  return { errors: [], ops: [{ table: 'health_cases', op: 'put', record: rec, before: existing || null }], record: rec };
}

export function planHealthFollowup(db, caseId, input, ctx) {
  const { actor, now, today } = ctx;
  const hc = db.health_cases.find((h) => h.id === caseId);
  const errors = [];
  if (!hc) return { errors: ['Không tìm thấy hồ sơ'], ops: [] };
  if (!isISODate(input.date)) errors.push('Ngày không hợp lệ');
  else {
    if (input.date > today) errors.push('Ngày không được ở tương lai');
    if (input.date < hc.detected_date) errors.push('Ngày theo dõi sớm hơn ngày phát hiện');
  }
  if (!input.note?.trim()) errors.push('Nhập nội dung theo dõi');
  if (input.isolation_status && !ISOLATION[input.isolation_status]) errors.push('Trạng thái cách ly không hợp lệ');
  if (input.close && !input.outcome?.trim()) errors.push('Nhập kết quả khi đóng hồ sơ');
  if (errors.length) return { errors, ops: [] };
  const fu = { id: uid(), case_id: caseId, date: input.date, note: input.note.trim(), isolation_status: input.isolation_status || hc.isolation_status,
    vet_result: (input.vet_result || '').trim(), photo_ids: input.photo_ids || [], created_at: now, created_by: actor };
  const upd = { ...hc, isolation_status: fu.isolation_status, updated_at: now, updated_by: actor };
  if (fu.vet_result) upd.vet_result = fu.vet_result;
  if (input.close) { upd.status = 'closed'; upd.closed_date = input.date; upd.outcome = input.outcome.trim(); }
  return { errors: [], ops: [{ table: 'health_followups', op: 'put', record: fu }, { table: 'health_cases', op: 'put', record: upd, before: hc }] };
}

export function followupsOf(db, caseId) {
  return db.health_followups.filter((f) => f.case_id === caseId && !f.deleted).sort((a, b) => b.date.localeCompare(a.date));
}
