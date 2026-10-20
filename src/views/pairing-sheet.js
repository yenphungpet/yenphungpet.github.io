// Màn hình GHÉP CẶP — 1 màn hình, 3 thao tác: chọn trống, chọn mái, "Lưu cặp ghép".
// Lồng đã có cặp: hiện cặp hiện tại + "Thay trống" / "Thay mái" / "Kết thúc cặp".
// Thông tin bổ sung (mã vòng, màu, mutation, độ tin cậy giới tính, lý do) nằm trong "Chi tiết nâng cao".
import { html, raw, esc } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { openSheet, field, options, showMessages, formValues, busy, toast, badge } from '../ui/components.js';
import { currentPair } from '../domain/breeding.js';
import { SEX_CONFIDENCE } from '../domain/breeders.js';
import { slotCandidates, nextInternalCode, pairKinship, sexStateLabel, sexVerified, planCreatePair, planReplaceMate, planEndPair } from '../domain/pairing.js';
import { fmtDate } from '../core/dates.js';

const ROLE = { male: { label: 'Chim trống', short: 'trống', icon: '♂', newLabel: 'Trống mới' }, female: { label: 'Chim mái', short: 'mái', icon: '♀', newLabel: 'Mái mới' } };
const KIN_TONE = { related: 'danger', insufficient: 'warn', not_found: 'ok' };

function birdLine(store, id) {
  const b = store.byId('birds', id);
  if (!b) return html`<span class="muted">Chưa ghi nhận</span>`;
  return html`<b>${b.ring_code}</b>${b.phenotype ? ` · ${b.phenotype}` : ''} ${badge(sexStateLabel(b), sexVerified(b) ? 'ok' : 'warn')}`;
}

function slotSelect(store, role, cage) {
  const list = slotCandidates(store.db, role);
  const code = nextInternalCode(store.db, cage, role);
  const optsHtml = [
    list.length ? `<option value="">— Chọn ${ROLE[role].short} —</option>` : '',
    `<option value="__new__"${list.length ? '' : ' selected'}>＋ ${ROLE[role].newLabel} (tự tạo mã ${esc(code)})</option>`,
    ...list.map((b) => `<option value="${esc(b.id)}">${esc(b.ring_code)}${b.phenotype ? ' · ' + esc(b.phenotype) : ''} — ${esc(sexStateLabel(b))}</option>`),
  ].join('');
  return html`<label class="field pair-slot"><span>${ROLE[role].icon} ${ROLE[role].label}</span><select name="${role}" data-slot="${role}">${raw(optsHtml)}</select>
    <small class="hint" data-slot-hint="${role}"></small></label>`;
}

function advancedNew(role) {
  return html`<fieldset class="fieldset hidden" data-adv="${role}"><legend>${ROLE[role].newLabel} — thông tin thêm</legend>
    <div class="grid2">${field('Mã vòng chân', html`<input name="${role}_ring" placeholder="Để trống = mã tự tạo">`)}${field('Màu / phenotype', html`<input name="${role}_phenotype">`)}</div>
    <div class="grid2">${field('Mutation', html`<input name="${role}_mutation">`)}${field('Độ tin cậy giới tính', html`<select name="${role}_conf">${options({ guess: 'Dự đoán', visual: 'Quan sát ngoại hình', confirmed: 'Đã xác nhận (sinh sản)', dna: 'Xét nghiệm DNA' }, 'guess')}</select>`)}</div>
  </fieldset>`;
}

function slotValue(v, role) {
  const sel = v[role];
  if (!sel) return null;
  if (sel === '__new__') return { isNew: true, ring_code: v[`${role}_ring`], phenotype: v[`${role}_phenotype`], mutation: v[`${role}_mutation`], sex_confidence: v[`${role}_conf`] || 'guess' };
  return { birdId: sel };
}

function kinshipHtml(kin) {
  if (!kin) return '';
  return html`<div class="msg ${kin.result === 'related' ? 'error' : kin.result === 'insufficient' ? 'warn' : 'ok'}" data-kin="${kin.result}">${icon(kin.result === 'not_found' ? 'check' : 'dna')}
    <div><b>Huyết thống:</b> ${kin.message}${kin.findings?.length ? html`<br>${kin.findings.map((f) => html`• ${f.name}${f.ancestor ? ` (tổ tiên chung ${f.ancestor.ring_code})` : ''}<br>`)}` : ''}
    ${kin.result === 'related' ? html`<label class="check" style="margin-top:8px"><input type="checkbox" name="confirmKinship"> Tôi đã biết và vẫn muốn ghép</label>` : ''}</div></div>`;
}

export function openPairSheet(app, cageId, { mode = null } = {}) {
  const store = app.store;
  if (!store.can('breeding.write')) { toast('Vai trò hiện tại không được ghép cặp', 'error'); return; }
  const cage = store.byId('cages', cageId);
  let view = mode || (currentPair(store.db.pairs, cageId) ? 'current' : 'create');

  const body = () => {
    const pair = currentPair(store.db.pairs, cageId);
    if (pair && view === 'create') view = 'current';
    if (!pair && view !== 'create') view = 'create';
    if (view === 'current') {
      const history = store.db.pairs.filter((p) => p.cage_id === cageId && p.end_date && !p.deleted).sort((a, b) => String(b.end_date).localeCompare(String(a.end_date))).slice(0, 5);
      return html`<div class="card flat pair-current">
          <div class="small muted">Cặp hiện tại · từ ${fmtDate(pair.start_date)}</div>
          <div class="pair-row">♂ ${birdLine(store, pair.male_id)}</div>
          <div class="pair-row">♀ ${birdLine(store, pair.female_id)}</div>
        </div>
        <div class="pair-actions">
          <button class="btn soft" data-view="replace-male">${icon('swap')} Thay trống</button>
          <button class="btn soft" data-view="replace-female">${icon('swap')} Thay mái</button>
          <button class="btn ghost danger-text" data-view="end">${icon('x')} Kết thúc cặp</button>
        </div>
        ${history.length ? html`<details class="adv"><summary>Lịch sử cặp của lồng (${history.length})</summary>
          <div class="list">${history.map((p) => html`<div class="row"><span class="grow"><span class="desc">${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}</span><br>♂ ${store.birdName(p.male_id)} × ♀ ${store.birdName(p.female_id)}</span></div>`)}</div></details>` : ''}
        <p class="def">Thay chim hoặc kết thúc cặp không xoá lịch sử: các lứa cũ vẫn giữ đúng bố mẹ.</p>`;
    }
    if (view === 'end') {
      return html`<form class="form" data-f>
        <div class="msg warn">${icon('alert')} <div>Kết thúc cặp ${birdLine(store, pair.male_id)} × ${birdLine(store, pair.female_id)}. Hai chim trở về <b>Lồng Chim Giống</b>; lịch sử cặp và các lứa cũ được giữ nguyên.</div></div>
        ${field('Ngày kết thúc', html`<input type="date" name="date" value="${store.today()}" max="${store.today()}">`)}
        <details class="adv"><summary>Chi tiết nâng cao</summary>${field('Lý do (không bắt buộc)', html`<input name="reason" placeholder="VD: nghỉ dài, không hợp nhau">`)}</details>
        <div class="form-msg" data-msg></div></form>`;
    }
    if (view === 'replace-male' || view === 'replace-female') {
      const role = view === 'replace-male' ? 'male' : 'female';
      return html`<form class="form" data-f>
        <div class="small muted">Đang thay ${ROLE[role].short}: ${birdLine(store, role === 'male' ? pair.male_id : pair.female_id)}</div>
        ${slotSelect(store, role, cage)}
        ${field('Ngày thay', html`<input type="date" name="date" value="${store.today()}" max="${store.today()}">`)}
        <div data-kin-box></div>
        <details class="adv"><summary>Chi tiết nâng cao (không bắt buộc)</summary>
          ${advancedNew(role)}
          ${field('Lý do thay', html`<input name="reason" placeholder="VD: không đạp mái, yếu">`)}
          ${field(`${ROLE[role].label} cũ chuyển về`, html`<select name="old_bird_status">${options({ holding: 'Lồng Chim Giống', isolated: 'Cách ly', retired: 'Ngưng sử dụng', dead: 'Đã chết' }, 'holding')}</select>`)}
        </details>
        <div class="form-msg" data-msg></div></form>`;
    }
    return html`<form class="form" data-f>
      ${slotSelect(store, 'male', cage)}
      ${slotSelect(store, 'female', cage)}
      ${field('Ngày ghép cặp', html`<input type="date" name="start_date" value="${store.today()}" max="${store.today()}">`)}
      <div data-kin-box></div>
      <details class="adv"><summary>Chi tiết nâng cao (không bắt buộc)</summary>
        <p class="small muted" style="margin:6px 0">Chỉ cần khi chọn chim mới và muốn ghi thêm mã vòng, màu, mutation. Có thể bổ sung sau trong hồ sơ chim.</p>
        ${advancedNew('male')}${advancedNew('female')}
      </details>
      <div class="form-msg" data-msg></div></form>`;
  };

  const footer = () => {
    if (view === 'current') return html`<button class="btn primary block" data-close>Xong</button>`;
    const back = currentPair(store.db.pairs, cageId) ? html`<button class="btn ghost" data-view="current">${icon('back')} Quay lại</button>` : html`<button class="btn ghost" data-close>Huỷ</button>`;
    const label = view === 'end' ? 'Xác nhận kết thúc cặp' : view === 'replace-male' ? 'Lưu thay trống' : view === 'replace-female' ? 'Lưu thay mái' : 'Lưu cặp ghép';
    return html`${back}<button class="btn ${view === 'end' ? 'danger' : 'primary'}" data-save>${icon('check')} ${label}</button>`;
  };

  const titleFor = () => ({ current: `Cặp của lồng ${cage.code}`, create: `Ghép cặp · ${cage.code}`, end: `Kết thúc cặp · ${cage.code}`, 'replace-male': `Thay trống · ${cage.code}`, 'replace-female': `Thay mái · ${cage.code}` }[view]);

  openSheet({
    title: titleFor(), body: body(), footer: footer(),
    onMount: (el, close) => {
      const rerender = () => {
        el.querySelector('.sheet-titles h2').textContent = titleFor();
        el.querySelector('.sheet-body').innerHTML = String(body());
        el.querySelector('.sheet-foot').innerHTML = String(footer());
        wire();
      };
      const update = () => {
        const f = el.querySelector('[data-f]');
        if (!f) return;
        const v = formValues(f);
        const pair = currentPair(store.db.pairs, cageId);
        for (const role of ['male', 'female']) {
          const s = f.querySelector(`[data-slot="${role}"]`);
          if (!s) continue;
          const hint = f.querySelector(`[data-slot-hint="${role}"]`);
          const b = s.value && s.value !== '__new__' ? store.byId('birds', s.value) : null;
          hint.textContent = s.value === '__new__' ? 'Hồ sơ mới · giới tính: Dự đoán (có thể xác minh sau)' : b ? `Giới tính: ${sexStateLabel(b)}` : '';
          f.querySelector(`[data-adv="${role}"]`)?.classList.toggle('hidden', s.value !== '__new__');
        }
        // Huyết thống (chỉ tính khi đã chọn đủ 2 vị trí)
        let male = null; let female = null; let maleNew = false; let femaleNew = false;
        const pick = (role) => { const val = v[role]; if (val === '__new__') return [{ id: `new-${role}` }, true]; return [val ? store.byId('birds', val) : null, false]; };
        if (view === 'create') { [male, maleNew] = pick('male'); [female, femaleNew] = pick('female'); }
        if (view === 'replace-male' && pair) { [male, maleNew] = pick('male'); female = store.byId('birds', pair.female_id); }
        if (view === 'replace-female' && pair) { [female, femaleNew] = pick('female'); male = store.byId('birds', pair.male_id); }
        const box = f.querySelector('[data-kin-box]');
        if (box) {
          const kin = male && female && male.id !== female.id ? pairKinship(store.db, male, female, { maleNew, femaleNew }) : null;
          const wasChecked = !!f.querySelector('[name=confirmKinship]')?.checked;
          box.innerHTML = String(kinshipHtml(kin));
          if (wasChecked && f.querySelector('[name=confirmKinship]')) f.querySelector('[name=confirmKinship]').checked = true;
        }
      };
      const wire = () => {
        const f = el.querySelector('[data-f]');
        f?.addEventListener('change', (e) => { if (e.target.matches('[data-slot]')) update(); });
        update();
      };
      el.addEventListener('click', async (e) => {
        const nav = e.target.closest('[data-view]');
        if (nav) { view = nav.dataset.view; rerender(); return; }
        const save = e.target.closest('[data-save]');
        if (!save) return;
        await busy(save, async () => {
          const f = el.querySelector('[data-f]');
          const v = formValues(f);
          let plan;
          if (view === 'create') plan = planCreatePair(store.db, cageId, { male: slotValue(v, 'male'), female: slotValue(v, 'female'), start_date: v.start_date, confirmKinship: !!v.confirmKinship }, store.ctx());
          else if (view === 'end') plan = planEndPair(store.db, cageId, { date: v.date, reason: v.reason }, store.ctx());
          else {
            const role = view === 'replace-male' ? 'male' : 'female';
            plan = planReplaceMate(store.db, cageId, { role, slot: slotValue(v, role), date: v.date, reason: v.reason, old_bird_status: v.old_bird_status, confirmKinship: !!v.confirmKinship }, store.ctx());
          }
          const r = await store.run(plan, { requires: 'breeding.write' });
          if (!r.ok) { showMessages(f.querySelector('[data-msg]'), r.errors); return; }
          (plan.warnings || []).forEach((w) => toast(w, 'warn'));
          if (view === 'create') {
            const made = plan.created?.length ? ` · tạo hồ sơ ${plan.created.map((b) => b.ring_code).join(', ')}` : '';
            toast(`Đã ghép cặp${made}. Giờ có thể "Cập nhật hôm nay".`);
            close();
          } else if (view === 'end') { toast('Đã kết thúc cặp — chim về Lồng Chim Giống'); close(); }
          else { toast(view === 'replace-male' ? 'Đã thay trống' : 'Đã thay mái'); view = 'current'; rerender(); }
        });
      });
      wire();
    },
  });
}
