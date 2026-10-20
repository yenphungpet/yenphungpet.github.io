import { html, raw, esc } from './html.js';
import { icon } from './icons.js';

// ---------------- Toast ----------------
export function toast(msg, type = 'ok', ms = 2800) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'warn' ? 'info' : 'check')}<span>${esc(msg)}</span>`;
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? Math.max(ms, 5000) : ms);
}

// ---------------- Bottom sheet ----------------
const stack = [];
export function openSheet({ title, subtitle = '', body, footer = '', onMount, onClose, size = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = String(html`
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <header class="sheet-head">
        <div class="sheet-grip"></div>
        <div class="sheet-titles"><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>
        <button class="icon-btn" data-close aria-label="Đóng">${icon('x')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      ${footer ? html`<footer class="sheet-foot">${footer}</footer>` : ''}
    </section>`);
  document.body.append(wrap);
  document.body.classList.add('no-scroll');
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    wrap.classList.remove('open');
    const i = stack.indexOf(close); if (i >= 0) stack.splice(i, 1);
    setTimeout(() => { wrap.remove(); if (!stack.length) document.body.classList.remove('no-scroll'); }, 220);
    onClose?.();
  };
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  stack.push(close);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const el = wrap.querySelector('.sheet');
  onMount?.(el, close);
  const first = el.querySelector('input:not([type=hidden]):not([readonly]),select,textarea');
  if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
  return close;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1](); });

export function closeAllSheets() { while (stack.length) stack[stack.length - 1](); }

export function confirmDialog(message, { title = 'Xác nhận', ok = 'Đồng ý', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title, size: 'small',
      body: html`<p class="confirm-msg">${message}</p>`,
      footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button>`,
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); }),
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, label, { placeholder = '', ok = 'Xác nhận', required = true } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title, size: 'small',
      body: html`<label class="field"><span>${label}</span><textarea rows="3" placeholder="${placeholder}" data-v></textarea></label><div class="form-msg" data-msg></div>`,
      footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-ok>${ok}</button>`,
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => {
        const v = el.querySelector('[data-v]').value.trim();
        if (required && !v) { el.querySelector('[data-msg]').innerHTML = '<div class="msg error">Vui lòng nhập nội dung</div>'; return; }
        result = v; close();
      }),
      onClose: () => resolve(result),
    });
  });
}

// ---------------- Form helpers ----------------
export function field(label, control, hint = '', cls = '') {
  return html`<label class="field ${cls}"><span>${label}</span>${control}${hint ? html`<small class="hint">${hint}</small>` : ''}</label>`;
}

export function stepper(name, label, value = 0, { hint = '', min = 0 } = {}) {
  return html`<div class="stepper" data-stepper>
    <span class="stepper-label">${label}${hint ? html`<small>${hint}</small>` : ''}</span>
    <div class="stepper-ctl">
      <button type="button" class="step-btn" data-step="-1" aria-label="Giảm ${label}">${icon('minus')}</button>
      <input type="number" name="${name}" value="${value}" min="${min}" step="1" inputmode="numeric" pattern="[0-9]*" aria-label="${label}">
      <button type="button" class="step-btn" data-step="1" aria-label="Tăng ${label}">${icon('plus')}</button>
    </div>
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const input = b.closest('[data-stepper]').querySelector('input');
  const v = Math.max(Number(input.min || 0), (parseInt(input.value, 10) || 0) + Number(b.dataset.step));
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

export function options(map, selected) {
  const entries = Array.isArray(map) ? map.map((v) => [v, v]) : Object.entries(map);
  return raw(entries.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join(''));
}

export function showMessages(container, errors = [], warnings = []) {
  if (!container) return;
  container.innerHTML = String(html`
    ${errors.length ? html`<div class="msg error" role="alert">${icon('alert')}<ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
    ${warnings.length ? html`<div class="msg warn">${icon('info')}<ul>${warnings.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}`);
  if (errors.length) container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function formValues(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

/** Bọc nút submit: khoá nút khi đang lưu để tránh bấm 2 lần tạo trùng. */
export async function busy(btn, fn, label = 'Đang lưu…') {
  if (btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

export function empty(text, art = '') {
  return html`<div class="empty">${art}<p>${text}</p></div>`;
}

export function badge(text, tone = '') { return html`<span class="badge ${tone}">${text}</span>`; }

export function statTile(label, value, { sub = '', tone = '', href = '', def = '' } = {}) {
  const inner = html`<span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? html`<span class="stat-sub">${sub}</span>` : ''}`;
  return href
    ? html`<a class="stat ${tone}" href="${href}" title="${def}">${inner}</a>`
    : html`<div class="stat ${tone}" title="${def}">${inner}</div>`;
}

export function thumb(photoId, cls = '') {
  return html`<button type="button" class="thumb ${cls}" data-view-photo="${photoId}" aria-label="Xem ảnh"><img data-photo="${photoId}" data-size="thumb" alt="Ảnh" loading="lazy"></button>`;
}
