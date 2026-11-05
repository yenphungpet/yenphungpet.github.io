// V2.1 — Trứng / chim non theo NHÓM (GROUP): số đang ở lồng, tuổi (biết chắc / ước tính), giai đoạn, ngưỡng / lồng, nguồn gốc, lịch sử.
// Mọi thay đổi số lượng do máy chủ thực hiện (RPC v2.brood_* — migration 0012); ở đây chỉ tính để HIỂN THỊ và kiểm tra trước khi gửi.
// Nguyên tắc: KHÔNG suy ra ngày đẻ / ngày nở / bố mẹ. Tuổi chỉ "biết chắc" khi người dùng ghi ngày nở chắc chắn;
// tuổi theo khoảng ngày (người dùng ước tính, hoặc khoảng ngày ghi nhận nở trong nhật ký lứa) luôn hiển thị là ƯỚC TÍNH.

import { daysBetween, addDays, isISODate, todayVN } from '../core/dates.js';
import { logsOfClutch, openClutch, pendingEggs, pickSnapshot } from './breeding.js';

export const DEFAULT_CHICK_LIMIT = 4;
export const AGE_GAP_DAYS = 7;          // chênh tuổi giữa các nhóm trong 1 lồng quá số ngày này ⇒ cảnh báo (khi có dữ liệu tuổi)
export const BACKDATE_DAYS = 7;         // máy chủ cho ghi lùi tối đa 7 ngày (v2.brood_check_date)
export const INCUBATION_DAYS = 18;      // tham khảo chung cho yến phụng — chỉ để hiển thị thanh giai đoạn trứng

// Giai đoạn phát triển chim non — THAM KHẢO CHUNG cho yến phụng, mỗi con / mỗi lứa khác nhau. Henry cần xác nhận mốc ngày
// trước khi dùng để hướng dẫn nhân viên. Không dùng để kết luận tuổi, sức khoẻ hay quyết định tách / chuyển chim.
export const BROOD_STAGES = [
  { key: 'hatchling', from: 0, to: 6, label: 'Mới nở', desc: 'Da hồng, chưa mở mắt, bố mẹ mớm hoàn toàn.' },
  { key: 'eyes', from: 7, to: 13, label: 'Mở mắt · mọc ống lông', desc: 'Mắt bắt đầu mở, ống lông nhú trên cánh và lưng.' },
  { key: 'pins', from: 14, to: 20, label: 'Lông bung', desc: 'Ống lông bung dần, thân phủ lông tơ và lông mới.' },
  { key: 'feathered', from: 21, to: 29, label: 'Gần đủ lông', desc: 'Lông gần phủ kín, bắt đầu vận động nhiều trong tổ.' },
  { key: 'fledgling', from: 30, to: 37, label: 'Ra tổ · tập ăn', desc: 'Rời tổ, tập bay ngắn, bắt đầu mổ hạt nhưng vẫn được mớm.' },
  { key: 'weaning', from: 38, to: 60, label: 'Tập tự ăn', desc: 'Thường tự ăn được; chỉ tách sau khi quan sát ăn uống ổn định.' },
];
export const STAGE_DISCLAIMER = 'Mốc ngày là tham khảo chung cho yến phụng, mỗi con khác nhau. Hình là SƠ ĐỒ minh hoạ vẽ đơn giản — không dùng để nhận dạng, xác định tuổi hay đánh giá sức khoẻ chim.';

export const EGG_CHECK_LABELS = { not_checked: 'Chưa soi', fertile_seen: 'Đã thấy cồ', not_seen_yet: 'Chưa thấy cồ (chưa kết luận)' };
export const LOSS_REASONS = {
  chick: { dead: 'Chết', missing: 'Mất / không tìm thấy', other: 'Khác' },
  egg: { egg_broken: 'Trứng vỡ', egg_damaged: 'Trứng hỏng', egg_missing: 'Trứng mất / chưa rõ nguyên nhân', egg_infertile: 'Xác nhận không cồ (đã soi lại)', other: 'Khác' },
};
LOSS_REASONS.chick.unknown = 'Chưa xác định'; LOSS_REASONS.egg.unknown = 'Chưa xác định';
export const EVENT_LABELS = { create: 'Ghi nhận nhóm', transfer: 'Chuyển lồng', hatch: 'Nở', loss: 'Hao hụt', fledge: 'Ra ràng → lồng phóng', reverse: 'Hoàn tác', wean: 'Tách mẹ' };
export const KIND_LABELS = { egg: 'trứng', chick: 'chim non' };

export const chickLimit = (settings) => Number(settings?.chickLimit) > 0 ? Number(settings.chickLimit) : DEFAULT_CHICK_LIMIT;

export function stageOf(days) {
  if (days === null || days === undefined || days < 0) return null;
  return BROOD_STAGES.find((s) => days >= s.from && days <= s.to) || BROOD_STAGES[BROOD_STAGES.length - 1];
}

/**
 * Tuổi của 1 nhóm / phần lứa: { basis: 'known'|'estimated'|'unknown', min, max, text }
 * known: ngày nở biết chắc. estimated: khoảng [hatch_date .. hatch_date_to] (hoặc 1 ngày ước tính). unknown: chưa có dữ liệu.
 */
export function ageInfo(g, today) {
  if (!g || !isISODate(g.hatch_date)) return { basis: 'unknown', min: null, max: null, text: 'Chưa rõ tuổi' };
  const max = daysBetween(g.hatch_date, today);
  const min = isISODate(g.hatch_date_to) ? daysBetween(g.hatch_date_to, today) : max;
  if (g.hatch_basis === 'known') return { basis: 'known', min: max, max, text: `${max} ngày tuổi` };
  return { basis: 'estimated', min: Math.max(0, min), max, text: min === max ? `~${max} ngày (ước tính)` : `~${Math.max(0, min)}–${max} ngày (ước tính)` };
}

const UNKNOWN_START = 'unknown';

/** Khoảng ngày nở của chim non thuộc LỨA, theo nhật ký: từ ngày sau lần ghi cuối còn 0 nở → ngày ghi số nở tăng lần cuối. Luôn là ƯỚC TÍNH. */
export function clutchHatchRange(db, clutch) {
  if (!clutch) return null;
  const logs = logsOfClutch(db.daily_logs, clutch.id);
  let lastZero = null; let first = null; let last = null; let prev = 0;
  for (const l of logs) {
    const h = Number(l.hatched) || 0;
    if (h === 0) { lastZero = l.log_date; continue; }
    if (h > prev) { if (!first) first = lastZero ? addDays(lastZero, 1) : UNKNOWN_START; last = l.log_date; }
    prev = Math.max(prev, h);
  }
  // Lần ghi đầu tiên đã có chim nở (VD lứa chuyển từ V1, ngày bắt đầu là mốc theo dõi): không biết nở từ khi nào ⇒ chưa rõ tuổi, không đoán
  if (!first || !last || first === UNKNOWN_START) return null;
  return { hatch_date: first <= last ? first : last, hatch_date_to: last, hatch_basis: 'estimated', source: 'log' };
}

export function activeGroups(db, cageId, kind = null) {
  return (db.brood_groups || []).filter((g) => g.cage_id === cageId && g.status === 'active' && g.qty > 0 && (!kind || g.kind === kind));
}

/** Snapshot mới nhất của lứa (cả dòng tự tạo bởi thao tác chuyển) + số đã chuyển đi. */
export function clutchNow(db, clutch) {
  if (!clutch) return null;
  const logs = logsOfClutch(db.daily_logs, clutch.id);
  const latest = logs[logs.length - 1] || null;
  const s = pickSnapshot(latest);
  const eggsOut = Number(latest?.eggs_out) || 0; const chicksOut = Number(latest?.chicks_out) || 0;
  return { latest, eggs: Math.max(0, pendingEggs({ ...s, eggs_out: eggsOut })), chicks: s.chicks, eggsOut, chicksOut };
}

/**
 * Trứng / chim non HIỆN Ở lồng: của lứa đang mở + các nhóm. Không gộp tuổi: mỗi phần một dòng (segment).
 * over: số chim non > ngưỡng; ageGap: chênh tuổi chắc chắn > AGE_GAP_DAYS (chỉ khi có dữ liệu tuổi).
 */
export function cageBrood(db, cageId, today, settings) {
  const clutch = openClutch(db.clutches, cageId);
  const own = clutchNow(db, clutch);
  const eggGroups = activeGroups(db, cageId, 'egg');
  const chickGroups = activeGroups(db, cageId, 'chick');
  const segments = [];
  if (own?.chicks) {
    const r = clutchHatchRange(db, clutch);
    segments.push({ kind: 'chick', own: true, qty: own.chicks, clutch, age: ageInfo(r, today), label: `Lứa ${clutch.code}` });
  }
  for (const g of chickGroups) segments.push({ kind: 'chick', own: false, qty: g.qty, group: g, age: ageInfo(g, today), label: originShort(g, db) });
  const eggSegments = [];
  if (own?.eggs) eggSegments.push({ kind: 'egg', own: true, qty: own.eggs, clutch, label: `Lứa ${clutch.code}` });
  for (const g of eggGroups) eggSegments.push({ kind: 'egg', own: false, qty: g.qty, group: g, label: originShort(g, db) });
  const chicks = segments.reduce((a, s) => a + s.qty, 0);
  const eggs = eggSegments.reduce((a, s) => a + s.qty, 0);
  const limit = chickLimit(settings);
  const aged = segments.filter((s) => s.age.basis !== 'unknown');
  const gap = aged.length > 1 ? Math.max(...aged.map((s) => s.age.min)) - Math.min(...aged.map((s) => s.age.max)) : 0;
  return {
    clutch, own, segments, eggSegments, chicks, eggs, limit,
    over: chicks > limit, groupCount: eggGroups.length + chickGroups.length,
    ageGap: gap > AGE_GAP_DAYS ? gap : 0,
    unknownAges: segments.filter((s) => s.age.basis === 'unknown').reduce((a, s) => a + s.qty, 0),
    ageRange: aged.length ? { min: Math.min(...aged.map((s) => s.age.min)), max: Math.max(...aged.map((s) => s.age.max)), estimated: aged.some((s) => s.age.basis === 'estimated') } : null,
  };
}

const cageCode = (db, id) => db.cages.find((c) => c.id === id)?.code || '?';

export function originShort(g, db) {
  if (g.origin_kind === 'clutch') return `Từ ${db.clutches.find((c) => c.id === g.origin_clutch_id)?.code || cageCode(db, g.origin_cage_id)}`;
  if (g.origin_kind === 'cage') return `Từ lồng ${cageCode(db, g.origin_cage_id)} (chưa rõ lứa)`;
  return 'Chưa rõ nguồn gốc';
}

/** Mô tả nguồn gốc đầy đủ — không suy ra bố mẹ ruột: chỉ nêu cặp đang ở lồng lúc lứa được ghi. */
export function originText(g, db, birdName = (id) => id) {
  if (g.origin_kind === 'clutch') {
    const c = db.clutches.find((x) => x.id === g.origin_clutch_id);
    const p = c?.pair_id ? db.pairs.find((x) => x.id === c.pair_id) : null;
    return `Lứa ${c?.code || '?'} của lồng ${cageCode(db, g.origin_cage_id)}${p ? ` · cặp ghi nhận ở lồng lúc đẻ: ♂ ${birdName(p.male_id)} × ♀ ${birdName(p.female_id)} (chưa xác minh bố mẹ ruột)` : ' · chưa ghi nhận cặp'}`;
  }
  if (g.origin_kind === 'cage') return `Lồng ${cageCode(db, g.origin_cage_id)} — chưa rõ lứa${g.origin_note ? ` · ${g.origin_note}` : ''}`;
  return `CHƯA RÕ NGUỒN GỐC${g.origin_note ? ` · ${g.origin_note}` : ''}`;
}

/** Toàn bộ lịch sử của nhóm gốc (mọi nhóm tách ra từ cùng gốc), cũ → mới. */
export function groupLineage(db, groupOrId) {
  const g = typeof groupOrId === 'string' ? (db.brood_groups || []).find((x) => x.id === groupOrId) : groupOrId;
  if (!g) return { root: null, groups: [], events: [] };
  const groups = (db.brood_groups || []).filter((x) => x.root_id === g.root_id);
  const ids = new Set(groups.map((x) => x.id));
  const events = (db.brood_events || []).filter((e) => ids.has(e.group_id) || ids.has(e.new_group_id)).sort((a, b) => Number(a.seq) - Number(b.seq));
  return { root: groups.find((x) => x.id === g.root_id) || null, groups, events };
}

/** Đường đi (mã lồng) của CHÍNH nhóm này: chặng của nhóm cha tới lúc tách + các lần chuyển cả nhóm sau đó.
 *  Không lấy chặng của nhánh khác cùng nhóm gốc; bỏ thao tác đã hoàn tác. */
export function groupPath(db, groupOrId) {
  const groups = db.brood_groups || [];
  const all = (db.brood_events || []).filter((e) => !e.reversed_by && e.type !== 'reverse').sort((a, b) => Number(a.seq) - Number(b.seq));
  const walk = (x, until, depth = 0) => {
    if (!x || depth > 50) return [];
    const born = all.find((e) => e.new_group_id === x.id);
    let head;
    if (born && born.group_id && born.group_id !== x.id) head = [...walk(groups.find((y) => y.id === born.group_id), Number(born.seq), depth + 1), born.to_cage_id || born.from_cage_id];
    else if (born) head = [born.from_cage_id, born.to_cage_id]; // tách từ lứa: lồng của lứa → lồng nhận
    else { const c = all.find((e) => e.group_id === x.id && e.type === 'create'); head = [c?.to_cage_id || (x.origin_kind === 'clutch' ? x.origin_cage_id : x.cage_id)]; }
    const moves = all.filter((e) => e.type === 'transfer' && e.group_id === x.id && (!e.new_group_id || e.new_group_id === x.id) && e !== born
      && Number(e.seq) < until && (!born || Number(e.seq) > Number(born.seq))).map((e) => e.to_cage_id);
    return [...head, ...moves];
  };
  const g = typeof groupOrId === 'string' ? groups.find((x) => x.id === groupOrId) : groupOrId;
  return walk(g, Infinity).filter(Boolean).map((id) => cageCode(db, id)).filter((c, i, a) => c !== a[i - 1]);
}

/** Sự kiện liên quan tới 1 lồng (đi / đến / tại lồng), mới → cũ. */
export function cageEvents(db, cageId) {
  return (db.brood_events || []).filter((e) => e.from_cage_id === cageId || e.to_cage_id === cageId).sort((a, b) => Number(b.seq) - Number(a.seq));
}

export function eventText(e, db) {
  const k = KIND_LABELS[e.kind];
  const from = e.from_cage_id ? cageCode(db, e.from_cage_id) : ''; const to = e.to_cage_id ? cageCode(db, e.to_cage_id) : '';
  if (e.type === 'transfer') return `Chuyển ${e.qty} ${k} ${from} → ${to}${e.source_clutch_id ? ` (tách từ lứa ${db.clutches.find((c) => c.id === e.source_clutch_id)?.code || ''})` : ''}`;
  if (e.type === 'create') return `Ghi nhận nhóm ${e.qty} ${k} ở ${to}`;
  if (e.type === 'hatch') return `Nở ${e.qty} con từ nhóm trứng ở ${from}`;
  if (e.type === 'loss') return `Hao hụt ${e.qty} ${k} ở ${from} — ${LOSS_REASONS[e.kind]?.[e.reason] || e.reason}`;
  if (e.type === 'wean') return `Đánh dấu tách mẹ ${e.qty} con ở ${from}`;
  if (e.type === 'fledge') return `Ra ràng ${e.qty} con ${from} → ${db.flight_pens.find((p) => p.id === e.to_pen_id)?.name || 'lồng phóng'}`;
  if (e.type === 'reverse') { const o = (db.brood_events || []).find((x) => x.id === e.reverses_id); return `Hoàn tác: ${o ? eventText(o, db) : 'thao tác'}`; }
  return e.type;
}

/** Gợi ý ở máy khách (máy chủ vẫn kiểm tra lại): có thể hoàn tác sự kiện này không, và vì sao. */
export function reverseCheck(e, db, user, now = Date.now()) {
  if (!e || e.type === 'reverse') return { ok: false, why: 'Không hoàn tác một lần hoàn tác' };
  if (e.reversed_by) return { ok: false, why: 'Đã hoàn tác' };
  const owner = user?.role === 'owner';
  if (!owner && e.created_by !== user?.id) return { ok: false, why: 'Chỉ người thực hiện hoặc chủ trại' };
  if (!owner && now - Date.parse(e.created_at) > 24 * 3600e3) return { ok: false, why: 'Quá 24 giờ — nhờ chủ trại' };
  if (!owner && e.type === 'fledge') return { ok: false, why: 'Chỉ chủ trại hoàn tác ra ràng' };
  if (!e.group_id) return { ok: true, why: '' }; // thao tác trên lứa: máy chủ đối chiếu với nhật ký
  const touched = [e.new_group_id || e.group_id];
  const later = (db.brood_events || []).some((x) => x.seq > e.seq && !x.reversed_by && x.type !== 'reverse' && (touched.includes(x.group_id) || touched.includes(x.new_group_id)));
  if (later) return { ok: false, why: 'Nhóm đã có thao tác sau — hoàn tác thao tác sau trước' };
  return { ok: true, why: '' };
}

/** G4: số ngày GHI LÙI = ngày thao tác sớm hơn ngày nhập thực tế (created_at do máy chủ gán, giờ VN). 0 = nhập đúng ngày. */
export function backdatedDays(e) {
  if (!e?.created_at || !isISODate(e.event_date)) return 0;
  return Math.max(0, daysBetween(e.event_date, todayVN(new Date(e.created_at))) || 0);
}

export function newRequestId() {
  const b = new Uint8Array(12);
  (globalThis.crypto || {}).getRandomValues?.(b);
  return `req-${Date.now().toString(36)}-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Kiểm tra trước khi CHUYỂN (máy chủ kiểm tra lại toàn bộ). input:
 * { source: {group_id} | {clutch_id, kind}, to_cage_id, qty, event_date, reason, note, confirm_over_limit, care_note, hatch_date?, hatch_date_to?, hatch_basis?, egg_check? }
 * ⇒ { errors, warnings, needConfirm, after, limit, kind, available, p (payload RPC) }
 */
export function planTransfer(db, input, ctx) {
  const errors = []; const warnings = [];
  const { today, settings } = ctx;
  const qty = Number(input.qty);
  let kind; let fromCage; let available = 0; let moving = null;
  if (input.source?.group_id) {
    const g = (db.brood_groups || []).find((x) => x.id === input.source.group_id);
    if (!g || g.status !== 'active') return { errors: ['Nhóm không còn hoạt động — tải lại'], warnings, needConfirm: false };
    kind = g.kind; fromCage = g.cage_id; available = g.qty; moving = ageInfo(g, today);
  } else if (input.source?.clutch_id) {
    const c = db.clutches.find((x) => x.id === input.source.clutch_id);
    if (!c || c.status !== 'open') return { errors: ['Lứa không còn mở'], warnings, needConfirm: false };
    kind = input.source.kind; fromCage = c.cage_id;
    const now = clutchNow(db, c);
    available = kind === 'chick' ? now.chicks : now.eggs;
    moving = kind === 'chick' ? ageInfo(input.hatch_date ? input : clutchHatchRange(db, c), today) : null;
    if (!now.latest) errors.push('Lứa chưa có nhật ký — hãy "Cập nhật hôm nay" trước khi chuyển');
    else if (input.event_date && input.event_date < now.latest.log_date) errors.push(`Lứa đã có nhật ký ngày ${now.latest.log_date} — chọn ngày chuyển từ ngày đó trở đi`);
  } else return { errors: ['Chọn nguồn chuyển'], warnings, needConfirm: false };
  if (!['egg', 'chick'].includes(kind)) errors.push('Chọn trứng hay chim non');
  if (!Number.isInteger(qty) || qty <= 0) errors.push('Số lượng phải là số nguyên lớn hơn 0');
  else if (qty > available) errors.push(`Chỉ còn ${available} ${KIND_LABELS[kind]} — không chuyển được ${qty}`);
  const target = db.cages.find((c) => c.id === input.to_cage_id);
  if (!target) errors.push('Chọn lồng nhận');
  else if (target.archived || target.deleted) errors.push('Lồng nhận đã lưu trữ');
  else if (target.id === fromCage) errors.push('Lồng nhận phải khác lồng hiện tại');
  const date = input.event_date || today;
  if (!isISODate(date)) errors.push('Ngày chuyển không hợp lệ');
  else if (date > today) errors.push('Không ghi ngày trong tương lai');
  else if (date < addDays(today, -BACKDATE_DAYS)) errors.push(`Chỉ ghi lùi tối đa ${BACKDATE_DAYS} ngày — sớm hơn nhờ chủ trại`);
  let after = null; let needConfirm = false; const limit = chickLimit(settings);
  if (target && kind === 'chick') {
    const tb = cageBrood(db, target.id, today, settings);
    after = tb.chicks + (Number.isInteger(qty) && qty > 0 ? qty : 0);
    if (after > limit) {
      needConfirm = true;
      warnings.push(`Lồng ${target.code} sẽ có ${after} chim non — vượt ngưỡng ${limit} con / lồng`);
      if (!input.confirm_over_limit || String(input.care_note || '').trim().length < 5) errors.push(`Lồng nhận sẽ có ${after} chim non (ngưỡng ${limit}). Đánh dấu "Xác nhận ngoại lệ" và ghi chú chăm sóc (≥ 5 ký tự).`);
    }
    if (moving && moving.basis !== 'unknown') {
      const aged = tb.segments.filter((s) => s.age.basis !== 'unknown');
      const gap = aged.length ? Math.max(...aged.map((s) => Math.max(s.age.min - moving.max, moving.min - s.age.max))) : 0;
      if (gap > AGE_GAP_DAYS) warnings.push(`Chênh tuổi khoảng ${gap} ngày so với chim non đang ở ${target.code} — cân nhắc an toàn trước khi chuyển`);
    }
    if (tb.unknownAges || moving?.basis === 'unknown') warnings.push('Có chim non chưa rõ tuổi — không kiểm tra được chênh tuổi');
  }
  const p = {
    // nhóm: gửi kèm lồng đang thấy ⇒ máy chủ từ chối nếu người khác vừa chuyển nhóm đi (không làm theo số liệu cũ)
    request_id: input.request_id, source: input.source?.group_id ? { group_id: input.source.group_id, expected_cage_id: fromCage } : input.source, to_cage_id: input.to_cage_id, qty, event_date: date,
    reason: String(input.reason || '').trim(), note: String(input.note || '').trim(),
    ...(needConfirm ? { confirm_over_limit: !!input.confirm_over_limit, care_note: String(input.care_note || '').trim() } : {}),
    ...(input.source?.clutch_id ? {
      ...(kind === 'egg' ? { egg_check: input.egg_check || 'not_checked', laid_date: input.laid_date || null, laid_date_to: input.laid_date_to || null } : {}),
      ...(kind === 'chick' && input.hatch_date ? { hatch_date: input.hatch_date, hatch_date_to: input.hatch_date_to || null, hatch_basis: input.hatch_basis || 'estimated' } : {}),
    } : {}),
  };
  return { errors, warnings, needConfirm, after, limit, kind, available, p };
}
