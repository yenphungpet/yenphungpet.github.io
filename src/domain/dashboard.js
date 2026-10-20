// Số liệu tổng quan. Mỗi chỉ số có định nghĩa rõ ràng (METRIC_DEFS) để tránh cộng trùng:
//  - Chim non trong lồng sinh sản và chim trong lồng phóng là 2 nhóm tách biệt (chim chuyển ra lồng phóng thì
//    người dùng cập nhật "chim non hiện tại" của lứa giảm tương ứng).
//  - Chim giống đã ghép đang nằm trong lồng sinh sản KHÔNG được tính vào "Lồng Chim Giống".

import { cageState, DEFAULT_SETTINGS } from './breeding.js';
import { penBalance } from './stock.js';
import { breederStats, birdAnomalies } from './breeders.js';
import { summarize, filterTx } from './finance.js';
import { debtSummary, salesRevenue } from './sales.js';
import { daysBetween } from '../core/dates.js';
import { lowStockItems } from './inventory.js';
import { openActionNotes } from './notes.js';

export const METRIC_DEFS = {
  cages: 'Số lồng sinh sản đang sử dụng (không tính lồng đã lưu trữ).',
  activeCages: 'Lồng có lứa đang mở (chờ trứng, đang ấp, nuôi con hoặc chờ kết thúc lứa).',
  resting: 'Lồng có kỳ nghỉ đẻ đang mở (đã xác nhận ngày bắt đầu nghỉ).',
  eggs: 'Trứng đang theo dõi = Σ (đã đẻ − đã nở − hỏng − không cồ) của các lứa đang mở.',
  chicks: 'Σ chim non hiện tại của các lứa đang mở (chim còn trong lồng sinh sản).',
  pen: 'Tồn hiện tại theo sổ biến động của lồng phóng.',
  breederPen: 'Số cá thể đang ở Lồng Chim Giống (trạng thái “Trong Lồng Chim Giống”). Không gồm chim đang ghép — số “đang ghép ở lồng SS” bên dưới là bố mẹ thuộc cặp đang mở của lồng sinh sản đang dùng (2 con mỗi cặp).',
  checks: 'Đối chiếu tự động, không sửa dữ liệu: ra ràng ↔ nhập lồng phóng, đã nở ≠ chim non hiện tại + ra ràng (cần đối chiếu — không tự suy ra chết/mất), trứng chờ quá lâu, nhật ký mâu thuẫn, số cộng dồn giảm, trạng thái chim lệch với cặp ghép.',
};

export function dashboardMetrics(db, today, settings = DEFAULT_SETTINGS) {
  const cages = db.cages.filter((c) => !c.archived && !c.deleted);
  const states = cages.map((c) => cageState(c, db, today, settings));
  const pens = db.flight_pens.filter((p) => !p.archived).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const monthPrefix = today.slice(0, 7);
  const monthTx = filterTx(db.transactions, { from: `${monthPrefix}-01`, to: `${monthPrefix}-31` });
  const metrics = {
    cages: cages.length,
    activeCages: states.filter((s) => s.clutch).length,
    resting: states.filter((s) => s.rest.state === 'resting').length,
    eggs: states.reduce((a, s) => a + (s.summary ? s.summary.pending : 0), 0),
    chicks: states.reduce((a, s) => a + (s.summary ? s.summary.chicks : 0), 0),
    pens: pens.map((p) => ({ pen: p, qty: penBalance(db.stock_movements, p.id) })),
    breeders: breederStats(db.birds, db),
    month: summarize(monthTx),
    debt: debtSummary(db.orders, db.payments),
    monthRevenue: salesRevenue(db.orders, `${monthPrefix}-01`, `${monthPrefix}-31`),
  };
  const alerts = {
    stale: states.filter((s) => s.stale).sort((a, b) => (b.daysSinceUpdate ?? 9999) - (a.daysSinceUpdate ?? 9999)),
    longRest: states.filter((s) => s.longRest || s.rest.overdueReview),
    warnings: states.filter((s) => s.warnings.length),
    health: (db.health_cases || []).filter((h) => h.status !== 'closed' && !h.deleted),
    lowStock: lowStockItems(db, today),
    checks: [
      ...states.flatMap((s) => s.checks.map((c) => ({ ...c, cage: s.cage }))),
      ...birdAnomalies(db).map((a) => ({ level: 'warn', short: 'Trạng thái chim lệch', text: a.text, bird: a.bird })),
    ],
  };
  return { states, metrics, alerts };
}

// Số cảnh báo cần xem (đối chiếu mức "tham khảo" không tính) — để lời chào không báo "ổn" khi còn cảnh báo
export function alertCount(a) {
  return a.stale.length + a.longRest.length + a.health.length + a.lowStock.length + a.warnings.length + a.checks.filter((c) => c.level !== 'info').length;
}
export function heroLine(nTasks, nAlerts) {
  if (!nTasks && !nAlerts) return 'Mọi việc đều ổn';
  return [nTasks ? `${nTasks} nhóm việc cần chú ý hôm nay` : 'Không có việc tồn đọng', nAlerts ? `${nAlerts} cảnh báo cần xem` : ''].filter(Boolean).join(' · ');
}

/** Danh sách việc cần làm hôm nay sinh tự động từ dữ liệu. */
export function todayTasks(db, today, settings = DEFAULT_SETTINGS, role = 'owner', nameOf = () => '') {
  const { states, alerts } = dashboardMetrics(db, today, settings);
  const tasks = [];
  const notLogged = states.filter((s) => s.pair && !s.loggedToday);
  if (notLogged.length) tasks.push({ kind: 'log', icon: 'clipboard', title: `Cập nhật ${notLogged.length} lồng sinh sản chưa ghi hôm nay`, detail: notLogged.slice(0, 8).map((s) => s.cage.code).join(', ') + (notLogged.length > 8 ? '…' : ''), href: '#/cages?f=notlogged' });
  for (const s of alerts.longRest) {
    tasks.push({ kind: 'rest', icon: 'moon', title: `${s.cage.code}: đánh giá lại điều kiện nuôi & sức khoẻ`, detail: s.rest.overdueReview ? `Quá ngày dự kiến đánh giá (${s.rest.period.expected_review_date})` : `Đã nghỉ ${s.rest.days} ngày`, href: `#/cage/${s.cage.id}` });
  }
  for (const h of alerts.health) {
    const last = (db.health_followups || []).filter((f) => f.case_id === h.id && !f.deleted).map((f) => f.date).sort().pop() || h.detected_date;
    const gap = daysBetween(last, today);
    if (gap >= 1) tasks.push({ kind: 'health', icon: 'heart', title: `Theo dõi sức khoẻ: ${h.symptoms.slice(0, 40)}`, detail: `Lần ghi gần nhất ${gap} ngày trước`, href: `#/health/${h.id}` });
  }
  const awaiting = states.filter((s) => s.summary?.stage === 'awaiting_close');
  // Ghi chú "Cần xử lý" (mọi vai trò) — còn hiện tới khi có người xác nhận "Đã xử lý"
  for (const n of openActionNotes(db)) {
    const cage = db.cages.find((c) => c.id === n.cage_id);
    const who = nameOf(n.created_by);
    tasks.push({ kind: 'note', icon: 'note', title: `${cage.code}: ${n.text.length > 70 ? `${n.text.slice(0, 70)}…` : n.text}`, detail: `Cần xử lý · ghi ngày ${n.note_date}${who ? ` · ${who}` : ''}`, href: `#/cage/${cage.id}`, noteId: n.id });
  }
  for (const s of awaiting) tasks.push({ kind: 'clutch', icon: 'egg', title: `${s.cage.code}: lứa không còn trứng/chim non — xem xét kết thúc lứa`, detail: s.clutch.code, href: `#/cage/${s.cage.id}` });
  if (alerts.lowStock.length) tasks.push({ kind: 'stock', icon: 'store', title: `${alerts.lowStock.length} vật tư / thức ăn sắp hết — cần nhập thêm`, detail: alerts.lowStock.map((x) => `${x.item.name} (${x.balance} ${x.item.unit})`).join(', '), href: '#/inventory?f=low' });
  if (role === 'owner') {
    const ship = db.orders.filter((o) => o.status === 'confirmed' && !o.deleted);
    if (ship.length) tasks.push({ kind: 'order', icon: 'truck', title: `${ship.length} đơn đã chốt chờ giao`, detail: ship.map((o) => o.code).join(', '), href: '#/sales' });
  }
  return tasks;
}
