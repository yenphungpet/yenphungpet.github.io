import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, empty, badge, thumb } from '../ui/components.js';
import { photoPickerHtml, mountPhotoPicker, photosReady } from '../ui/photo-picker.js';
import { ISOLATION, planHealthCase, planHealthFollowup, followupsOf } from '../domain/health.js';
import { fmtDate, fmtDateTime, daysBetween } from '../core/dates.js';

const DISCLAIMER = 'Ứng dụng chỉ ghi nhận quan sát và theo dõi. Không chẩn đoán bệnh, không chỉ định thuốc — hãy hỏi ý kiến bác sĩ thú y khi cần.';

function where(s, h) {
  if (h.cage_id) return `Lồng SS ${s.byId('cages', h.cage_id)?.code || '?'}`;
  if (h.pen_id) return s.byId('flight_pens', h.pen_id)?.name || 'Lồng phóng';
  return h.location || '—';
}

export function renderList(app, _p, query) {
  const s = app.store;
  const tab = query.tab === 'closed' ? 'closed' : 'open';
  const list = s.db.health_cases.filter((h) => !h.deleted && (tab === 'open' ? h.status !== 'closed' : h.status === 'closed'))
    .sort((a, b) => b.detected_date.localeCompare(a.detected_date));
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Sức khoẻ & cách ly</h1><div class="sub">Theo dõi theo lồng</div></div>
        ${s.can('health.write') ? html`<button class="btn primary sm" data-new>${icon('plus')} Ghi nhận</button>` : ''}</div>
      <div class="msg info" style="margin-bottom:12px">${icon('info')} ${DISCLAIMER}</div>
      <div class="tabs"><a class="tab ${tab === 'open' ? 'active' : ''}" href="#/health">Đang theo dõi</a><a class="tab ${tab === 'closed' ? 'active' : ''}" href="#/health?tab=closed">Đã đóng</a></div>
      <div class="card">${list.length ? html`<div class="list">${list.map((h) => html`<a class="row" href="#/health/${h.id}"><span class="row-icon red">${icon('heart')}</span>
        <span class="grow"><span class="title">${h.symptoms}</span><br><span class="desc">${where(s, h)} · ${h.affected_count} con · phát hiện ${fmtDate(h.detected_date)} (${daysBetween(h.detected_date, s.today())} ngày)</span></span>
        ${badge(ISOLATION[h.isolation_status], h.isolation_status === 'isolated' ? 'danger' : 'warn')}</a>`)}</div>` : empty(tab === 'open' ? 'Không có hồ sơ đang theo dõi.' : 'Chưa có hồ sơ đã đóng.')}</div>`,
    mount(root) { root.querySelector('[data-new]')?.addEventListener('click', () => openHealthForm(app, null, {})); },
  };
}

export function renderDetail(app, { id }) {
  const s = app.store;
  const h = s.byId('health_cases', id);
  if (!h) return { html: empty('Không tìm thấy hồ sơ.') };
  const fus = followupsOf(s.db, id);
  const canW = s.can('health.write');
  return {
    html: html`<div class="page-head"><a class="back" href="#/health">${icon('back')}</a><div class="grow"><h1>Hồ sơ sức khoẻ</h1><div class="sub">${where(s, h)} · ${h.status === 'closed' ? 'Đã đóng' : 'Đang theo dõi'}</div></div>
        ${canW && h.status !== 'closed' ? html`<button class="btn soft sm" data-edit>${icon('edit')} Sửa</button>` : ''}</div>
      <div class="card"><dl class="kv">
        <dt>Ngày phát hiện</dt><dd>${fmtDate(h.detected_date)}</dd><dt>Lồng liên quan</dt><dd>${h.cage_id ? html`<a href="#/cage/${h.cage_id}">${where(s, h)}</a>` : where(s, h)}</dd>
        <dt>Số chim ảnh hưởng</dt><dd>${h.affected_count}</dd><dt>Triệu chứng quan sát</dt><dd style="white-space:pre-wrap">${h.symptoms}</dd>
        <dt>Cách ly</dt><dd>${ISOLATION[h.isolation_status]}</dd><dt>Người phụ trách</dt><dd>${h.assignee || '—'}</dd>
        <dt>Kết quả thú y</dt><dd style="white-space:pre-wrap">${h.vet_result || 'Chưa có'}</dd>
        ${h.status === 'closed' ? html`<dt>Đóng hồ sơ</dt><dd>${fmtDate(h.closed_date)} · ${h.outcome}</dd>` : ''}</dl>
        ${h.photo_ids?.length ? html`<div class="thumbs">${h.photo_ids.map((p) => thumb(p))}</div>` : ''}</div>
      <p class="def">${DISCLAIMER}</p>
      <div class="section"><h2>Lịch sử theo dõi</h2></div>
      ${canW && h.status !== 'closed' ? html`<button class="btn primary block" data-fu style="margin-bottom:10px">${icon('plus')} Thêm theo dõi</button>` : ''}
      ${fus.length ? html`<div class="timeline">${fus.map((f) => html`<div class="tl-item"><div class="tl-head"><b>${fmtDate(f.date)}</b>${badge(ISOLATION[f.isolation_status], 'muted')}</div>
        <div class="tl-note">${f.note}</div>${f.vet_result ? html`<div class="small">Thú y: ${f.vet_result}</div>` : ''}
        ${f.photo_ids?.length ? html`<div class="thumbs">${f.photo_ids.map((p) => thumb(p))}</div>` : ''}<div class="tl-meta">Ghi lúc ${fmtDateTime(f.created_at)}</div></div>`)}</div>` : empty('Chưa có lần theo dõi.')}`,
    mount(root) {
      root.querySelector('[data-edit]')?.addEventListener('click', () => openHealthForm(app, id, {}));
      root.querySelector('[data-fu]')?.addEventListener('click', () => openFollowup(app, id));
    },
  };
}

export function openHealthForm(app, id, defaults = {}) {
  const s = app.store;
  const h = id ? s.byId('health_cases', id) : null;
  const v0 = { ...defaults, ...(h || {}) };
  let picker;
  openSheet({
    title: h ? 'Sửa hồ sơ sức khoẻ' : 'Ghi nhận vấn đề sức khoẻ',
    body: html`<form class="form" data-f>
      <div class="msg info">${icon('info')} ${DISCLAIMER}</div>
      <div class="grid2">${field('Ngày phát hiện', html`<input type="date" name="detected_date" value="${v0.detected_date || s.today()}" max="${s.today()}">`)}
        ${field('Số chim bị ảnh hưởng', html`<input type="number" name="affected_count" min="1" inputmode="numeric" value="${v0.affected_count || 1}">`)}</div>
      <div class="grid2">${field('Lồng sinh sản', html`<select name="cage_id"><option value="">—</option>${options(Object.fromEntries(s.db.cages.filter((c) => !c.archived).map((c) => [c.id, c.code])), v0.cage_id)}</select>`)}
        ${field('Hoặc lồng phóng', html`<select name="pen_id"><option value="">—</option>${options(Object.fromEntries(s.db.flight_pens.map((p) => [p.id, p.name])), v0.pen_id)}</select>`)}</div>
      ${field('Vị trí khác (nếu có)', html`<input name="location" value="${v0.location || ''}" placeholder="VD: Lồng Chim Giống, lồng cách ly">`)}
      ${field('Triệu chứng quan sát', html`<textarea name="symptoms" rows="3" placeholder="Mô tả những gì thấy: xù lông, bỏ ăn, phân lỏng…">${v0.symptoms || ''}</textarea>`)}
      <div class="grid2">${field('Trạng thái cách ly', html`<select name="isolation_status">${options(ISOLATION, v0.isolation_status || 'monitoring')}</select>`)}
        ${field('Người phụ trách', html`<input name="assignee" value="${v0.assignee || ''}">`)}</div>
      ${field('Kết quả kiểm tra thú y (nếu có)', html`<textarea name="vet_result" rows="2">${v0.vet_result || ''}</textarea>`)}
      <div class="field"><span>Ảnh</span>${photoPickerHtml(h?.photo_ids || [])}</div>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onClose: () => picker?.dispose(),
    onMount: (el, close) => {
      picker = mountPhotoPicker(el.querySelector('[data-photo-picker]'), s);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const msg = el.querySelector('[data-msg]');
        const pErr = await photosReady(picker, e.currentTarget);
        if (pErr.length) return showMessages(msg, pErr);
        const v = formValues(el.querySelector('[data-f]'));
        const r = await s.run(planHealthCase(s.db, { ...v, id: h?.id, photo_ids: picker.ids() }, s.ctx()), { requires: 'health.write' });
        if (!r.ok) return showMessages(msg, r.errors);
        toast('Đã lưu hồ sơ sức khoẻ'); close();
        if (!h) app.navigate(`#/health/${r.record.id}`);
      }));
    },
  });
}

function openFollowup(app, caseId) {
  const s = app.store;
  const h = s.byId('health_cases', caseId);
  let picker;
  openSheet({
    title: 'Thêm theo dõi', subtitle: h.symptoms,
    body: html`<form class="form" data-f>
      <div class="grid2">${field('Ngày', html`<input type="date" name="date" value="${s.today()}" max="${s.today()}">`)}
        ${field('Cách ly', html`<select name="isolation_status">${options(ISOLATION, h.isolation_status)}</select>`)}</div>
      ${field('Diễn biến quan sát', html`<textarea name="note" rows="3"></textarea>`)}
      ${field('Kết quả thú y (nếu có)', html`<textarea name="vet_result" rows="2"></textarea>`)}
      <div class="field"><span>Ảnh</span>${photoPickerHtml()}</div>
      <label class="check"><input type="checkbox" name="close" data-close-case> Đóng hồ sơ (đã ổn định / kết thúc theo dõi)</label>
      ${field('Kết quả khi đóng', html`<input name="outcome" placeholder="VD: Hồi phục, trả về lồng">`)}
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Lưu</button>`,
    onClose: () => picker?.dispose(),
    onMount: (el, close) => {
      picker = mountPhotoPicker(el.querySelector('[data-photo-picker]'), s);
      el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const msg = el.querySelector('[data-msg]');
        const pErr = await photosReady(picker, e.currentTarget);
        if (pErr.length) return showMessages(msg, pErr);
        const v = formValues(el.querySelector('[data-f]'));
        const r = await s.run(planHealthFollowup(s.db, caseId, { ...v, photo_ids: picker.ids() }, s.ctx()), { requires: 'health.write' });
        if (!r.ok) return showMessages(msg, r.errors);
        toast('Đã lưu theo dõi'); close();
      }));
    },
  });
}
