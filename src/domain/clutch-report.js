// V2.2.2 — Báo cáo lứa: tổng hợp từ nhật ký của lứa, sự kiện GROUP và sổ lồng phóng. Không ghi gì ngoài planFinishClutch.
// Tỷ lệ chỉ tính khi đủ dữ liệu và mẫu số phù hợp: trứng chưa soi không phải trứng không cồ; lứa suy từ V1 không tính tỷ lệ.

import { clutchSummary, chickBalance, planCloseClutch, pairClutches, clutchTitle } from './breeding.js';
import { clutchQuality } from './smart-cards.js';
import { LOSS_REASONS } from './brood.js';

export const END_REASON_LABELS = { weaned: 'Đã tách hết chim non', failed: 'Lứa hỏng / không nở', other: 'Khác' };

const rate = (n, d) => (d > 0 ? n / d : null);

/** Số liệu của 1 lứa. Lứa đã kết thúc và đang mở dùng chung một công thức. */
export function clutchReport(db, clutch) {
  const s = clutchSummary(clutch, db.daily_logs);
  const q = clutchQuality(db, clutch);
  const groupIds = new Set((db.brood_groups || []).filter((g) => g.origin_clutch_id === clutch.id).map((g) => g.id));
  const toPens = (db.stock_movements || []).filter((m) => !m.deleted && m.type === 'in_breeding'
    && (m.source_clutch_id === clutch.id || (m.source_group_id && groupIds.has(m.source_group_id)))).reduce((a, m) => a + m.qty, 0);
  const unaccounted = Math.max(0, chickBalance(s).unaccounted);
  const legacy = !!clutch.legacy_inferred;
  const closed = clutch.status === 'closed';
  const candled = q.fertileSeen + s.infertile;
  const resolved = s.pending === 0 && s.eggs > 0;
  return {
    eggsLaid: q.eggsLaid,
    fertile: q.fertileSeen,
    hatched: q.hatched,
    eggsDamaged: q.eggsLost,
    eggsInfertile: s.infertile,
    eggsPending: s.pending,
    chicksDead: q.chicksDead,
    fledged: q.fledged,
    toPens,
    movedOut: q.movedOut,
    movedIn: q.movedIn,
    alive: Math.max(0, q.hatched - q.chicksDead - unaccounted),
    chicksNow: s.chicks,
    unaccounted,
    reasons: Object.entries(q.reasons).map(([k, qty]) => { const [kind, reason] = k.split(':'); return { kind, label: LOSS_REASONS[kind]?.[reason] || reason, qty }; }),
    legacy,
    // Lứa suy từ V1: số trứng là ước lượng nên không tính tỷ lệ
    fertilityRate: legacy ? null : rate(q.fertileSeen, candled),
    hatchRate: legacy || !resolved ? null : rate(q.hatched, q.fertileSeen),
    fledgeRate: legacy || !closed ? null : rate(q.fledged, q.hatched),
  };
}

const REPORT_KEYS = ['eggsLaid', 'fertile', 'hatched', 'eggsDamaged', 'eggsInfertile', 'chicksDead', 'fledged', 'toPens', 'movedOut', 'movedIn', 'alive'];

/** Số hiện tại khác số đã chốt lúc kết thúc: chủ trại đã sửa sau đó. */
export function reportEdited(db, clutch) {
  const saved = clutch.close_report;
  if (!saved) return false;
  const now = clutchReport(db, clutch);
  return REPORT_KEYS.some((k) => (saved[k] ?? 0) !== now[k]);
}

const applyOps = (db, ops) => {
  const out = { ...db };
  for (const o of ops) {
    const list = [...(out[o.table] || [])];
    const i = list.findIndex((r) => r.id === o.record.id);
    if (i >= 0) list[i] = o.record; else list.push(o.record);
    out[o.table] = list;
  }
  return out;
};

/** Kết thúc lứa kèm số liệu chốt. Số liệu tính trên trạng thái sau khi đã áp xác nhận trứng còn lại. */
export function planFinishClutch(db, clutchId, input, ctx) {
  const plan = planCloseClutch(db, clutchId, input, ctx);
  if (plan.errors.length) return plan;
  const after = applyOps(db, plan.ops);
  const op = plan.ops.find((o) => o.table === 'clutches');
  const report = clutchReport(after, op.record);
  op.record = { ...op.record, close_report: { ...report, closed_at: ctx.now, closed_by: ctx.actor } };
  return plan;
}

/** Lịch sử lứa của cặp qua mọi lồng + tổng kết. */
export function pairHistory(db, pair) {
  const list = pairClutches(db, pair);
  const rows = list.map((clutch) => ({ clutch, title: clutchTitle(clutch), report: clutchReport(db, clutch), cage: db.cages.find((c) => c.id === clutch.cage_id) }));
  const add = (k) => rows.reduce((a, r) => a + r.report[k], 0);
  return { rows, total: { clutches: rows.length, closed: rows.filter((r) => r.clutch.status === 'closed').length, eggs: add('eggsLaid'), hatched: add('hatched'), fledged: add('fledged'), dead: add('chicksDead') } };
}
