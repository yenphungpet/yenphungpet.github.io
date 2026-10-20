// DỮ LIỆU GIẢ LẬP (DEMO) — không phải dữ liệu thật của trại. Mọi mã chim bắt đầu bằng "DM-", khách hàng gắn "(demo)".
// Sinh bằng chính các hàm nghiệp vụ để đảm bảo dữ liệu nhất quán (không âm tồn, không trùng nhật ký...).

import { emptyDb } from './schema.js';
import { addDays } from '../core/dates.js';
import { planDailySave, planCloseClutch, planStartRest, openClutch } from '../domain/breeding.js';
import { planMovement } from '../domain/stock.js';
import { planOrderSave, planOrderStatus, planPayment } from '../domain/sales.js';
import { planTransaction } from '../domain/finance.js';
import { planHealthCase, planHealthFollowup } from '../domain/health.js';
import { planItemSave, planInvMovement } from '../domain/inventory.js';
import { uid } from '../core/ids.js';

export const DEMO_LABEL = 'DỮ LIỆU GIẢ LẬP — chỉ để kiểm thử';

const COLORS_M = ['Xanh lá', 'Xanh da trời', 'Vàng chanh (Lutino)', 'Xám', 'Trắng (Albino)', 'Xanh bơ đầu vàng', 'Cánh vằn', 'Opaline xanh'];
const COLORS_F = ['Xanh đậm', 'Vàng mặt (Yellowface)', 'Xanh lá', 'Trắng xanh', 'Xám mặt vàng', 'Cánh trơn', 'Xanh nhạt', 'Pied xanh'];

export const DEFAULT_TASKS = [
  { id: 't01', time: '06:00', group: 'Sáng', title: 'Kiểm tra tổng quan đàn' },
  { id: 't02', time: '06:15', group: 'Sáng', title: 'Thay nước sạch' },
  { id: 't03', time: '06:30', group: 'Sáng', title: 'Cho ăn thức ăn mềm' },
  { id: 't04', time: '06:45', group: 'Sáng', title: 'Bổ sung hạt & khoáng' },
  { id: 't05', time: '07:00', group: 'Sáng', title: 'Kiểm tra từng tổ đẻ & cập nhật nhật ký' },
  { id: 't06', time: '07:15', group: 'Sáng', title: 'Thay giấy lót phân' },
  { id: 't08', time: '16:00', group: 'Chiều', title: 'Kiểm tra máng thức ăn' },
  { id: 't09', time: '16:15', group: 'Chiều', title: 'Quan sát đàn lần 2' },
  { id: 't12', time: '18:30', group: 'Tối', title: 'Bật đèn, kiểm tra bạt chắn gió' },
  { id: 't14', time: '18:45', group: 'Tối', title: 'Kiểm tra chim non lần cuối' },
];

export function buildDemo(today) {
  const db = emptyDb();
  const apply = (r, label) => {
    if (r.errors?.length) throw new Error(`Seed lỗi (${label}): ${r.errors.join('; ')}`);
    for (const o of r.ops) {
      const list = db[o.table];
      const i = list.findIndex((x) => x.id === o.record.id);
      if (i >= 0) list[i] = o.record; else list.push(o.record);
    }
    return r;
  };
  const d = (n) => addDays(today, n);
  const ctx = (n = 0) => ({ today: d(n), now: `${d(n)}T01:00:00.000Z`, actor: 'demo-owner' });
  const S = (eggs = 0, fertile = 0, infertile = 0, damaged = 0, hatched = 0, chicks = 0, fledged = 0) => ({ eggs, fertile, infertile, damaged, hatched, chicks, fledged });

  db.settings.push({ id: 'app', value: { farmName: 'Trại Yến Phụng (DEMO)', demo: true } });
  db.flight_pens.push(
    { id: 'pen-1', name: 'Lồng phóng 1', purpose: 'Chim tơ để bán', sort: 1 },
    { id: 'pen-2', name: 'Lồng phóng 2', purpose: 'Chim lớn để bán', sort: 2 },
  );
  db.checklist.push({ id: 'tasks', tasks: DEFAULT_TASKS, done: {} });

  // Ông bà (tổ tiên) cho vài cá thể để kiểm tra huyết thống
  const bird = (o) => { const b = { id: uid(), status: 'holding', sex_confidence: 'visual', origin: 'purchased', photo_ids: [], note: '', created_at: `${d(-200)}T00:00:00Z`, ...o }; db.birds.push(b); return b; };
  const gpa = bird({ ring_code: 'DM-G01', sex: 'male', sex_confidence: 'confirmed', phenotype: 'Xanh lá', status: 'retired', note: 'Tổ tiên (demo)' });
  const gma = bird({ ring_code: 'DM-G02', sex: 'female', sex_confidence: 'confirmed', phenotype: 'Vàng mặt', status: 'retired', note: 'Tổ tiên (demo)' });

  // 16 lồng sinh sản
  const cages = [];
  for (let i = 1; i <= 16; i++) {
    const code = `L${String(i).padStart(2, '0')}`;
    const cage = { id: uid(), code, name: `Lồng ${code}`, sort: i, note: '' };
    db.cages.push(cage); cages.push(cage);
    if (i === 16) continue; // lồng trống chưa ghép
    const fromG = i <= 2;
    const m = bird({ ring_code: `DM-T${String(i).padStart(2, '0')}`, sex: 'male', sex_confidence: i % 3 ? 'confirmed' : 'visual', phenotype: COLORS_M[i % COLORS_M.length], status: 'paired', father_id: fromG ? gpa.id : null, mother_id: fromG ? gma.id : null });
    const f = bird({ ring_code: `DM-M${String(i).padStart(2, '0')}`, sex: 'female', sex_confidence: 'confirmed', phenotype: COLORS_F[i % COLORS_F.length], status: 'paired' });
    db.pairs.push({ id: uid(), cage_id: cage.id, male_id: m.id, female_id: f.id, start_date: d(-150), end_date: null, created_at: `${d(-150)}T00:00:00Z` });
  }

  const log = (cage, day, s, note = '', extra = {}) => apply(planDailySave(db, { cage_id: cage.id, log_date: d(day), snapshot: s, note, ...extra }, ctx(day)), `${cage.code} ${day}`);
  const startClutch = (cage, firstEgg, day, s, note) => log(cage, day, s, note, { newClutch: { start_date: d(firstEgg) } });
  const close = (cage, day, reason = 'weaned', rest = true, note = '') => apply(planCloseClutch(db, openClutch(db.clutches, cage.id).id, { end_date: d(day), end_reason: reason, start_rest: rest, note }, ctx(day)), `close ${cage.code}`);

  // Lứa cũ đã kết thúc cho L01–L06 (để có hiệu suất & ngày nghỉ thực tế)
  const pen1Inputs = [];
  for (let i = 0; i < 6; i++) {
    const c = cages[i];
    const st = -120 + i * 3;
    startClutch(c, st, st + 6, S(5, 0, 0, 0, 0, 0, 0), 'Đủ lứa trứng');
    log(c, st + 9, S(5, 4, 1, 0, 0, 0, 0), 'Soi trứng');
    log(c, st + 24, S(5, 4, 1, 1, 3, 3, 0), 'Nở 3 con');
    log(c, st + 50, S(5, 4, 1, 1, 3, 0, 3 - (i % 2)), 'Tách non ra lồng phóng');
    pen1Inputs.push({ c, day: st + 50, qty: 3 - (i % 2) });
    close(c, st + 50, 'weaned', true);
  }
  // Nhập lồng phóng từ lứa cũ
  for (const { c, day, qty } of pen1Inputs) {
    const cl = db.clutches.find((x) => x.cage_id === c.id);
    apply(planMovement(db, { type: 'in_breeding', date: d(day), qty, to_pen_id: 'pen-1', source_cage_id: c.id, source_clutch_id: cl.id, note: `Từ ${c.code}` }, ctx(day)), 'pen in');
  }
  apply(planMovement(db, { type: 'transfer', date: d(-40), qty: 6, from_pen_id: 'pen-1', to_pen_id: 'pen-2', note: 'Chim đã lớn' }, ctx(-40)), 'transfer');
  apply(planMovement(db, { type: 'loss', date: d(-20), qty: 1, from_pen_id: 'pen-1', note: 'Chết 1 con yếu (demo)' }, ctx(-20)), 'loss');

  // Lứa thứ 2 (đang mở) cho L01–L04 => kết thúc kỳ nghỉ tự động
  startClutch(cages[0], -14, -13, S(2), 'Bắt đầu đẻ lại');
  log(cages[0], -8, S(5, 0, 0, 0, 0, 0, 0), 'Đủ 5 trứng');
  log(cages[0], -4, S(5, 4, 1, 0, 0, 0, 0), 'Soi: 4 có cồ');
  log(cages[0], 0, S(5, 4, 1, 0, 0, 0, 0), 'Mái ấp đều, tổ khô ráo', { nest_status: 'khô ráo' });

  startClutch(cages[1], -30, -29, S(1), 'Quả đầu tiên');
  log(cages[1], -20, S(6, 5, 1, 0, 0, 0, 0), 'Soi trứng');
  log(cages[1], -6, S(6, 5, 1, 1, 4, 4, 0), 'Nở 4 con, 1 trứng chết phôi');
  log(cages[1], -1, S(6, 5, 1, 1, 4, 4, 0), 'Chim non ăn tốt. Bố mớm mồi đều, cần bổ sung thức ăn mềm buổi chiều.');

  startClutch(cages[2], -10, -9, S(2), '');
  log(cages[2], -5, S(4, 3, 0, 0, 0, 0, 0), 'Soi được 3 có cồ, 1 chưa rõ');
  // L03: lâu chưa cập nhật (5 ngày)

  startClutch(cages[3], -40, -38, S(3), '');
  log(cages[3], -25, S(5, 2, 3, 0, 0, 0, 0), 'Nhiều trứng không cồ');
  log(cages[3], -12, S(5, 2, 3, 1, 1, 1, 0), 'Nở 1, hỏng 1');
  log(cages[3], 0, S(5, 2, 3, 1, 1, 1, 0), 'Mái có vẻ mệt, giảm mớm mồi', { parents_status: 'không mớm mồi' });

  // L05, L06: đang nghỉ (từ lứa cũ) — L05 nghỉ lâu
  log(cages[4], -2, S(), 'Cặp khoẻ, chưa vào tổ');
  log(cages[5], -1, S(), 'Đã thay dăm tổ', { nest_status: 'đã thay dăm' });

  // L07–L10: lứa đang mở các giai đoạn
  startClutch(cages[6], -3, -2, S(2), 'Mới đẻ 2 quả');
  log(cages[6], 0, S(3), '');
  startClutch(cages[7], -22, -21, S(1), '');
  log(cages[7], -12, S(5, 5, 0, 0, 0, 0, 0), 'Tất cả có cồ');
  log(cages[7], -1, S(5, 5, 0, 0, 2, 2, 0), 'Nở 2 con đầu');
  startClutch(cages[8], -35, -34, S(1), '');
  log(cages[8], -15, S(4, 3, 1, 0, 3, 3, 0), '');
  log(cages[8], 0, S(4, 3, 1, 0, 3, 3, 0), '3 non sắp ra ràng');
  startClutch(cages[9], -18, -17, S(1), '');
  log(cages[9], -7, S(4, 0, 4, 0, 0, 0, 0), 'Cả 4 trứng không cồ — theo dõi trống');

  // L11: nghỉ xác nhận, có ngày dự kiến đánh giá đã quá hạn
  apply(planStartRest(db, cages[10].id, { start_date: d(-45), reason: 'Mái thay lông', expected_review_date: d(-10), health_note: 'Rụng lông nhiều' }, ctx(-45)), 'rest L11');
  log(cages[10], -3, S(), 'Lông mọc lại, ăn khá');
  // L12–L15: chưa có dữ liệu nghỉ (Chưa đủ dữ liệu), vài lồng có nhật ký ghi chú
  log(cages[11], -1, S(), 'Cặp mới ghép, đang làm quen');
  log(cages[12], -9, S(), 'Chưa thấy vào tổ');

  // Chim giống tuyển từ lứa cũ (anh chị em ruột để demo kiểm tra huyết thống)
  const c1old = db.clutches.find((x) => x.cage_id === cages[0].id && x.status === 'closed');
  const c2old = db.clutches.find((x) => x.cage_id === cages[1].id && x.status === 'closed');
  const p1 = db.pairs.find((p) => p.cage_id === cages[0].id);
  const p2 = db.pairs.find((p) => p.cage_id === cages[1].id);
  apply(planMovement(db, { type: 'in_other', date: d(-60), qty: 4, to_pen_id: 'pen-2', note: 'Nhận lại chim lớn (demo)' }, ctx(-60)), 'in other');
  const sel = (code, sex, conf, cl, p, ph) => db.birds.push({ id: uid(), ring_code: code, sex, sex_confidence: conf, phenotype: ph, mutation: '', mutation_verified: false,
    father_id: p.male_id, mother_id: p.female_id, origin_cage_id: cl.cage_id, origin_clutch_id: cl.id, origin: 'farm', selected_date: d(-30), status: 'holding', photo_ids: [], note: 'Tuyển từ lứa cũ (demo)', created_at: `${d(-30)}T00:00:00Z` });
  sel('DM-26-001', 'male', 'visual', c1old, p1, 'Xanh lá');
  sel('DM-26-002', 'female', 'visual', c1old, p1, 'Vàng mặt');
  sel('DM-26-003', 'female', 'guess', c2old, p2, 'Xanh da trời');
  sel('DM-26-004', 'unknown', null, c2old, p2, 'Xám');
  db.stock_movements.push({ id: uid(), type: 'select_breeder', date: d(-30), qty: 4, from_pen_id: 'pen-2', to_pen_id: null, note: 'Tuyển 4 con làm giống: DM-26-001…004', created_at: `${d(-30)}T00:00:00Z` });
  bird({ ring_code: 'DM-B10', sex: 'male', sex_confidence: 'dna', phenotype: 'Opaline xám', note: 'Mua về làm giống (demo)' });

  // Sức khoẻ
  const hc = apply(planHealthCase(db, { cage_id: cages[3].id, detected_date: d(-2), affected_count: 1, symptoms: 'Mái xù lông, ít ăn, giảm mớm mồi', isolation_status: 'monitoring', assignee: 'Nhân viên (demo)' }, ctx(-2)), 'health');
  apply(planHealthFollowup(db, hc.record.id, { date: d(-1), note: 'Ăn được ít hạt, uống nước bình thường' }, ctx(-1)), 'fu');

  // Khách hàng & đơn hàng
  const cust = ['Anh Minh (demo)', 'Chị Lan (demo)', 'Cửa hàng Chim Cảnh X (demo)', 'Anh Tuấn (demo)']
    .map((name, i) => { const c = { id: uid(), name, phone: `09000000${10 + i}`, province: ['Lâm Đồng', 'TP.HCM', 'Bình Dương', 'Đắk Lắk'][i], note: '', created_at: `${d(-90)}T00:00:00Z` }; db.customers.push(c); return c; });
  const o1 = apply(planOrderSave(db, { date: d(-25), customer_id: cust[0].id, items: [{ kind: 'pen', pen_id: 'pen-2', qty: 2, unit_price: 700000, description: 'Cặp chim lớn' }], shipping: { carrier: 'Xe khách (demo)', fee_charged: 0 } }, ctx(-25)), 'o1');
  apply(planOrderStatus(db, o1.record.id, 'confirmed', ctx(-25)), 'o1c');
  apply(planPayment(db, { order_id: o1.record.id, kind: 'payment', amount: 1400000, date: d(-25), method: 'transfer' }, ctx(-25)), 'o1p');
  apply(planOrderStatus(db, o1.record.id, 'completed', ctx(-24)), 'o1done');
  const o2 = apply(planOrderSave(db, { date: d(-3), customer_id: cust[1].id, items: [{ kind: 'pen', pen_id: 'pen-1', qty: 4, unit_price: 400000, description: 'Chim tơ' }], shipping: { carrier: 'Xe khách (demo)', fee_charged: 50000 } }, ctx(-3)), 'o2');
  apply(planPayment(db, { order_id: o2.record.id, kind: 'deposit', amount: 500000, date: d(-3), method: 'transfer' }, ctx(-3)), 'o2d');
  apply(planOrderStatus(db, o2.record.id, 'confirmed', ctx(-2)), 'o2c');
  const o3 = apply(planOrderSave(db, { date: d(-8), customer_id: cust[2].id, items: [{ kind: 'pen', pen_id: 'pen-2', qty: 1, unit_price: 800000 }] }, ctx(-8)), 'o3');
  apply(planOrderStatus(db, o3.record.id, 'confirmed', ctx(-8)), 'o3c');
  apply(planPayment(db, { order_id: o3.record.id, kind: 'deposit', amount: 200000, date: d(-8) }, ctx(-8)), 'o3d');
  apply(planOrderStatus(db, o3.record.id, 'cancelled', ctx(-6), 'Khách đổi ý (demo)'), 'o3x');
  apply(planPayment(db, { order_id: o3.record.id, kind: 'refund', amount: 200000, date: d(-6) }, ctx(-6)), 'o3r');
  apply(planOrderSave(db, { date: d(0), customer_id: cust[3].id, items: [{ kind: 'pen', pen_id: 'pen-1', qty: 2, unit_price: 450000 }], note: 'Báo giá, chờ khách xác nhận' }, ctx(0)), 'o4');

  // Chi phí thường kỳ 6 tháng
  for (let m = 5; m >= 0; m--) {
    const day = -m * 30 - 3;
    apply(planTransaction(db, { type: 'expense', amount: 2000000, date: d(day), category: 'Lương', description: 'Lương nhân viên (demo)' }, ctx(day)), 'tx');
    apply(planTransaction(db, { type: 'expense', amount: 750000 + (m % 3) * 50000, date: d(day + 1), category: 'Thức ăn', description: 'Bắp nếp, hạt kê (demo)' }, ctx(day + 1)), 'tx');
    if (m % 2 === 0) apply(planTransaction(db, { type: 'expense', amount: 120000, date: d(day + 2), category: 'Vật tư', description: 'Dăm bào, giấy lót (demo)' }, ctx(day + 2)), 'tx');
    if (m >= 1 && m <= 4) apply(planTransaction(db, { type: 'income', amount: 1200000 + m * 300000, date: d(day + 5), category: 'Bán chim', description: 'Bán chim lẻ tại trại (demo)' }, ctx(day + 5)), 'tx');
  }

  buildDemoInventory(db, today);

  // Danh mục công khai (trang Public)
  db.listings.push(
    { id: uid(), title: 'Yến Phụng tơ (mới tách mẹ)', price_text: 'Liên hệ', note: 'Đã tự ăn, khoẻ mạnh', published: true },
    { id: uid(), title: 'Yến Phụng lớn — cặp phổ thông', price_text: 'Liên hệ', note: 'Nhiều màu', published: true },
    { id: uid(), title: 'Yến Phụng làm giống', price_text: 'Liên hệ', note: 'Có hồ sơ bố mẹ', published: true },
  );
  return db;
}

/** Kho & thức ăn DEMO (tên vật tư theo App cũ, số liệu giả lập). Dùng chung khi tạo mới & khi nâng cấp dữ liệu demo cũ. */
export function buildDemoInventory(db, today) {
  const d = (n) => addDays(today, n);
  const ctx = (n = 0) => ({ today: d(n), now: `${d(n)}T02:00:00.000Z`, actor: 'demo-owner' });
  const run = (r, label) => {
    if (r.errors?.length) throw new Error(`Seed kho lỗi (${label}): ${r.errors.join('; ')}`);
    for (const o of r.ops) { const l = db[o.table]; const i = l.findIndex((x) => x.id === o.record.id); if (i >= 0) l[i] = o.record; else l.push(o.record); }
    return r;
  };
  const items = {};
  for (const [name, category, unit, threshold, est] of [
    ['Hạt kê', 'Thức ăn', 'kg', 5, 0.6], ['Hạt láng', 'Thức ăn', 'kg', 2, 0.2], ['Bắp nếp', 'Thức ăn', 'trái', 10, 5],
    ['Mai mực', 'Thức ăn', 'kg', 1, null], ['Khoáng', 'Thuốc / khoáng', 'gói', 1, null], ['Dăm bào', 'Vật tư', 'gói', 1, null], ['Giấy báo', 'Vật tư', 'kg', 1, null],
  ]) items[name] = run(planItemSave(db, { name, category, unit, threshold, daily_use_estimate: est, note: 'Dữ liệu demo' }, ctx(-60)), name).record.id;
  const mv = (n, input, label) => run(planInvMovement(db, { date: d(n), ...input }, ctx(n)), label);
  mv(-60, { item_id: items['Hạt kê'], type: 'opening', qty: 12, note: 'Tồn đầu kỳ (demo)' }, 'o1');
  mv(-60, { item_id: items['Hạt láng'], type: 'opening', qty: 4, note: 'Tồn đầu kỳ (demo)' }, 'o2');
  mv(-60, { item_id: items['Mai mực'], type: 'opening', qty: 3.5 }, 'o3');
  mv(-60, { item_id: items['Bắp nếp'], type: 'opening', qty: 25 }, 'o7');
  mv(-60, { item_id: items['Khoáng'], type: 'opening', qty: 3 }, 'o4');
  mv(-60, { item_id: items['Dăm bào'], type: 'opening', qty: 5 }, 'o5');
  mv(-60, { item_id: items['Giấy báo'], type: 'opening', qty: 4 }, 'o6');
  mv(-40, { item_id: items['Hạt kê'], type: 'purchase', pack_qty: 1, pack_size: 25, total_cost: 450000, supplier: 'Đại lý hạt (demo)', finance: 'create' }, 'p1');
  mv(-40, { item_id: items['Hạt láng'], type: 'purchase', qty: 10, total_cost: 400000, supplier: 'Đại lý hạt (demo)', finance: 'create' }, 'p2');
  // Liên kết với khoản chi "Bắp nếp, hạt kê (demo)" ĐÃ CÓ trong Tài chính => không cộng trùng
  const linkTx = db.transactions.filter((t) => t.description?.startsWith('Bắp nếp') && !t.deleted).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (linkTx) mv(linkTx.date > d(0) ? 0 : Math.round((Date.parse(linkTx.date) - Date.parse(d(0))) / 86400000), { item_id: items['Bắp nếp'], type: 'purchase', qty: 30, total_cost: linkTx.amount, finance: 'link', link_transaction_id: linkTx.id, note: 'Đã ghi chi ở Tài chính' }, 'p3');
  for (let w = 8; w >= 1; w--) {
    mv(-w * 7, { item_id: items['Hạt kê'], type: 'use', qty: 3.5 }, `u${w}`);
    if (w % 2 === 0) mv(-w * 7, { item_id: items['Hạt láng'], type: 'use', qty: 1.2 }, `ul${w}`);
    if (w <= 3) mv(-w * 7 + 1, { item_id: items['Bắp nếp'], type: 'use', qty: 7 }, `ub${w}`);
  }
  mv(-20, { item_id: items['Khoáng'], type: 'use', qty: 2 }, 'uk');
  mv(-12, { item_id: items['Giấy báo'], type: 'loss', qty: 0.5, note: 'Ẩm mốc (demo)' }, 'lg');
  mv(-5, { item_id: items['Hạt kê'], type: 'count', counted_qty: 8.5, note: 'Kiểm kê định kỳ (demo)' }, 'c1');
  mv(-3, { item_id: items['Dăm bào'], type: 'use', qty: 4 }, 'ud');
  return items;
}
