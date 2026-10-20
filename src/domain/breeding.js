// Nghiệp vụ lồng sinh sản: lứa, nhật ký (snapshot), nghỉ đẻ, hiệu suất.
//
// QUY ƯỚC QUAN TRỌNG — nhật ký là "ảnh chụp tổng hiện tại" (snapshot) của LỨA:
//   eggs      = tổng số trứng đã đẻ của lứa tính đến ngày ghi
//   fertile   = tổng số trứng đã soi xác nhận CÓ cồ
//   infertile = tổng số trứng đã soi xác nhận KHÔNG cồ
//   damaged   = tổng số trứng hỏng/vỡ/chết phôi
//   hatched   = tổng số trứng đã nở
//   chicks    = số chim non HIỆN ĐANG ở trong lồng
//   fledged   = tổng số chim non đã ra ràng
// Lưu lại cùng ngày => cập nhật bản ghi cũ (không cộng dồn). Biến động trong ngày = hiệu với snapshot trước.
// Ghi chú (từ 0011) KHÔNG nằm trong nhật ký: mỗi ghi chú là 1 dòng cage_notes riêng (xem domain/notes.js) để không bị ghi đè.

import { daysBetween, isISODate, addDays } from '../core/dates.js';
import { uid } from '../core/ids.js';
import { latestCageNote, notesOfCage, isOpenAction, planNewNote } from './notes.js';

export const SNAPSHOT_FIELDS = ['eggs', 'fertile', 'infertile', 'damaged', 'hatched', 'chicks', 'fledged'];

export const FIELD_LABELS = {
  eggs: 'Trứng đã đẻ',
  fertile: 'Có cồ',
  infertile: 'Không cồ',
  damaged: 'Trứng hỏng',
  hatched: 'Đã nở',
  chicks: 'Chim non hiện tại',
  fledged: 'Đã ra ràng',
};

export const PARENT_STATUS = ['bình thường', 'một con yếu', 'không ấp trứng', 'không mớm mồi', 'có dấu hiệu bất thường'];
export const NEST_STATUS = ['bình thường', 'khô ráo', 'ẩm ướt', 'cần thay dăm', 'đã thay dăm'];
export const WARN_PARENT = new Set(['một con yếu', 'không ấp trứng', 'không mớm mồi', 'có dấu hiệu bất thường']);
export const WARN_NEST = new Set(['ẩm ướt', 'cần thay dăm']);

export const DEFAULT_SETTINGS = {
  staleUpdateDays: 2,       // số ngày chưa cập nhật thì cảnh báo
  longRestDays: 30,         // nghỉ đẻ quá số ngày này => nhắc đánh giá lại
  restReviewDays: 21,       // mặc định ngày dự kiến đánh giá lại sau khi bắt đầu nghỉ
  overdueEggDays: 21,       // trứng còn chờ kết quả quá số ngày này kể từ quả cuối (Yến phụng ấp ~18 ngày) => nhắc soi lại
};

// Trường CỘNG DỒN của lứa (chỉ tăng) và trường HIỆN TẠI (lên xuống). Dashboard chỉ cộng số hiện tại của các lứa đang mở.
export const CUMULATIVE_FIELDS = ['eggs', 'fertile', 'infertile', 'damaged', 'hatched', 'fledged'];

// MỘT quy tắc cho mọi nơi hiển thị (thẻ lồng, chi tiết/lịch sử lứa, Tổng quan, Hiệu suất):
//  - cộng dồn: tổng của cả lứa tính đến lần ghi mới nhất — cộng được giữa các lứa (báo cáo), KHÔNG cộng vào Tổng quan
//  - hiện tại: tình trạng lúc này — chỉ cộng giữa các lứa ĐANG MỞ (Tổng quan), không cộng vào báo cáo theo thời gian
export const METRIC_KIND = {
  eggs: 'cumulative', fertile: 'cumulative', infertile: 'cumulative', damaged: 'cumulative', hatched: 'cumulative', fledged: 'cumulative',
  chicks: 'current', pending: 'current',
};
export const METRIC_LABELS = { ...FIELD_LABELS, pending: 'Trứng chờ kết quả' };
export const KIND_LABELS = { cumulative: 'cộng dồn', current: 'hiện tại' };
export const METRIC_ORDER = ['eggs', 'fertile', 'infertile', 'damaged', 'hatched', 'chicks', 'fledged', 'pending'];

/**
 * Cân đối chim non của 1 lứa: đã nở = chim non hiện tại + đã ra ràng + (phần chưa khớp).
 * Phần chưa khớp KHÔNG được hiểu là chết hay mất tích — app không có số liệu đó, người dùng phải đối chiếu.
 */
export function chickBalance(s) {
  const accounted = (s.chicks || 0) + (s.fledged || 0);
  return { hatched: s.hatched || 0, chicks: s.chicks || 0, fledged: s.fledged || 0, accounted, unaccounted: (s.hatched || 0) - accounted };
}

/** Cảnh báo cần đối chiếu khi đã nở ≠ non hiện tại + ra ràng (null nếu khớp). Không sửa, không suy đoán số liệu. */
export function chickMismatch(code, s) {
  const b = chickBalance(s);
  if (b.unaccounted <= 0) return null; // âm đã là lỗi "Nhật ký mâu thuẫn" (validateSnapshot)
  return {
    level: 'warn', short: `Lệch ${b.unaccounted} chim non — cần đối chiếu`,
    text: `Lứa ${code}: đã nở ${b.hatched} nhưng chim non hiện tại ${b.chicks} + đã ra ràng ${b.fledged} = ${b.accounted} — còn ${b.unaccounted} con chưa khớp. App KHÔNG tự ghi chim chết hay mất tích: hãy đếm lại trong lồng, sửa nhật ký nếu nhập nhầm; nếu chim đã chết hoặc chuyển đi, ghi rõ trong ghi chú.`,
  };
}

export function emptySnapshot() {
  return { eggs: 0, fertile: 0, infertile: 0, damaged: 0, hatched: 0, chicks: 0, fledged: 0 };
}

export function pickSnapshot(log) {
  const s = emptySnapshot();
  if (!log) return s;
  for (const f of SNAPSHOT_FIELDS) s[f] = Number(log[f]) || 0;
  return s;
}

/** Kiểm tra tính hợp lệ của 1 snapshot. Trả về danh sách lỗi (chuỗi tiếng Việt). */
export function validateSnapshot(s) {
  const errors = [];
  for (const f of SNAPSHOT_FIELDS) {
    const v = s[f];
    if (!Number.isInteger(v) || v < 0) errors.push(`${FIELD_LABELS[f]} phải là số nguyên ≥ 0`);
  }
  if (errors.length) return errors;
  if (s.fertile + s.infertile > s.eggs) errors.push('Có cồ + Không cồ không được lớn hơn tổng trứng đã đẻ');
  if (s.hatched > s.fertile) errors.push('Số đã nở không được lớn hơn số trứng có cồ');
  if (s.hatched + s.damaged + s.infertile > s.eggs) errors.push('Đã nở + Hỏng + Không cồ không được lớn hơn tổng trứng');
  if (s.chicks + s.fledged > s.hatched) errors.push('Chim non hiện tại + Đã ra ràng không được lớn hơn số đã nở');
  return errors;
}

/** Trứng còn đang chờ kết quả (đang ấp / chưa soi xong / có cồ chưa nở). */
export function pendingEggs(s) {
  return Math.max(0, s.eggs - s.hatched - s.damaged - s.infertile);
}

export function snapshotDelta(prev, curr) {
  const p = pickSnapshot(prev);
  const c = pickSnapshot(curr);
  const d = {};
  for (const f of SNAPSHOT_FIELDS) d[f] = c[f] - p[f];
  return d;
}

export function describeDelta(d) {
  const parts = [];
  for (const f of SNAPSHOT_FIELDS) {
    if (d[f]) parts.push(`${d[f] > 0 ? '+' : ''}${d[f]} ${FIELD_LABELS[f].toLowerCase()}`);
  }
  return parts.join(' · ');
}

const byDateAsc = (a, b) => (a.log_date === b.log_date
  ? String(a.updated_at || a.created_at || '').localeCompare(String(b.updated_at || b.created_at || ''))
  : a.log_date.localeCompare(b.log_date));

export function logsOfCage(logs, cageId) {
  return logs.filter((l) => l.cage_id === cageId && !l.deleted).sort(byDateAsc);
}

export function logsOfClutch(logs, clutchId) {
  return logs.filter((l) => l.clutch_id === clutchId && !l.deleted).sort(byDateAsc);
}

/** Tóm tắt 1 lứa từ snapshot mới nhất của chính lứa đó (không trộn lứa khác). */
export function clutchSummary(clutch, logs) {
  const own = logsOfClutch(logs, clutch.id);
  const latest = own[own.length - 1] || null;
  const s = pickSnapshot(latest);
  const pending = pendingEggs(s);
  const candled = s.fertile + s.infertile;
  const closed = clutch.status === 'closed';
  const resolved = pending === 0 && s.eggs > 0;
  let stage;
  if (closed) stage = 'closed';
  else if (s.chicks > 0) stage = 'rearing';
  else if (pending > 0) stage = 'incubating';
  else if (s.eggs === 0) stage = 'laying';
  else stage = 'awaiting_close';
  return {
    ...s,
    pending,
    stage,
    latestLog: latest,
    logCount: own.length,
    fertilityRate: candled > 0 ? s.fertile / candled : null,
    // Tỷ lệ nở chỉ tính khi mọi trứng của lứa đã có kết quả cuối cùng (lứa đã kết thúc hoặc không còn trứng chờ).
    hatchRate: (closed || resolved) && s.fertile > 0 ? s.hatched / s.fertile : null,
    hatchOfLaid: (closed || resolved) && s.eggs > 0 ? s.hatched / s.eggs : null,
    // Tỷ lệ sống đến ra ràng: chỉ tính khi lứa đã kết thúc.
    fledgeRate: closed && s.hatched > 0 ? s.fledged / s.hatched : null,
    durationDays: clutch.start_date ? daysBetween(clutch.start_date, clutch.end_date || null) : null,
  };
}

export const STAGE_LABELS = {
  laying: 'Chờ trứng',
  incubating: 'Đang ấp',
  rearing: 'Nuôi con',
  awaiting_close: 'Chờ kết thúc lứa',
  closed: 'Đã kết thúc',
};

/**
 * Số ngày nghỉ đẻ.
 *  - Bắt đầu: ngày tách hết chim non lứa trước / ngày nghỉ được xác nhận (rest_period.start_date)
 *  - Kết thúc: ngày có quả trứng đầu tiên của lứa sau (rest_period.end_date)
 *  - Không suy đoán từ ngày cập nhật nhật ký.
 */
export function restInfo(periods, cageId, today, hasOpenClutch = false) {
  const own = periods.filter((p) => p.cage_id === cageId && !p.deleted)
    .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
  const open = own.find((p) => !p.end_date);
  if (open) {
    if (!isISODate(open.start_date)) return { state: 'no_data', period: open, days: null };
    const days = daysBetween(open.start_date, today);
    const overdueReview = !!(open.expected_review_date && today > open.expected_review_date);
    return { state: 'resting', period: open, days, overdueReview };
  }
  const closed = own.filter((p) => p.end_date && isISODate(p.start_date));
  const last = closed[closed.length - 1];
  if (hasOpenClutch) {
    return last
      ? { state: 'breeding', period: last, days: null, lastRestDays: daysBetween(last.start_date, last.end_date) }
      : { state: 'breeding', period: null, days: null, lastRestDays: null };
  }
  return { state: 'no_data', period: last || null, days: null, lastRestDays: last ? daysBetween(last.start_date, last.end_date) : null };
}

/** Các khoảng nghỉ đã hoàn tất (để thống kê "số ngày nghỉ giữa các lứa"). */
export function completedRestDays(periods, cageId, pairId) {
  return periods
    .filter((p) => p.cage_id === cageId && !p.deleted && p.end_date && isISODate(p.start_date)
      && (!pairId || p.pair_id === pairId))
    .map((p) => daysBetween(p.start_date, p.end_date))
    .filter((d) => d !== null && d >= 0);
}

export function currentPair(pairs, cageId) {
  return pairs.find((p) => p.cage_id === cageId && !p.end_date && !p.deleted) || null;
}

export function openClutch(clutches, cageId) {
  return clutches.find((c) => c.cage_id === cageId && c.status !== 'closed' && !c.deleted) || null;
}

/** Lứa của lồng bao trùm ngày `date` (start_date ≤ date ≤ end_date hoặc lứa đang mở). */
export function clutchForDate(clutches, cageId, date) {
  return clutches.find((c) => c.cage_id === cageId && !c.deleted && c.start_date && c.start_date <= date
    && (c.status !== 'closed' || !c.end_date || date <= c.end_date)) || null;
}

/** Ghi chú cũ mới nhất nằm trong nhật ký (trước 0011). Màn hình dùng latestCageNote (domain/notes.js). */
export function latestNote(logs, cageId) {
  const own = logsOfCage(logs, cageId).filter((l) => (l.note || '').trim());
  const l = own[own.length - 1];
  return l ? { date: l.log_date, text: l.note.trim(), logId: l.id } : null;
}

export function logWarnings(log) {
  if (!log) return [];
  const w = [];
  if (WARN_PARENT.has(log.parents_status)) w.push(`Bố mẹ: ${log.parents_status}`);
  if (WARN_NEST.has(log.nest_status)) w.push(`Tổ: ${log.nest_status}`);
  return w;
}

/** Số chim đã nhập lồng phóng từ 1 lứa (phiếu "Nhập từ lồng sinh sản" gắn lứa gốc). */
export function movedToPens(stockMovements, clutchId) {
  return (stockMovements || []).filter((m) => m.type === 'in_breeding' && m.source_clutch_id === clutchId && !m.deleted)
    .reduce((n, m) => n + (Number(m.qty) || 0), 0);
}

/**
 * Đối chiếu số liệu của 1 lứa đang mở (không sửa dữ liệu — chỉ báo để người dùng kiểm tra).
 * level: 'danger' = mâu thuẫn chắc chắn · 'warn' = cần đối chiếu · 'info' = số suy ra để tham khảo.
 * short: chữ ngắn cho huy hiệu trên thẻ lồng; text: giải thích đầy đủ (Tổng quan, chi tiết lồng).
 */
export function clutchChecks(clutch, summary, db, today, settings = DEFAULT_SETTINGS) {
  const out = [];
  if (!clutch || !summary || !summary.latestLog) return out;
  const s = summary;
  const errs = validateSnapshot(pickSnapshot(s.latestLog));
  if (errs.length) out.push({ level: 'danger', short: 'Nhật ký mâu thuẫn', text: `Nhật ký ${s.latestLog.log_date} mâu thuẫn: ${errs.join('; ')}` });
  // Số cộng dồn không được giảm giữa các lần ghi của cùng lứa
  const own = logsOfClutch(db.daily_logs, clutch.id);
  for (let i = 1; i < own.length; i++) {
    const f = CUMULATIVE_FIELDS.find((k) => (Number(own[i][k]) || 0) < (Number(own[i - 1][k]) || 0));
    if (f) { out.push({ level: 'warn', short: `${FIELD_LABELS[f]} giảm`, text: `${FIELD_LABELS[f]} là số cộng dồn nhưng giảm từ ${own[i - 1][f]} (${own[i - 1].log_date}) xuống ${own[i][f]} (${own[i].log_date}) — kiểm tra lại nhật ký` }); break; }
  }
  if (clutch.legacy_inferred) return out; // lứa suy từ dữ liệu cũ: số liệu là ước lượng, không đối chiếu tiếp
  // Ra ràng (cộng dồn) phải bằng số đã nhập lồng phóng từ lứa này — nếu không, có chim không được tính ở đâu (hoặc tính trùng)
  const moved = movedToPens(db.stock_movements, clutch.id);
  if (s.fledged > moved) out.push({ level: 'warn', short: `${s.fledged - moved} ra ràng chưa vào lồng phóng`, text: `Lứa ${clutch.code} ghi ${s.fledged} con ra ràng nhưng mới nhập ${moved} con vào lồng phóng — ${s.fledged - moved} con chưa được tính ở Tổng quan. Lồng phóng → "Nhập từ lồng SS" chọn lứa ${clutch.code}, hoặc sửa nhật ký nếu ghi nhầm` });
  else if (moved > s.fledged) out.push({ level: 'warn', short: 'Ra ràng ít hơn số đã nhập lồng phóng', text: `Đã nhập ${moved} con từ lứa ${clutch.code} vào lồng phóng nhưng nhật ký chỉ ghi ${s.fledged} con ra ràng — cập nhật nhật ký (giảm "chim non hiện tại", tăng "đã ra ràng") để không tính trùng` });
  // Đã nở ≠ non hiện tại + ra ràng ⇒ cần đối chiếu (không suy đoán chết / mất tích)
  const mm = chickMismatch(clutch.code, s);
  if (mm) out.push(mm);
  // Trứng chờ kết quả quá lâu kể từ ngày tổng trứng đạt mức hiện tại
  if (s.pending > 0) {
    const reached = own.find((l) => (Number(l.eggs) || 0) >= s.eggs)?.log_date;
    const days = reached ? daysBetween(reached, today) : null;
    if (days !== null && days > settings.overdueEggDays) out.push({ level: 'warn', short: `${s.pending} trứng chờ quá ${settings.overdueEggDays} ngày`, text: `Lứa ${clutch.code}: còn ${s.pending} trứng chờ kết quả, quả cuối ghi ngày ${reached} (${days} ngày) — soi lại, ghi "không cồ" hoặc "hỏng" nếu không nở` });
  }
  return out;
}

/** Trạng thái tổng hợp của 1 lồng sinh sản để hiển thị thẻ. */
export function cageState(cage, db, today, settings = DEFAULT_SETTINGS) {
  const pair = currentPair(db.pairs, cage.id);
  const clutch = openClutch(db.clutches, cage.id);
  const openCount = db.clutches.filter((c) => c.cage_id === cage.id && c.status !== 'closed' && !c.deleted).length;
  const summary = clutch ? clutchSummary(clutch, db.daily_logs) : null;
  const logs = logsOfCage(db.daily_logs, cage.id);
  const lastLog = logs[logs.length - 1] || null;
  const daysSinceUpdate = lastLog ? daysBetween(lastLog.log_date, today) : null;
  const rest = restInfo(db.rest_periods, cage.id, today, !!clutch);
  const loggedToday = !!logs.find((l) => l.log_date === today);
  const stale = lastLog ? daysSinceUpdate >= settings.staleUpdateDays : true;
  const longRest = rest.state === 'resting' && rest.days >= settings.longRestDays;
  const openHealth = (db.health_cases || []).filter((h) => h.cage_id === cage.id && h.status !== 'closed' && !h.deleted);
  let status;
  if (!pair) status = 'no_pair';
  else if (clutch) status = summary.stage;
  else if (rest.state === 'resting') status = 'resting';
  else status = 'idle';
  const checks = clutchChecks(clutch, summary, db, today, settings);
  if (openCount > 1) checks.unshift({ level: 'danger', short: `${openCount} lứa đang mở`, text: `Lồng ${cage.code} có ${openCount} lứa cùng mở — chỉ lứa ${clutch.code} được hiển thị; kết thúc lứa thừa` });
  return {
    cage, pair, clutch, summary, lastLog, daysSinceUpdate, rest, loggedToday, stale, longRest,
    note: latestCageNote(db, cage.id),
    openNotes: notesOfCage(db, cage.id).filter(isOpenAction),
    warnings: logWarnings(lastLog),
    checks,
    openHealth,
    status,
  };
}

export const CAGE_STATUS_LABELS = {
  ...STAGE_LABELS,
  resting: 'Nghỉ đẻ',
  idle: 'Chưa rõ trạng thái',
  no_pair: 'Chưa ghép cặp',
};

// ---------------------------------------------------------------------------
// LẬP KẾ HOẠCH GHI DỮ LIỆU (pure) — trả về danh sách thao tác {table, op, record}
// ---------------------------------------------------------------------------

/**
 * Lưu "Cập nhật hôm nay" / sửa nhật ký.
 * input: { id?, cage_id, log_date, snapshot, parents_status, nest_status, note, noteAction, photo_ids,
 *          newClutch?: { start_date } }  — newClutch chỉ dùng khi lồng chưa có lứa mở.
 * note = ghi chú MỚI (tuỳ chọn): luôn tạo 1 dòng cage_notes mới, không sửa ghi chú cũ; noteAction = đánh dấu "Cần xử lý".
 */
export function planDailySave(db, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  const warnings = [];
  const ops = [];
  const cage = db.cages.find((c) => c.id === input.cage_id);
  if (!cage) return { errors: ['Không tìm thấy lồng'], warnings, ops };
  if (!isISODate(input.log_date)) errors.push('Ngày cập nhật không hợp lệ');
  else if (input.log_date > today) errors.push('Không thể ghi nhật ký cho ngày trong tương lai');

  const s = {};
  for (const f of SNAPSHOT_FIELDS) s[f] = Number(input.snapshot?.[f] ?? 0);
  errors.push(...validateSnapshot(s));

  // Bản ghi đang sửa: theo id; nếu không có id nhưng cùng lồng + cùng ngày đã có => sửa bản ghi đó (không tạo trùng)
  let existing = input.id ? db.daily_logs.find((l) => l.id === input.id && !l.deleted) : null;
  if (input.id && !existing) errors.push('Bản ghi cần sửa không còn tồn tại');
  if (!existing && isISODate(input.log_date)) {
    existing = db.daily_logs.find((l) => l.cage_id === cage.id && l.log_date === input.log_date && !l.deleted) || null;
  }
  // Chống ghi đè: phiên bản lúc MỞ biểu mẫu phải còn khớp với dữ liệu hiện tại
  if (existing && input.expectedVersion !== undefined && input.expectedVersion !== null && (existing.version || 0) !== input.expectedVersion) {
    return { errors: ['Bản ghi vừa được sửa ở thiết bị/người khác sau khi bạn mở biểu mẫu. Dữ liệu mới đã được tải — hãy đóng và mở lại biểu mẫu rồi sửa tiếp (thay đổi của bạn chưa được lưu).'], warnings, ops: [], conflict: true };
  }
  if (!existing && input.expectedVersion !== undefined && input.expectedVersion !== null && input.id) {
    return { errors: ['Bản ghi không còn tồn tại'], warnings, ops: [] };
  }
  if (existing && input.log_date !== existing.log_date) {
    const clash = db.daily_logs.find((l) => l.cage_id === cage.id && l.log_date === input.log_date && l.id !== existing.id && !l.deleted);
    if (clash) errors.push('Ngày này đã có nhật ký khác. Hãy sửa bản ghi của ngày đó.');
  }

  // Xác định lứa: giữ lứa của bản ghi đang sửa; nếu chưa có thì lấy lứa bao trùm ngày ghi
  let clutchId = existing ? existing.clutch_id : null;
  if (!clutchId && isISODate(input.log_date)) {
    const c = clutchForDate(db.clutches, cage.id, input.log_date);
    clutchId = c ? c.id : null;
  }
  const hasBreedingNumbers = SNAPSHOT_FIELDS.some((f) => s[f] > 0);

  if (!clutchId && hasBreedingNumbers) {
    if (!input.newClutch) {
      errors.push('Lồng chưa có lứa đang theo dõi. Hãy bật "Bắt đầu lứa mới" và nhập ngày có quả trứng đầu tiên.');
    } else if (!isISODate(input.newClutch.start_date)) {
      errors.push('Ngày có quả trứng đầu tiên không hợp lệ');
    } else if (input.newClutch.start_date > input.log_date) {
      errors.push('Ngày quả trứng đầu tiên không được sau ngày cập nhật');
    } else {
      const pair = currentPair(db.pairs, cage.id);
      const seq = db.clutches.filter((c) => c.cage_id === cage.id).length + 1;
      const clutch = {
        id: uid(), cage_id: cage.id, pair_id: pair ? pair.id : null,
        code: `${cage.code}-L${String(seq).padStart(2, '0')}`,
        start_date: input.newClutch.start_date, end_date: null, status: 'open', end_reason: null,
        created_at: now, created_by: actor,
      };
      clutchId = clutch.id;
      ops.push({ table: 'clutches', op: 'put', record: clutch });
      // Có trứng đầu tiên => kết thúc kỳ nghỉ đang mở (nếu có)
      const restOpen = db.rest_periods.find((p) => p.cage_id === cage.id && !p.end_date && !p.deleted);
      if (restOpen) {
        if (restOpen.start_date && input.newClutch.start_date < restOpen.start_date) {
          errors.push('Ngày quả trứng đầu tiên sớm hơn ngày bắt đầu nghỉ đẻ — kiểm tra lại');
        } else {
          ops.push({ table: 'rest_periods', op: 'put', record: { ...restOpen, end_date: input.newClutch.start_date, end_reason: 'first_egg', updated_at: now, updated_by: actor } });
        }
      }
      if (!pair) errors.push('Lồng chưa ghép cặp bố mẹ — hãy ghép cặp trước khi bắt đầu lứa (để lứa có đúng bố mẹ). Vẫn có thể ghi ghi chú & ảnh.');
    }
  }

  if (clutchId && isISODate(input.log_date)) {
    const clutch = db.clutches.find((c) => c.id === clutchId) || ops.find((o) => o.table === 'clutches')?.record;
    if (clutch?.start_date && input.log_date < clutch.start_date) errors.push('Ngày cập nhật sớm hơn ngày bắt đầu lứa');
    if (clutch?.status === 'closed' && clutch.end_date && input.log_date > clutch.end_date && !existing) {
      errors.push('Lứa đã kết thúc trước ngày này');
    }
    // Cảnh báo số tổng bị giảm so với snapshot trước (thường do nhập nhầm biến động thay vì tổng)
    const prev = logsOfClutch(db.daily_logs, clutchId).filter((l) => l.log_date < input.log_date).pop();
    if (prev) {
      for (const f of ['eggs', 'fertile', 'infertile', 'damaged', 'hatched', 'fledged']) {
        if (s[f] < (Number(prev[f]) || 0)) warnings.push(`${FIELD_LABELS[f]} giảm so với lần ghi ${prev.log_date} (${prev[f]} → ${s[f]}). Ô này là TỔNG của lứa, không phải số trong ngày.`);
      }
    }
  }

  if (errors.length) return { errors, warnings, ops: [] };

  const base = existing ? { ...existing } : { id: uid(), created_at: now, created_by: actor, version: 0 };
  const record = {
    ...base,
    cage_id: cage.id,
    clutch_id: clutchId,
    log_date: input.log_date,
    ...s,
    parents_status: input.parents_status || 'bình thường',
    nest_status: input.nest_status || 'bình thường',
    note: existing ? (existing.note || '') : '', // ghi chú cũ (trước 0011) giữ nguyên; ghi chú mới vào cage_notes
    photo_ids: input.photo_ids || [],
    updated_at: now,
    updated_by: actor,
    version: (base.version || 0) + (existing ? 1 : 0),
  };
  ops.push({ table: 'daily_logs', op: 'put', record, before: existing || null });
  const note = planNewNote(db, { cage_id: cage.id, log_id: record.id, clutch_id: clutchId, note_date: input.log_date, text: input.note, needs_action: input.noteAction }, ctx);
  if (note.errors.length) return { errors: note.errors, warnings, ops: [] };
  ops.push(...note.ops);
  return { errors, warnings, ops, record, note: note.record || null, isEdit: !!existing };
}

/** Kết thúc lứa; tuỳ chọn bắt đầu tính nghỉ đẻ từ ngày tách hết chim non. */
export function planCloseClutch(db, clutchId, input, ctx) {
  const { today, actor, now, settings = DEFAULT_SETTINGS } = ctx;
  const errors = [];
  const ops = [];
  const clutch = db.clutches.find((c) => c.id === clutchId);
  if (!clutch) return { errors: ['Không tìm thấy lứa'], ops };
  if (clutch.status === 'closed') errors.push('Lứa đã kết thúc trước đó');
  if (!isISODate(input.end_date)) errors.push('Ngày kết thúc không hợp lệ');
  else {
    if (input.end_date > today) errors.push('Ngày kết thúc không được ở tương lai');
    if (clutch.start_date && input.end_date < clutch.start_date) errors.push('Ngày kết thúc sớm hơn ngày bắt đầu lứa');
  }
  const s = clutchSummary(clutch, db.daily_logs);
  if (input.end_reason === 'weaned' && s.chicks > 0) {
    errors.push(`Lứa vẫn còn ${s.chicks} chim non trong lồng. Hãy cập nhật nhật ký (chim non = 0) hoặc chuyển chim sang lồng phóng trước.`);
  }
  if (input.start_rest) {
    const restOpen = db.rest_periods.find((p) => p.cage_id === clutch.cage_id && !p.end_date && !p.deleted);
    if (restOpen) errors.push('Lồng đang có kỳ nghỉ đẻ chưa kết thúc');
  }
  if (errors.length) return { errors, ops: [] };
  ops.push({ table: 'clutches', op: 'put', before: clutch, record: { ...clutch, status: 'closed', end_date: input.end_date, end_reason: input.end_reason || 'other', close_note: input.note || '', updated_at: now, updated_by: actor } });
  if (input.start_rest) {
    ops.push({ table: 'rest_periods', op: 'put', record: {
      id: uid(), cage_id: clutch.cage_id, pair_id: clutch.pair_id, start_date: input.end_date,
      reason: input.end_reason === 'weaned' ? 'Tách hết chim non' : (input.rest_reason || 'Kết thúc lứa'),
      expected_review_date: addDays(input.end_date, Number(input.review_days) || settings.restReviewDays),
      end_date: null, end_reason: null, health_note: '', created_at: now, created_by: actor,
    } });
  }
  return { errors, ops };
}

/**
 * Sửa ngày bắt đầu lứa (ngày quả trứng đầu tiên) — khi nhập nhầm hoặc nhập dữ liệu lịch sử. CHỈ CHỦ TRẠI.
 * Chỉ đổi clutches.start_date (giữ id, mã lứa, bố mẹ, trạng thái). Nhật ký, trứng, chim non, ảnh, phiếu lồng phóng
 * gắn theo clutch_id nên giữ nguyên. Kỳ nghỉ đẻ trước kết thúc "có trứng đầu tiên" đúng ngày cũ ⇒ đổi ngày kết thúc theo
 * (vì định nghĩa: kết thúc nghỉ = ngày trứng đầu tiên của lứa sau).
 * input: { start_date, expectedUpdatedAt } — expectedUpdatedAt = updated_at lúc mở biểu mẫu (chống ghi đè).
 * Lịch sử đổi ngày: máy chủ ghi audit_log (trước/sau) cho mỗi lần sửa.
 */
export function planEditClutchStart(db, clutchId, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  const warnings = [];
  const notes = [];
  const clutch = db.clutches.find((c) => c.id === clutchId && !c.deleted);
  if (!clutch) return { errors: ['Không tìm thấy lứa'], warnings, notes, ops: [] };
  if (input.expectedUpdatedAt !== undefined && (clutch.updated_at || null) !== (input.expectedUpdatedAt || null)) {
    return { errors: ['Lứa vừa được sửa ở thiết bị/người khác sau khi bạn mở biểu mẫu. Hãy đóng và mở lại biểu mẫu (thay đổi của bạn chưa được lưu).'], warnings, notes, ops: [], conflict: true };
  }
  const d = input.start_date;
  if (!isISODate(d)) errors.push('Ngày bắt đầu lứa không hợp lệ');
  else if (d === clutch.start_date) errors.push('Ngày bắt đầu không thay đổi');
  else {
    if (d > today) errors.push('Ngày bắt đầu lứa không được ở tương lai');
    if (clutch.end_date && d > clutch.end_date) errors.push(`Ngày bắt đầu không được sau ngày kết thúc lứa (${clutch.end_date})`);
    const logs = logsOfClutch(db.daily_logs, clutch.id);
    if (logs.length && d > logs[0].log_date) {
      errors.push(`Lứa đã có nhật ký từ ngày ${logs[0].log_date} — ngày bắt đầu (quả trứng đầu tiên) phải từ ngày đó trở về trước. Nhật ký không bị đổi ngày.`);
    }
    const end = clutch.end_date || '9999-12-31';
    for (const o of db.clutches) {
      if (o.id === clutch.id || o.deleted || o.cage_id !== clutch.cage_id || !o.start_date) continue;
      if (d <= (o.end_date || '9999-12-31') && o.start_date <= end) errors.push(`Trùng thời gian với lứa ${o.code} (${o.start_date} → ${o.end_date || 'đang mở'}) của cùng lồng`);
    }
    // Nhật ký "không thuộc lứa" nằm trong khoảng mới: giữ nguyên, không tự gán (chỉ báo)
    const lo = d < clutch.start_date ? d : null;
    if (lo) {
      const loose = db.daily_logs.filter((l) => l.cage_id === clutch.cage_id && !l.deleted && !l.clutch_id && l.log_date >= lo && l.log_date < clutch.start_date);
      if (loose.length) notes.push(`${loose.length} nhật ký không thuộc lứa trong khoảng ${d} → ${clutch.start_date} vẫn giữ nguyên (không tự gán vào lứa).`);
    }
    const pair = db.pairs.find((p) => p.id === clutch.pair_id);
    if (pair?.start_date && d < pair.start_date) {
      warnings.push(`Ngày bắt đầu lứa sớm hơn ngày ghép cặp (${pair.start_date}) của bố mẹ lứa này. Bố mẹ của lứa vẫn giữ nguyên; nếu đây là dữ liệu lịch sử (cặp đã ở với nhau từ trước) thì có thể lưu.`);
    }
  }
  if (errors.length) return { errors, warnings, notes, ops: [] };
  const ops = [{ table: 'clutches', op: 'put', before: clutch, record: { ...clutch, start_date: d, updated_at: now, updated_by: actor } }];
  const rest = db.rest_periods.find((p) => p.cage_id === clutch.cage_id && !p.deleted && p.end_reason === 'first_egg' && p.end_date === clutch.start_date);
  if (rest) {
    if (rest.start_date && d < rest.start_date) {
      return { errors: [`Ngày bắt đầu lứa sớm hơn ngày bắt đầu kỳ nghỉ đẻ trước (${rest.start_date}). Sửa kỳ nghỉ đẻ đó trước (tab Nghỉ đẻ).`], warnings, notes, ops: [] };
    }
    ops.push({ table: 'rest_periods', op: 'put', before: rest, record: { ...rest, end_date: d, updated_at: now, updated_by: actor } });
    notes.push(`Kỳ nghỉ đẻ trước (từ ${rest.start_date}) kết thúc khi có trứng đầu tiên ⇒ ngày kết thúc đổi ${rest.end_date} → ${d}.`);
  }
  return { errors, warnings, notes, ops };
}

/** Bắt đầu kỳ nghỉ (ngày nghỉ được xác nhận). */
export function planStartRest(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  if (!isISODate(input.start_date)) errors.push('Ngày bắt đầu nghỉ không hợp lệ');
  else if (input.start_date > today) errors.push('Ngày bắt đầu nghỉ không được ở tương lai');
  if (openClutch(db.clutches, cageId)) errors.push('Lồng đang có lứa chưa kết thúc. Hãy kết thúc lứa trước.');
  if (db.rest_periods.find((p) => p.cage_id === cageId && !p.end_date && !p.deleted)) errors.push('Lồng đang trong kỳ nghỉ');
  if (input.expected_review_date && isISODate(input.start_date) && input.expected_review_date < input.start_date) errors.push('Ngày đánh giá lại phải sau ngày bắt đầu nghỉ');
  if (errors.length) return { errors, ops: [] };
  const pair = currentPair(db.pairs, cageId);
  return { errors, ops: [{ table: 'rest_periods', op: 'put', record: {
    id: uid(), cage_id: cageId, pair_id: pair ? pair.id : null, start_date: input.start_date,
    reason: input.reason || 'Nghỉ được xác nhận', expected_review_date: input.expected_review_date || null,
    end_date: null, end_reason: null, health_note: input.health_note || '', created_at: now, created_by: actor,
  } }] };
}

export function planUpdateRest(db, restId, input, ctx) {
  const { actor, now, today } = ctx;
  const p = db.rest_periods.find((r) => r.id === restId);
  if (!p) return { errors: ['Không tìm thấy kỳ nghỉ'], ops: [] };
  const rec = { ...p, ...input, updated_at: now, updated_by: actor };
  const errors = [];
  if (rec.start_date && !isISODate(rec.start_date)) errors.push('Ngày bắt đầu không hợp lệ');
  if (rec.end_date) {
    if (!isISODate(rec.end_date)) errors.push('Ngày kết thúc không hợp lệ');
    else if (rec.start_date && rec.end_date < rec.start_date) errors.push('Ngày kết thúc sớm hơn ngày bắt đầu');
    else if (rec.end_date > today) errors.push('Ngày kết thúc không được ở tương lai');
  }
  if (errors.length) return { errors, ops: [] };
  return { errors, ops: [{ table: 'rest_periods', op: 'put', record: rec, before: p }] };
}

/**
 * Thay trống/mái. Kết thúc cặp cũ, tạo cặp mới — lứa cũ giữ nguyên pair_id nên phả hệ không bị ghi đè.
 * input: { date, role: 'male'|'female', new_bird_id, old_bird_status, reason, note, photo_ids }
 */
export function planMateChange(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  const warnings = [];
  const ops = [];
  const pair = currentPair(db.pairs, cageId);
  if (!isISODate(input.date)) errors.push('Ngày thay không hợp lệ');
  else if (input.date > today) errors.push('Ngày thay không được ở tương lai');
  if (!['male', 'female'].includes(input.role)) errors.push('Chọn thay trống hay mái');
  if (!input.reason?.trim()) errors.push('Nhập lý do thay');
  const newBird = db.birds.find((b) => b.id === input.new_bird_id);
  if (!newBird) errors.push('Chọn cá thể mới');
  else {
    if (['dead', 'sold'].includes(newBird.status)) errors.push('Cá thể mới đã chết hoặc đã bán');
    if (newBird.status === 'paired') errors.push('Cá thể mới đang được ghép ở lồng khác');
    if (input.role === 'male' && newBird.sex === 'female') errors.push('Cá thể mới là mái, không thể thay vị trí trống');
    if (input.role === 'female' && newBird.sex === 'male') errors.push('Cá thể mới là trống, không thể thay vị trí mái');
    if (newBird.sex === 'unknown') warnings.push('Giới tính cá thể mới chưa xác minh');
  }
  if (pair && isISODate(input.date) && pair.start_date && input.date < pair.start_date) errors.push('Ngày thay sớm hơn ngày ghép cặp hiện tại');
  if (errors.length) return { errors, warnings, ops: [] };

  const oldId = pair ? (input.role === 'male' ? pair.male_id : pair.female_id) : null;
  const keepId = pair ? (input.role === 'male' ? pair.female_id : pair.male_id) : null;
  if (pair) ops.push({ table: 'pairs', op: 'put', before: pair, record: { ...pair, end_date: input.date, end_reason: 'mate_change', updated_at: now, updated_by: actor } });
  const newPair = {
    id: uid(), cage_id: cageId,
    male_id: input.role === 'male' ? newBird.id : keepId,
    female_id: input.role === 'female' ? newBird.id : keepId,
    start_date: input.date, end_date: null, created_at: now, created_by: actor,
  };
  ops.push({ table: 'pairs', op: 'put', record: newPair });
  ops.push({ table: 'mate_changes', op: 'put', record: {
    id: uid(), cage_id: cageId, date: input.date, role: input.role,
    old_bird_id: oldId, new_bird_id: newBird.id, old_pair_id: pair?.id || null, new_pair_id: newPair.id,
    reason: input.reason.trim(), note: (input.note || '').trim(), photo_ids: input.photo_ids || [],
    created_at: now, created_by: actor,
  } });
  ops.push({ table: 'birds', op: 'put', before: newBird, record: { ...newBird, status: 'paired', updated_at: now, updated_by: actor } });
  const oldBird = oldId ? db.birds.find((b) => b.id === oldId) : null;
  if (oldBird) ops.push({ table: 'birds', op: 'put', before: oldBird, record: { ...oldBird, status: input.old_bird_status || 'holding', updated_at: now, updated_by: actor } });
  if (openClutch(db.clutches, cageId)) warnings.push('Lồng đang có lứa mở — lứa này vẫn giữ bố mẹ cũ.');
  return { errors, warnings, ops };
}

/** Ghép cặp cho lồng đang trống. */
export function planNewPair(db, cageId, input, ctx) {
  const { today, actor, now } = ctx;
  const errors = [];
  if (currentPair(db.pairs, cageId)) errors.push('Lồng đã có cặp — dùng chức năng Thay trống/mái');
  if (!isISODate(input.start_date)) errors.push('Ngày ghép không hợp lệ');
  else if (input.start_date > today) errors.push('Ngày ghép không được ở tương lai');
  const m = db.birds.find((b) => b.id === input.male_id);
  const f = db.birds.find((b) => b.id === input.female_id);
  if (!m) errors.push('Chọn chim trống');
  if (!f) errors.push('Chọn chim mái');
  for (const b of [m, f].filter(Boolean)) {
    if (['dead', 'sold'].includes(b.status)) errors.push(`${b.ring_code} đã chết hoặc đã bán`);
    if (b.status === 'paired') errors.push(`${b.ring_code} đang ghép ở lồng khác`);
  }
  if (m && m.sex === 'female') errors.push(`${m.ring_code} đang ghi là mái`);
  if (f && f.sex === 'male') errors.push(`${f.ring_code} đang ghi là trống`);
  if (m && f && m.id === f.id) errors.push('Trống và mái phải là hai cá thể khác nhau');
  if (errors.length) return { errors, ops: [] };
  const pair = { id: uid(), cage_id: cageId, male_id: m.id, female_id: f.id, start_date: input.start_date, end_date: null, created_at: now, created_by: actor };
  return { errors, ops: [
    { table: 'pairs', op: 'put', record: pair },
    { table: 'birds', op: 'put', before: m, record: { ...m, status: 'paired', updated_at: now, updated_by: actor } },
    { table: 'birds', op: 'put', before: f, record: { ...f, status: 'paired', updated_at: now, updated_by: actor } },
  ] };
}

/** Xoá mềm nhật ký (chỉ chủ trại) — giữ bản ghi để truy vết. */
export function planDeleteLog(db, logId, ctx) {
  const l = db.daily_logs.find((x) => x.id === logId && !x.deleted);
  if (!l) return { errors: ['Không tìm thấy nhật ký'], ops: [] };
  return { errors: [], ops: [{ table: 'daily_logs', op: 'put', before: l, record: { ...l, deleted: true, deleted_at: ctx.now, deleted_by: ctx.actor } }] };
}

/** Lứa thuộc lồng đang dùng (lồng đã lưu trữ "ẩn khỏi danh sách & thống kê" — giống Tổng quan). */
export function inFarmStats(db, clutch) {
  const cage = db.cages.find((c) => c.id === clutch.cage_id);
  return !!cage && !cage.archived && !cage.deleted && !clutch.deleted;
}

/** Hiệu suất của 1 cặp (hoặc lồng) trong khoảng thời gian (theo ngày bắt đầu lứa). Toàn trại: bỏ lồng đã lưu trữ. */
export function pairPerformance(db, { pairId = null, cageId = null, from = null, to = null } = {}) {
  const farmWide = !pairId && !cageId;
  const clutches = db.clutches.filter((c) => !c.deleted && (!farmWide || inFarmStats(db, c))
    && (!pairId || c.pair_id === pairId) && (!cageId || c.cage_id === cageId)
    && (!from || (c.start_date && c.start_date >= from)) && (!to || (c.start_date && c.start_date <= to)));
  const sums = { clutches: clutches.length, closed: 0, eggs: 0, fertile: 0, infertile: 0, damaged: 0, hatched: 0, fledged: 0,
    resolvedFertile: 0, resolvedHatched: 0, closedHatched: 0, closedFledged: 0 };
  for (const c of clutches) {
    const s = clutchSummary(c, db.daily_logs);
    sums.eggs += s.eggs; sums.fertile += s.fertile; sums.infertile += s.infertile;
    sums.damaged += s.damaged; sums.hatched += s.hatched; sums.fledged += s.fledged;
    if (s.hatchRate !== null) { sums.resolvedFertile += s.fertile; sums.resolvedHatched += s.hatched; }
    if (c.status === 'closed') { sums.closed += 1; sums.closedHatched += s.hatched; sums.closedFledged += s.fledged; }
  }
  const restDays = (cageId || pairId)
    ? db.rest_periods.filter((p) => !p.deleted && p.end_date && isISODate(p.start_date)
        && (!pairId || p.pair_id === pairId) && (!cageId || p.cage_id === cageId)
        && (!from || p.end_date >= from) && (!to || p.start_date <= to))
      .map((p) => daysBetween(p.start_date, p.end_date))
    : [];
  const candled = sums.fertile + sums.infertile;
  return {
    ...sums,
    fertilityRate: candled ? sums.fertile / candled : null,
    hatchRate: sums.resolvedFertile ? sums.resolvedHatched / sums.resolvedFertile : null,
    fledgeRate: sums.closedHatched ? sums.closedFledged / sums.closedHatched : null,
    restDays,
    avgRestDays: restDays.length ? restDays.reduce((a, b) => a + b, 0) / restDays.length : null,
  };
}
