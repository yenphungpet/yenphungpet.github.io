// V2.2 — Thẻ lồng thông minh: phần tính toán để HIỂN THỊ (viền đảo tổ, trứng theo trạng thái soi, thanh tiến độ, hao hụt, thống kê, sắp xếp).
// Mọi số lượng lấy từ nhật ký lứa và nhóm của V2.1 (cageBrood) — ở đây không tính lại tổng, không ghi gì.
// Nguyên tắc: không suy ra ngày đẻ / ngày nở khi không có dữ liệu, không tự chuyển trạng thái chỉ vì đủ ngày.

import { daysBetween, addDays, isISODate } from '../core/dates.js';
import { logsOfClutch, clutchSummary, openClutches, planDailySave, clutchForDate, pickSnapshot, chickBalance, pickOut, clutchTitle, SNAPSHOT_FIELDS } from './breeding.js';
import { activeGroups, ageInfo, cageEvents, LOSS_REASONS } from './brood.js';

export const EGG_MIN_DAYS = 18;
export const EGG_MAX_DAYS = 21;
export const CHICK_SCALE_DAYS = 42;

// Mốc tham khảo chung, mỗi con khác nhau. Không tự chuyển trạng thái ra ràng / tách mẹ khi đủ ngày.
export const CHICK_MILESTONES = [
  { from: 0, to: 14, label: 'Sơ sinh, phát triển ban đầu', tone: 'm1' },
  { from: 15, to: 29, label: 'Phát triển lông', tone: 'm2' },
  { from: 30, to: 35, label: 'Có thể bắt đầu ra ràng', tone: 'm3' },
  { from: 36, to: 42, label: 'Kiểm tra tự ăn, điều kiện tách mẹ', tone: 'm4' },
];

const active = (e) => !e.reversed_by && e.type !== 'reverse';

// Một lứa hoặc danh sách các lứa đang mở của lồng
const asList = (c) => (Array.isArray(c) ? c : c ? [c] : []);

/** Mốc bắt đầu theo dõi của lồng: lứa đang mở cũ nhất, hoặc sau lứa đã kết thúc gần nhất. */
function cycleStart(db, cageId, clutches) {
  if (clutches.length) return clutches.map((c) => c.start_date).sort()[0];
  const closed = db.clutches.filter((c) => c.cage_id === cageId && !c.deleted && c.status === 'closed' && c.end_date).map((c) => c.end_date).sort();
  return closed.length ? closed[closed.length - 1] : null;
}

/**
 * Viền thẻ: 'mixed' (đỏ) khi lứa hiện tại đã thật sự có đảo trứng / chim non theo LỊCH SỬ, hoặc trong lồng đang có nhóm không thuộc lứa.
 * Thao tác đã hoàn tác không tính. Lứa mới tính theo lịch sử của lứa mới; lịch sử cũ vẫn còn trong sổ.
 * 'original' (xanh) khi có lứa chưa phát sinh đảo tổ; 'none' (trung tính) khi lồng chưa có lứa.
 */
export function fosterState(db, cageId, clutch) {
  const list = asList(clutch);
  const start = cycleStart(db, cageId, list);
  const ev = cageEvents(db, cageId).filter((e) => active(e) && (e.type === 'transfer' || e.type === 'create')
    && (!start || e.event_date >= start)
    && !(list.length && e.source_clutch_id && !list.some((c) => c.id === e.source_clutch_id)));
  const groups = activeGroups(db, cageId);
  const inN = ev.filter((e) => e.to_cage_id === cageId).reduce((a, e) => a + e.qty, 0);
  const outN = ev.filter((e) => e.type === 'transfer' && e.from_cage_id === cageId).reduce((a, e) => a + e.qty, 0);
  const mixed = ev.length > 0 || groups.length > 0;
  return { state: mixed ? 'mixed' : list.length ? 'original' : 'none', inN, outN, groupCount: groups.length };
}

/** Lần soi trứng còn hiệu lực của lồng (thuộc lứa hiện tại). */
export function latestEggCheck(db, cageId, clutch) {
  return (db.cage_checks || []).filter((c) => c.cage_id === cageId && c.kind === 'egg_check' && !c.revoked_at && (c.clutch_id || null) === (clutch?.id || null))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
}

/**
 * Trứng hiện có chia theo trạng thái soi, tổng luôn bằng số trứng hiện có (không đếm trùng).
 * Trứng nở sau lần soi được trừ vào "có cồ"; trứng mới đẻ sau lần soi là "chưa soi". "Chưa thấy cồ" không phải kết luận không cồ.
 */
export function eggBreakdown(db, cageId, brood) {
  const total = brood.eggs;
  if (!total) return { total: 0, fertile: 0, notSeen: 0, unchecked: 0, check: null };
  const holders = (brood.parts || []).filter((p) => p.own?.eggs);
  // Nhiều lứa còn trứng: mỗi lứa có lần soi riêng, cộng lại (nhóm tính một phần riêng)
  if (holders.length > 1) {
    const groupSegs = brood.eggSegments.filter((s) => s.group);
    const piece = [
      ...holders.map((p) => eggsOfOne(db, cageId, p.clutch, p.own, [], p.own.eggs)),
      ...(groupSegs.length ? [eggsOfOne(db, cageId, null, null, groupSegs.map((s) => s.group), groupSegs.reduce((a, s) => a + s.qty, 0))] : []),
    ];
    const add = (k) => piece.reduce((a, x) => a + x[k], 0);
    return { total, fertile: add('fertile'), notSeen: add('notSeen'), unchecked: add('unchecked'), check: piece.map((x) => x.check).filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null };
  }
  const one = holders[0] || { clutch: brood.clutch, own: brood.own };
  return eggsOfOne(db, cageId, one.clutch, one.own, brood.eggSegments.filter((s) => s.group).map((s) => s.group), total);
}

function eggsOfOne(db, cageId, clutch, own, groups, total) {
  const check = latestEggCheck(db, cageId, clutch);
  const ownLog = own?.latest || null;
  const ownFertile = ownLog ? Math.min(Math.max(0, (Number(ownLog.fertile) || 0) - (Number(ownLog.hatched) || 0)), own.eggs) : 0;
  const groupFertile = groups.filter((g) => g.egg_check === 'fertile_seen').reduce((a, g) => a + g.qty, 0);
  const logged = ownFertile + groupFertile;
  let fertile; let notSeen;
  if (check) {
    const hatchedOwn = Math.max(0, (Number(ownLog?.hatched) || 0) - (Number(check.hatched_snapshot) || 0));
    const hatchedGroup = (db.brood_events || []).filter((e) => e.type === 'hatch' && active(e) && e.from_cage_id === cageId && String(e.created_at) > String(check.created_at)).reduce((a, e) => a + e.qty, 0);
    fertile = Math.max(0, check.fertile_seen - hatchedOwn - hatchedGroup);
    notSeen = check.not_seen;
    // Nhật ký được ghi SAU lần soi có thể nêu nhiều trứng có cồ hơn
    if (ownLog && String(ownLog.updated_at || '') > String(check.created_at) && logged > fertile) fertile = logged;
  } else {
    fertile = logged;
    notSeen = groups.filter((g) => g.egg_check === 'not_seen_yet').reduce((a, g) => a + g.qty, 0);
  }
  fertile = Math.min(fertile, total);
  notSeen = Math.min(notSeen, total - fertile);
  return { total, fertile, notSeen, unchecked: total - fertile - notSeen, check };
}

/** Các đợt tăng số của một trường cộng dồn trong nhật ký lứa. Đợt ở lần ghi đầu tiên chỉ có khoảng ngày khi lứa ghi từ đầu trong V2. */
function cohortsOf(clutch, logs, field) {
  const out = []; let prev = 0; let prevDate = null;
  for (const l of logs) {
    const v = Number(l[field]) || 0;
    if (v > prev) {
      const firstOfLegacy = !prevDate && (l.legacy || clutch.legacy_inferred);
      const noBaseline = !prevDate && field === 'hatched';
      const from = firstOfLegacy || noBaseline ? null : prevDate ? addDays(prevDate, 1) : (clutch.first_egg_date || clutch.start_date);
      out.push({ key: l.log_date, qty: v - prev, from: from && from <= l.log_date ? from : (from ? l.log_date : null), to: firstOfLegacy || noBaseline ? null : l.log_date });
    }
    if (v > prev) prev = v;
    prevDate = l.log_date;
  }
  return out;
}

/** Phần còn trong tổ phân về các đợt mới nhất (đợt cũ nở / ra ràng trước). Đây là ước tính, nhãn thanh luôn ghi rõ. */
function allocateNewest(cohorts, remaining) {
  const out = []; let left = remaining;
  for (let i = cohorts.length - 1; i >= 0 && left > 0; i--) { const q = Math.min(left, cohorts[i].qty); out.unshift({ ...cohorts[i], qty: q }); left -= q; }
  if (left > 0) out.unshift({ key: 'chua-ro', qty: left, from: null, to: null });
  return out;
}

const refOf = (db, clutch, kind, key) => (db.brood_refs || []).find((r) => r.id === `${clutch.id}|${kind}|${key}`) || null;

function eggProgress(input, today) {
  const { incubate, laid, laidTo } = input;
  let basis; let max; let min; let ageText; let ref;
  if (isISODate(incubate)) { basis = 'known'; max = min = daysBetween(incubate, today); ageText = `Đã ấp ${max} ngày`; ref = 'incubate'; }
  else if (isISODate(laid)) {
    basis = 'estimated'; ref = 'laid'; max = daysBetween(laid, today); min = isISODate(laidTo) ? Math.max(0, daysBetween(laidTo, today)) : max;
    ageText = min === max ? `~${max} ngày từ ngày đẻ (ước tính)` : `~${min}–${max} ngày từ ngày đẻ (ước tính)`;
  } else return { basis: 'unknown', days: null, min: null, pct: 0, ageText: 'Chưa rõ ngày đẻ', remainText: 'Chưa xác định ngày nở', tone: 'egg', ref: null };
  const lo = EGG_MIN_DAYS - max; const hi = EGG_MAX_DAYS - min;
  const remainText = hi < 0 ? `Đã quá mốc ${EGG_MAX_DAYS} ngày — nên kiểm tra` : lo <= 0 ? 'Đang trong khoảng dự kiến nở' : `Dự kiến nở sau ~${lo}–${hi} ngày${basis === 'estimated' ? ' (ước tính)' : ''}`;
  return { basis, days: max, min, pct: Math.min(100, Math.round((Math.max(0, max) / EGG_MAX_DAYS) * 100)), ageText, remainText, tone: 'egg', ref };
}

function chickProgress(age) {
  if (!age || age.basis === 'unknown') return { basis: 'unknown', days: null, min: null, pct: 0, ageText: 'Chưa rõ tuổi', remainText: 'Chưa xác định mốc', tone: 'm0', milestone: null };
  const d = age.max;
  const milestone = CHICK_MILESTONES.find((m) => d >= m.from && d <= m.to) || null;
  const toFledge = 30 - d;
  const toWean = 36 - d;
  const remainText = d > 42 ? 'Đã qua các mốc tham khảo' : toFledge > 0 ? `Còn ~${toFledge} ngày đến mốc ra ràng` : toWean > 0 ? `Còn ~${toWean} ngày đến mốc kiểm tra tách mẹ` : 'Trong mốc kiểm tra tách mẹ';
  return { basis: age.basis, days: d, min: age.min, pct: Math.min(100, Math.round((Math.max(0, d) / CHICK_SCALE_DAYS) * 100)), ageText: age.text, remainText, tone: milestone?.tone || 'm4', milestone };
}

/** Các thanh tiến độ của lồng. Số thanh phụ thuộc dữ liệu; tuổi tính theo ngày hôm nay nên tự tăng, không cần cập nhật. */
export function progressBars(db, cageId, today, brood) {
  const bars = [];
  const parts = brood.parts || (brood.clutch ? [{ clutch: brood.clutch, own: brood.own }] : []);
  for (const { clutch, own } of parts) {
    if (!own?.eggs) continue;
    for (const c of allocateNewest(cohortsOf(clutch, logsOfClutch(db.daily_logs, clutch.id), 'eggs'), own.eggs)) {
      const r = refOf(db, clutch, 'egg', c.key);
      const p = eggProgress(r && (r.incubate_date || r.laid_date) ? { incubate: r.incubate_date, laid: r.laid_date } : { laid: c.from, laidTo: c.to }, today);
      bars.push({ clutch, ...p, id: `own-egg-${clutch.id}-${c.key}`, kind: 'egg', qty: c.qty, own: true, cohort: c.key, source: `clutch:${clutch.id}:egg`, label: clutchTitle(clutch), ref: r });
    }
  }
  for (const s of brood.eggSegments.filter((x) => x.group)) {
    const g = s.group;
    bars.push({ ...eggProgress({ incubate: g.incubate_date, laid: g.laid_date, laidTo: g.laid_date_to }, today), id: `grp-${g.id}`, kind: 'egg', qty: g.qty, own: false, group: g, source: `group:${g.id}`, label: s.label });
  }
  for (const { clutch, own } of parts) {
    if (!own?.chicks) continue;
    for (const c of allocateNewest(cohortsOf(clutch, logsOfClutch(db.daily_logs, clutch.id), 'hatched'), own.chicks)) {
      const r = refOf(db, clutch, 'chick', c.key);
      const age = r?.hatch_date ? ageInfo(r, today) : ageInfo(c.from ? { hatch_date: c.from, hatch_date_to: c.to, hatch_basis: 'estimated' } : null, today);
      bars.push({ clutch, ...chickProgress(age), id: `own-chick-${clutch.id}-${c.key}`, kind: 'chick', qty: c.qty, own: true, cohort: c.key, source: `clutch:${clutch.id}:chick`, label: clutchTitle(clutch), ref: r });
    }
  }
  for (const s of brood.segments.filter((x) => x.group)) {
    bars.push({ ...chickProgress(s.age), id: `grp-${s.group.id}`, kind: 'chick', qty: s.qty, own: false, group: s.group, source: `group:${s.group.id}`, label: s.label });
  }
  return bars;
}

/**
 * Hao hụt trong lứa hiện tại ở lồng: trứng vỡ / hỏng và chim non chết, kèm nguyên nhân đã ghi.
 * Trứng hỏng nhập từ báo cáo ngày không có nguyên nhân ⇒ "chưa ghi nguyên nhân". Phần chim non chưa khớp KHÔNG tính là chết.
 */
export function lossSummary(db, cageId, clutch) {
  const list = asList(clutch);
  const start = cycleStart(db, cageId, list);
  const sums = list.map((c) => clutchSummary(c, db.daily_logs));
  const damaged = sums.reduce((a, s) => a + s.damaged, 0);
  const ev = (db.brood_events || []).filter((e) => e.type === 'loss' && active(e) && e.from_cage_id === cageId && (!start || e.event_date >= start)
    && !(list.length && e.source_clutch_id && !list.some((c) => c.id === e.source_clutch_id)));
  const rows = {};
  const add = (kind, label, qty) => { const k = `${kind}|${label}`; rows[k] = { kind, label, qty: (rows[k]?.qty || 0) + qty }; };
  for (const e of ev) add(e.kind, LOSS_REASONS[e.kind]?.[e.reason] || e.reason, e.qty);
  const ownEggEvents = ev.filter((e) => e.kind === 'egg' && !e.group_id).reduce((a, e) => a + e.qty, 0);
  const groupEggs = ev.filter((e) => e.kind === 'egg' && e.group_id).reduce((a, e) => a + e.qty, 0);
  const noReason = Math.max(0, damaged - ownEggEvents);
  if (noReason) add('egg', 'Trứng hỏng (chưa ghi nguyên nhân)', noReason);
  const chicks = ev.filter((e) => e.kind === 'chick').reduce((a, e) => a + e.qty, 0);
  return { eggs: damaged + groupEggs, chicks, rows: Object.values(rows), unaccounted: sums.reduce((a, s) => a + Math.max(0, chickBalance(s).unaccounted), 0) };
}

/**
 * Số liệu chất lượng sinh sản của 1 lứa để làm báo cáo sau. Kết quả của trứng / chim non đi nhờ tính cho CẶP SINH HỌC (lứa gốc của nhóm),
 * không tính cho cặp đang nuôi. Nhóm chưa rõ nguồn gốc không được tính cho lứa nào.
 */
export function clutchQuality(db, clutch) {
  const logs = logsOfClutch(db.daily_logs, clutch.id);
  const s = { ...pickSnapshot(logs[logs.length - 1]), ...pickOut(logs[logs.length - 1]) };
  const groupIds = new Set((db.brood_groups || []).filter((g) => g.origin_clutch_id === clutch.id).map((g) => g.id));
  const ev = (db.brood_events || []).filter((e) => active(e));
  const mine = ev.filter((e) => (e.group_id && groupIds.has(e.group_id)) || (!e.group_id && e.source_clutch_id === clutch.id));
  const sum = (arr) => arr.reduce((a, e) => a + e.qty, 0);
  const checks = (db.cage_checks || []).filter((c) => c.clutch_id === clutch.id && c.kind === 'egg_check' && !c.revoked_at);
  const reasons = {};
  for (const e of mine.filter((x) => x.type === 'loss')) { const k = `${e.kind}:${e.reason}`; reasons[k] = (reasons[k] || 0) + e.qty; }
  const end = clutch.end_date || '9999-12-31';
  return {
    eggsLaid: s.eggs,
    fertileSeen: Math.max(s.fertile, ...checks.map((c) => c.fertile_seen + (Number(c.hatched_snapshot) || 0))),
    hatched: s.hatched + sum(mine.filter((e) => e.type === 'hatch')),
    eggsLost: s.damaged + sum(mine.filter((e) => e.type === 'loss' && e.kind === 'egg' && e.group_id)),
    chicksDead: sum(mine.filter((e) => e.type === 'loss' && e.kind === 'chick')),
    fledged: s.fledged + sum(mine.filter((e) => e.type === 'fledge' && e.group_id)), // ra ràng của lứa đã nằm trong nhật ký
    weaned: sum(mine.filter((e) => e.type === 'wean')),
    movedOut: s.eggs_out + s.chicks_out,
    movedIn: sum(ev.filter((e) => e.type === 'transfer' && e.to_cage_id === clutch.cage_id && e.event_date >= clutch.start_date && e.event_date <= end)),
    reasons,
  };
}

/** Lồng cần kiểm tra mỗi ngày: có cặp, hoặc đang có trứng / chim non. Lồng trống không tính vào bộ đếm. */
export const needsCheck = (state, brood) => !!state.pair || brood.eggs > 0 || brood.chicks > 0;

/**
 * Thứ tự danh sách: chưa kiểm tra hôm nay (lâu chưa kiểm tra lên trước) → đã kiểm tra → lồng không cần kiểm tra.
 * rows: [{ state, brood }]; giữ thứ tự mã lồng cho các lồng ngang nhau.
 */
export function smartSort(rows) {
  const rank = (r) => (!needsCheck(r.state, r.brood) ? 2 : r.state.checkedToday ? 1 : 0);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const d = rank(a.r) - rank(b.r);
    if (d) return d;
    if (rank(a.r) === 0) {
      const x = a.r.state.check.lastDate || ''; const y = b.r.state.check.lastDate || '';
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.i - b.i;
  }).map((x) => x.r);
}

export function checkCounter(rows) {
  const need = rows.filter((r) => needsCheck(r.state, r.brood));
  return { total: need.length, left: need.filter((r) => !r.state.checkedToday).length };
}

/**
 * "+ Thêm" nhanh: cộng vào số TỔNG của lứa rồi lưu bằng đúng đường của "Cập nhật hôm nay" (planDailySave: chống ghi đè, tạo lứa khi cần).
 * input: { cage_id, clutch_id?, type: 'egg'|'hatch', qty, date }
 * Không chọn lứa: trứng mới vào lứa mới nhất; chim non mới nở từ lứa cũ nhất còn trứng.
 */
export function planQuickAdd(db, input, ctx) {
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty <= 0) return { errors: ['Số lượng phải là số nguyên lớn hơn 0'], warnings: [], ops: [] };
  const date = input.date || ctx.today;
  const open = openClutches(db.clutches, input.cage_id);
  const clutch = (input.clutch_id && open.find((c) => c.id === input.clutch_id))
    || (input.type === 'hatch' && open.find((c) => clutchSummary(c, db.daily_logs).pending > 0))
    || clutchForDate(db.clutches, input.cage_id, date) || open[open.length - 1] || null;
  const logs = clutch ? logsOfClutch(db.daily_logs, clutch.id) : [];
  const latest = logs[logs.length - 1] || null;
  if (latest && latest.log_date > date) return { errors: [`Lứa đã có nhật ký ngày ${latest.log_date} — sửa nhật ký ngày đó thay vì thêm vào ngày cũ hơn`], warnings: [], ops: [] };
  const snap = pickSnapshot(latest);
  if (input.type === 'hatch') {
    if (!clutch) return { errors: ['Lồng chưa có lứa nên chưa ghi được chim non mới nở'], warnings: [], ops: [] };
    const pending = snap.eggs - snap.hatched - snap.damaged - snap.infertile - (Number(latest?.eggs_out) || 0);
    if (qty > pending) return { errors: [`Lứa chỉ còn ${Math.max(0, pending)} trứng chờ kết quả — không ghi nở ${qty} được`], warnings: [], ops: [] };
    snap.hatched += qty; snap.chicks += qty; snap.fertile = Math.max(snap.fertile, snap.hatched);
  } else snap.eggs += qty;
  const existing = latest?.log_date === date ? latest : null;
  const snapshot = Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, snap[f]]));
  return planDailySave(db, {
    id: existing?.id, cage_id: input.cage_id, clutch_id: clutch?.id, log_date: date, snapshot,
    parents_status: existing?.parents_status || latest?.parents_status, nest_status: existing?.nest_status || latest?.nest_status,
    note: input.note || '', photo_ids: existing?.photo_ids || [],
    newClutch: clutch ? null : { start_date: date }, expectedVersion: existing ? (existing.version || 0) : null,
  }, ctx);
}
