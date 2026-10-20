import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, stepper, options, showMessages, formValues, busy, toast, confirmDialog } from '../ui/components.js';
import { photoPickerHtml, mountPhotoPicker, photosReady } from '../ui/photo-picker.js';
import {
  SNAPSHOT_FIELDS, PARENT_STATUS, NEST_STATUS, planDailySave, planCloseClutch, planStartRest, planUpdateRest,
  planDeleteLog, planEditClutchStart, clutchForDate, logsOfClutch, pickSnapshot, snapshotDelta, describeDelta,
  clutchSummary, currentPair, validateSnapshot,
} from '../domain/breeding.js';
import { fmtDate, addDays, isISODate } from '../core/dates.js';
import { toInt } from '../core/format.js';
import { uid } from '../core/ids.js';
import { openPairSheet } from './pairing-sheet.js';
import { noteList } from './notes-ui.js';
import { notesOfLog } from '../domain/notes.js';

const HINTS = {
  eggs: 'Tổng trứng của lứa', fertile: 'Tổng đã soi có cồ', infertile: 'Tổng đã soi không cồ', damaged: 'Vỡ / chết phôi',
  hatched: 'Tổng đã nở', chicks: 'Đang có trong lồng', fledged: 'Tổng đã ra ràng',
};
const LABELS = { eggs: 'Trứng đã đẻ', fertile: 'Trứng có cồ', infertile: 'Trứng không cồ', damaged: 'Trứng hỏng', hatched: 'Trứng đã nở', chicks: 'Chim non hiện tại', fledged: 'Chim đã ra ràng' };

/** Cập nhật hôm nay / Sửa nhật ký. opts: { date } hoặc { logId } */
export function openDailyForm(app, cageId, opts = {}) {
  const store = app.store;
  if (!store.can('breeding.write')) { toast('Vai trò hiện tại không được ghi nhật ký', 'error'); return; }
  const cage = store.byId('cages', cageId);
  let state = { date: opts.date || store.today(), logId: opts.logId || null };
  if (state.logId) state.date = store.byId('daily_logs', state.logId)?.log_date || state.date;
  let picker = null;
  let ackWarnings = false;
  let openedVersion = null; // phiên bản bản ghi lúc mở biểu mẫu (chống ghi đè khi thiết bị khác vừa sửa)

  const ctxFor = (date, logId) => {
    const db = store.db;
    const existing = logId ? db.daily_logs.find((l) => l.id === logId && !l.deleted)
      : db.daily_logs.find((l) => l.cage_id === cageId && l.log_date === date && !l.deleted);
    const clutch = existing?.clutch_id ? store.byId('clutches', existing.clutch_id) : clutchForDate(db.clutches, cageId, date);
    const prev = clutch ? logsOfClutch(db.daily_logs, clutch.id).filter((l) => l.log_date < date).pop() || null : null;
    const values = existing ? pickSnapshot(existing) : pickSnapshot(clutch ? (logsOfClutch(db.daily_logs, clutch.id).filter((l) => l.log_date <= date).pop()) : null);
    return { existing, clutch, prev, values };
  };

  const body = () => {
    const c = ctxFor(state.date, state.logId);
    const ex = c.existing;
    const noPair = !c.clutch && !currentPair(store.db.pairs, cageId);
    openedVersion = ex ? (ex.version || 0) : null;
    return html`<form class="form" data-daily novalidate>
      <div class="grid2">
        ${field('Ngày cập nhật', html`<input type="date" name="log_date" value="${state.date}" max="${store.today()}" required>`)}
        <div class="field"><span>Chế độ</span><div class="badge ${ex ? 'warn' : 'ok'}" style="min-height:48px;justify-content:center;font-size:13px">${ex ? `Sửa bản ghi ${fmtDate(ex.log_date)}` : 'Bản ghi mới'}</div></div>
      </div>
      ${ex ? html`<div class="msg info">${icon('info')} Ngày này đã có nhật ký. Lưu sẽ CẬP NHẬT bản ghi cũ (giữ nguyên ID), không tạo bản ghi trùng.</div>` : ''}
      ${noPair ? html`<div class="msg warn">${icon('info')} <div>Lồng <b>${cage.code}</b> chưa ghép cặp bố mẹ nên chưa ghi được trứng/lứa. Bạn vẫn có thể ghi <b>ghi chú và ảnh</b>. <button type="button" class="btn soft sm" data-go-pair style="margin-top:6px">${icon('plus')} Ghép cặp ngay</button></div></div>`
        : c.clutch ? html`<div class="msg ok">${icon('egg')} Lứa <b>${c.clutch.code}</b> · bắt đầu ${fmtDate(c.clutch.start_date)}${c.clutch.status === 'closed' ? ' (đã kết thúc)' : ''}</div>`
        : html`<fieldset class="fieldset"><legend>Lứa sinh sản</legend>
          <p class="small muted" style="margin:0">Lồng chưa có lứa đang theo dõi vào ngày này. Nếu đã có trứng, bật "Bắt đầu lứa mới". Nếu chỉ ghi chú, để tất cả số = 0.</p>
          <label class="check"><input type="checkbox" name="new_clutch"> Bắt đầu lứa mới</label>
          ${field('Ngày bắt đầu lứa', html`<input type="date" name="first_egg" value="${state.date}" max="${state.date}">`, 'Mặc định là ngày cập nhật (thường là hôm nay). Lứa bắt đầu từ trước thì chọn ngày cũ hơn. Nhập nhầm: chủ trại sửa lại trong Chi tiết lứa.')}
        </fieldset>`}
      <fieldset class="fieldset ${noPair ? 'hidden' : ''}"><legend>Số liệu TỔNG của lứa (tính đến ngày này)</legend>
        <p class="small muted" style="margin:0">Nhập con số tổng hiện tại, không nhập số phát sinh trong ngày. ${ex ? 'Đang hiển thị số đã lưu của ngày này.' : c.prev ? `Đã điền sẵn theo lần ghi ${fmtDate(c.prev.log_date)} — chỉ sửa ô có thay đổi.` : ''}</p>
        ${SNAPSHOT_FIELDS.map((f) => stepper(f, LABELS[f], c.values[f], { hint: HINTS[f] }))}
        <div class="delta-preview" data-delta></div>
      </fieldset>
      <div class="grid2">
        ${field('Bố mẹ', html`<select name="parents_status">${options(PARENT_STATUS, ex?.parents_status || 'bình thường')}</select>`)}
        ${field('Tổ', html`<select name="nest_status">${options(NEST_STATUS, ex?.nest_status || 'bình thường')}</select>`)}
      </div>
      ${(() => { const old = ex ? notesOfLog(store.db, ex) : []; return old.length ? html`<div class="field"><span>Ghi chú đã có ngày này (${old.length})</span>${noteList(store, old)}</div>` : ''; })()}
      ${field(ex ? 'Thêm ghi chú mới (tuỳ chọn)' : 'Ghi chú (tuỳ chọn)', html`<textarea name="note" rows="3" maxlength="2000" autocapitalize="sentences" enterkeyhint="done" placeholder="VD: Mái ấp đều, soi thấy 3 trứng có cồ…"></textarea>`, 'Mỗi lần lưu là 1 ghi chú mới, không ghi đè ghi chú cũ. Ghi chú mới nhất hiện ngay trên thẻ lồng.')}
      <label class="check"><input type="checkbox" name="note_action"> Cần xử lý (hiện ở “Việc cần làm hôm nay” tới khi xác nhận xong)</label>
      <div class="field"><span>Ảnh</span>${photoPickerHtml(ex?.photo_ids || [])}</div>
      <div class="form-msg" data-msg></div>
    </form>`;
  };

  const footer = () => html`
    ${state.logId || ctxFor(state.date).existing ? (store.can('delete') ? html`<button class="btn ghost" data-del>${icon('trash')}</button>` : '') : ''}
    <button class="btn ghost" data-close>Huỷ</button>
    <button class="btn primary" data-save>${icon('check')} Lưu nhật ký</button>`;

  openSheet({
    title: opts.logId ? `Sửa nhật ký · ${cage.code}` : `Cập nhật hôm nay · ${cage.code}`,
    subtitle: currentPair(store.db.pairs, cageId) ? `♂ ${store.birdName(currentPair(store.db.pairs, cageId).male_id)} × ♀ ${store.birdName(currentPair(store.db.pairs, cageId).female_id)}` : 'Chưa ghép cặp',
    body: body(), footer: footer(),
    onClose: () => picker?.dispose(),
    onMount: (el, close) => {
      const wire = () => {
        const form = el.querySelector('[data-daily]');
        picker = mountPhotoPicker(form.querySelector('[data-photo-picker]'), store);
        const updDelta = () => {
          const c = ctxFor(state.date, state.logId);
          const v = formValues(form);
          const s = {}; SNAPSHOT_FIELDS.forEach((f) => { s[f] = toInt(v[f], -1); });
          const errs = validateSnapshot(s);
          const dEl = form.querySelector('[data-delta]');
          if (errs.length) { dEl.innerHTML = `<b style="color:var(--red)">${errs[0]}</b>`; return; }
          if (!c.clutch && s.eggs > 0) { const nc = form.querySelector('[name=new_clutch]'); if (nc && !nc.checked) nc.checked = true; }
          const d = describeDelta(snapshotDelta(c.prev, s));
          dEl.textContent = c.prev ? (d ? `Biến động so với ${fmtDate(c.prev.log_date)}: ${d}` : `Không đổi so với ${fmtDate(c.prev.log_date)}`) : (d ? `Biến động: ${d}` : 'Chưa có số liệu');
        };
        form.addEventListener('input', (e) => { ackWarnings = false; el.querySelector('[data-save]').innerHTML = `${icon('check')} Lưu nhật ký`; if (e.target.name !== 'log_date') updDelta(); });
        form.querySelector('[name=log_date]').addEventListener('change', (e) => {
          if (!isISODate(e.target.value)) return;
          picker?.dispose();
          state = { date: e.target.value, logId: null };
          el.querySelector('.sheet-body').innerHTML = String(body());
          el.querySelector('.sheet-foot').innerHTML = String(footer());
          wire();
        });
        updDelta();
      };
      wire();
      el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-go-pair]')) { close(); openPairSheet(app, cageId); return; }
        if (e.target.closest('[data-del]')) {
          const c = ctxFor(state.date, state.logId);
          if (!c.existing) return;
          if (!(await confirmDialog(`Xoá nhật ký ngày ${fmtDate(c.existing.log_date)} của ${cage.code}? Bản ghi được xoá mềm và lưu vết trong nhật ký thay đổi.`, { danger: true, ok: 'Xoá' }))) return;
          const r = await store.run(planDeleteLog(store.db, c.existing.id, store.ctx()), { requires: 'delete' });
          if (r.ok) { toast('Đã xoá nhật ký'); close(); } else toast(r.errors.join('; '), 'error');
          return;
        }
        const btn = e.target.closest('[data-save]');
        if (!btn) return;
        const form = el.querySelector('[data-daily]');
        const msg = form.querySelector('[data-msg]');
        await busy(btn, async () => {
          const pErr = await photosReady(picker, btn);
          if (pErr.length) { showMessages(msg, pErr); return; }
          const v = formValues(form);
          const c = ctxFor(state.date, state.logId);
          const snapshot = {}; SNAPSHOT_FIELDS.forEach((f) => { snapshot[f] = toInt(v[f], -1); });
          const input = {
            id: c.existing?.id, cage_id: cageId, log_date: v.log_date, snapshot,
            parents_status: v.parents_status, nest_status: v.nest_status, note: v.note, noteAction: !!v.note_action, photo_ids: picker.ids(),
            newClutch: v.new_clutch ? { start_date: v.first_egg } : null,
            expectedVersion: openedVersion,
          };
          const plan = planDailySave(store.db, input, store.ctx());
          if (plan.errors.length) { showMessages(msg, plan.errors, plan.warnings); return; }
          if (plan.warnings.length && !ackWarnings) {
            ackWarnings = true;
            showMessages(msg, [], [...plan.warnings, 'Kiểm tra lại rồi bấm "Vẫn lưu" nếu số liệu đúng.']);
            setTimeout(() => { btn.innerHTML = `${icon('check')} Vẫn lưu`; }, 0);
            return;
          }
          const r = await store.run(plan, { requires: 'breeding.write' });
          if (!r.ok) { showMessages(msg, r.errors); toast('Lưu thất bại — dữ liệu chưa được ghi', 'error'); return; }
          toast(`${plan.isEdit ? 'Đã cập nhật' : 'Đã lưu'} nhật ký ${cage.code} ngày ${fmtDate(v.log_date)}`);
          close();
        });
      });
    },
  });
}

export function openCloseClutch(app, clutchId) {
  const store = app.store;
  const c = store.byId('clutches', clutchId);
  const sm = clutchSummary(c, store.db.daily_logs);
  openSheet({
    title: `Kết thúc lứa ${c.code}`, subtitle: `Bắt đầu ${fmtDate(c.start_date)}`,
    body: html`<form class="form" data-f>
      <div class="msg info">${icon('egg')} Trứng ${sm.eggs} · có cồ ${sm.fertile} · nở ${sm.hatched} · non hiện tại ${sm.chicks} · ra ràng ${sm.fledged}</div>
      ${sm.chicks > 0 ? html`<div class="msg warn">${icon('alert')} Lứa vẫn còn ${sm.chicks} chim non trong lồng. Nếu đã tách, hãy cập nhật nhật ký (chim non = 0, ra ràng = số đã tách) trước.</div>` : ''}
      ${field('Ngày kết thúc', html`<input type="date" name="end_date" value="${store.today()}" max="${store.today()}">`, 'Với "tách hết chim non": đây là ngày tách con cuối cùng.')}
      ${field('Lý do', html`<select name="end_reason">${options({ weaned: 'Đã tách hết chim non', failed: 'Lứa hỏng / không nở', other: 'Khác' }, 'weaned')}</select>`)}
      <label class="check"><input type="checkbox" name="start_rest" checked> Bắt đầu tính nghỉ đẻ từ ngày kết thúc</label>
      ${field('Đánh giá lại sau (ngày)', html`<input type="number" name="review_days" value="${store.settings.restReviewDays}" min="1" inputmode="numeric">`)}
      ${field('Ghi chú', html`<textarea name="note" rows="2"></textarea>`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Kết thúc lứa</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      const r = await store.run(planCloseClutch(store.db, clutchId, v, store.ctx()), { requires: 'breeding.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast(`Đã kết thúc lứa ${c.code}${v.start_rest ? ' và bắt đầu tính nghỉ đẻ' : ''}`);
      close();
    })),
  });
}

/** Sửa ngày bắt đầu lứa (chỉ chủ trại) — nhập nhầm hoặc nhập dữ liệu lịch sử. Không đổi nhật ký / trứng / chim non / bố mẹ. */
export function openEditClutchStart(app, clutchId) {
  const store = app.store;
  if (!store.can('clutch.edit')) { toast('Chỉ chủ trại được sửa ngày bắt đầu lứa', 'error'); return; }
  const c = store.byId('clutches', clutchId);
  if (!c) { toast('Không tìm thấy lứa', 'error'); return; }
  const openedAt = c.updated_at || null; // chống ghi đè: phiên bản lúc mở biểu mẫu
  const logs = logsOfClutch(store.db.daily_logs, clutchId);
  const sm = clutchSummary(c, store.db.daily_logs);
  const pair = store.byId('pairs', c.pair_id);
  const maxDate = logs.length && logs[0].log_date < store.today() ? logs[0].log_date : store.today();
  let ack = false;
  openSheet({
    title: `Sửa ngày bắt đầu lứa ${c.code}`, subtitle: `Hiện tại: ${fmtDate(c.start_date)}`,
    body: html`<form class="form" data-clutch-start novalidate>
      ${field('Ngày bắt đầu lứa', html`<input type="date" name="start_date" value="${c.start_date}" max="${maxDate}" required>`,
        logs.length ? `Phải từ ngày nhật ký đầu tiên của lứa (${fmtDate(logs[0].log_date)}) trở về trước.` : 'Lứa chưa có nhật ký.')}
      <div class="msg info">${icon('info')} <div>Chỉ đổi ngày bắt đầu. <b>Giữ nguyên</b>: mã lứa ${c.code}; ${logs.length} nhật ký (ngày ghi không đổi);
        trứng ${sm.eggs} · có cồ ${sm.fertile} · nở ${sm.hatched} · non hiện tại ${sm.chicks} · ra ràng ${sm.fledged};
        bố mẹ ${pair ? `♂ ${store.birdName(pair.male_id)} × ♀ ${store.birdName(pair.female_id)}` : 'chưa ghi nhận'}. Lần sửa được lưu vết trong nhật ký thay đổi.</div></div>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu ngày bắt đầu</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('[data-clutch-start]');
      const btn = el.querySelector('[data-save]');
      form.addEventListener('input', () => { ack = false; btn.innerHTML = `${icon('check')} Lưu ngày bắt đầu`; });
      btn.addEventListener('click', () => busy(btn, async () => {
        const msg = form.querySelector('[data-msg]');
        const v = formValues(form);
        const plan = planEditClutchStart(store.db, clutchId, { start_date: v.start_date, expectedUpdatedAt: openedAt }, store.ctx());
        if (plan.errors.length) { showMessages(msg, plan.errors, plan.warnings); return; }
        if ((plan.warnings.length || plan.notes.length) && !ack) {
          ack = true;
          showMessages(msg, [], [...plan.warnings, ...plan.notes, 'Kiểm tra lại rồi bấm "Vẫn lưu" nếu đúng.']);
          setTimeout(() => { btn.innerHTML = `${icon('check')} Vẫn lưu`; }, 0);
          return;
        }
        const r = await store.run(plan, { requires: 'clutch.edit' });
        if (!r.ok) { showMessages(msg, r.errors); toast('Lưu thất bại — dữ liệu chưa được ghi', 'error'); return; }
        toast(`Đã đổi ngày bắt đầu lứa ${c.code}: ${fmtDate(c.start_date)} → ${fmtDate(v.start_date)}`);
        close();
      }));
    },
  });
}

export function openRestForm(app, cageId, restId) {
  const store = app.store;
  const p = restId ? store.byId('rest_periods', restId) : null;
  const today = store.today();
  openSheet({
    title: p ? 'Sửa kỳ nghỉ đẻ' : 'Xác nhận bắt đầu nghỉ', subtitle: store.byId('cages', cageId).code,
    body: html`<form class="form" data-f>
      <div class="grid2">
        ${field('Ngày bắt đầu nghỉ', html`<input type="date" name="start_date" value="${p?.start_date || today}" max="${today}">`)}
        ${field('Dự kiến đánh giá lại', html`<input type="date" name="expected_review_date" value="${p?.expected_review_date || addDays(today, store.settings.restReviewDays)}">`)}
      </div>
      ${field('Lý do nghỉ', html`<input name="reason" value="${p?.reason || ''}" placeholder="VD: Tách hết non, thay lông, phục hồi sức khoẻ…">`)}
      ${field('Ghi chú sức khoẻ', html`<textarea name="health_note" rows="2">${p?.health_note || ''}</textarea>`)}
      ${p ? html`<div class="grid2">${field('Ngày kết thúc', html`<input type="date" name="end_date" value="${p.end_date || ''}" max="${today}">`, 'Thường tự điền = ngày trứng đầu tiên lứa sau')}
        ${field('Lý do kết thúc', html`<input name="end_reason" value="${p.end_reason === 'first_egg' ? 'first_egg' : p.end_reason || ''}">`)}</div>` : ''}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      const plan = p ? planUpdateRest(store.db, p.id, { ...v, end_date: v.end_date || null, end_reason: v.end_reason || null }, store.ctx())
        : planStartRest(store.db, cageId, v, store.ctx());
      const r = await store.run(plan, { requires: 'breeding.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã lưu kỳ nghỉ đẻ'); close();
    })),
  });
}

function birdOptions(store, filter, selected = '') {
  const list = store.db.birds.filter((b) => !b.deleted && filter(b)).sort((a, b) => a.ring_code.localeCompare(b.ring_code));
  return raw(`<option value="">— Chọn cá thể —</option>${list.map((b) => `<option value="${esc(b.id)}"${b.id === selected ? ' selected' : ''}>${String(html`${b.ring_code} · ${b.phenotype || b.mutation || ''} (${b.sex === 'male' ? 'trống' : b.sex === 'female' ? 'mái' : 'chưa rõ'})`)}</option>`).join('')}`);
}

/** Lồng chưa ghép cặp: thông báo rõ ràng + lối đi tiếp (thay cho nút bị vô hiệu im lặng). */
export function openNoPairNotice(app, cageId) {
  const store = app.store;
  const cage = store.byId('cages', cageId);
  const canW = store.can('breeding.write');
  openSheet({
    title: `Lồng ${cage.code} chưa ghép cặp`, size: 'small',
    body: html`<div class="msg warn">${icon('info')} <div>Cần ghép <b>chim trống và chim mái</b> cho lồng này trước khi ghi trứng, lứa và số ngày nghỉ đẻ. Nếu chưa có chim trong danh sách, bạn có thể thêm ngay ở bước ghép cặp.</div></div>
      <p class="small muted" style="margin:10px 0 0">Bạn vẫn có thể ghi ghi chú và ảnh cho lồng (ví dụ: vệ sinh, chuẩn bị tổ).</p>`,
    footer: canW ? html`<button class="btn ghost" data-note-only>${icon('note')} Chỉ ghi ghi chú / ảnh</button><button class="btn primary" data-go-pair>${icon('plus')} Ghép cặp ngay</button>`
      : html`<button class="btn primary" data-close>Đã hiểu</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-go-pair]')?.addEventListener('click', () => { close(); openPairSheet(app, cageId); });
      el.querySelector('[data-note-only]')?.addEventListener('click', () => { close(); openDailyForm(app, cageId, { date: store.today() }); });
    },
  });
}

export function openCageForm(app, cageId) {
  const store = app.store;
  if (!store.can('settings.write')) { toast('Chỉ chủ trại được thêm/sửa lồng', 'error'); return; }
  const c = cageId ? store.byId('cages', cageId) : null;
  openSheet({
    title: c ? `Thông tin lồng ${c.code}` : 'Thêm lồng sinh sản',
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Mã lồng', html`<input name="code" value="${c?.code || ''}" placeholder="VD: L17" required>`)}
        ${field('Thứ tự', html`<input type="number" name="sort" value="${c?.sort ?? store.db.cages.length + 1}" inputmode="numeric">`)}</div>
      ${field('Ghi chú lồng', html`<input name="note" value="${c?.note || ''}" placeholder="Vị trí, loại lồng…">`)}
      ${c ? html`<label class="check"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}> Lưu trữ (ẩn khỏi danh sách & thống kê)</label>` : ''}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onMount: (el, close) => el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const v = formValues(el.querySelector('[data-f]'));
      const code = v.code.trim();
      const errs = [];
      if (!code) errs.push('Nhập mã lồng');
      if (store.db.cages.some((x) => x.id !== c?.id && x.code.toLowerCase() === code.toLowerCase())) errs.push('Mã lồng đã tồn tại');
      if (c && !c.archived && v.archived && (store.db.clutches.some((x) => x.cage_id === c.id && x.status !== 'closed') || currentPair(store.db.pairs, c.id))) errs.push('Lồng còn cặp hoặc lứa đang mở — không thể lưu trữ');
      if (errs.length) return showMessages(el.querySelector('[data-msg]'), errs);
      const now = new Date().toISOString();
      const rec = { ...(c || { id: uid(), created_at: now }), code, name: `Lồng ${code}`, sort: toInt(v.sort, 0), note: v.note.trim(), archived: !!v.archived, updated_at: now };
      const r = await store.run({ ops: [{ table: 'cages', op: 'put', record: rec, before: c }] }, { requires: 'settings.write' });
      if (!r.ok) return showMessages(el.querySelector('[data-msg]'), r.errors);
      toast('Đã lưu lồng'); close();
    })),
  });
}
