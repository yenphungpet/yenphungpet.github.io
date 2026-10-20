// Ô chọn/chụp ảnh: xem trước tức thì, xử lý + tải lên nền với thanh tiến trình, báo lỗi & thử lại.
import { html, esc } from './html.js';
import { icon } from './icons.js';
import { PhotoUpload, hydratePhotos } from '../services/photos.js';
import { bytes } from '../core/format.js';
import { openSheet } from './components.js';

export function photoPickerHtml(existingIds = []) {
  return html`<div class="photo-picker" data-photo-picker>
    <div class="pp-grid" data-pp-grid>
      ${existingIds.map((id) => html`<div class="pp-item done" data-existing="${id}"><img data-photo="${id}" data-size="thumb" alt="Ảnh"><button type="button" class="pp-remove" data-pp-remove aria-label="Bỏ ảnh">${icon('x')}</button></div>`)}
    </div>
    <div class="pp-actions">
      <label class="btn soft"><input type="file" accept="image/*" capture="environment" hidden data-pp-input>${icon('camera')} Chụp ảnh</label>
      <label class="btn soft"><input type="file" accept="image/*" multiple hidden data-pp-input>${icon('image')} Chọn ảnh</label>
    </div>
  </div>`;
}

/** Gắn hành vi; trả về controller { ids(), pending(), failed(), dispose() } */
export function mountPhotoPicker(root, store, { max = 6 } = {}) {
  const grid = root.querySelector('[data-pp-grid]');
  const uploads = [];
  let existing = [...grid.querySelectorAll('[data-existing]')].map((e) => e.dataset.existing);
  hydratePhotos(store, grid);

  grid.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-pp-remove]');
    if (rm) {
      const item = rm.closest('.pp-item');
      if (item.dataset.existing) existing = existing.filter((x) => x !== item.dataset.existing);
      const u = uploads.find((x) => x.id === item.dataset.upload);
      if (u) { uploads.splice(uploads.indexOf(u), 1); u.dispose(); }
      item.remove();
      return;
    }
    const rt = e.target.closest('[data-pp-retry]');
    if (rt) uploads.find((x) => x.id === rt.closest('.pp-item').dataset.upload)?.retry();
  });

  root.querySelectorAll('[data-pp-input]').forEach((input) => input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
      if (existing.length + uploads.length >= max) break;
      const u = new PhotoUpload(store, f);
      uploads.push(u);
      const item = document.createElement('div');
      item.className = 'pp-item';
      item.dataset.upload = u.id;
      grid.append(item);
      const paint = () => {
        const pct = Math.round(u.progress * 100);
        item.className = `pp-item ${u.state}`;
        item.innerHTML = String(html`<img src="${u.previewUrl}" alt="Xem trước">
          <button type="button" class="pp-remove" data-pp-remove aria-label="Bỏ ảnh">${icon('x')}</button>
          ${u.state === 'processing' ? html`<span class="pp-status">Đang tối ưu…</span>` : ''}
          ${u.state === 'uploading' ? html`<span class="pp-status">${pct}%</span><span class="pp-bar"><i style="width:${pct}%"></i></span>` : ''}
          ${u.state === 'done' ? html`<span class="pp-status ok" title="${bytes(u.file.size)} → ${bytes(u.photo.bytes_full)}">${icon('check')} ${bytes(u.photo.bytes_full)}</span>` : ''}
          ${u.state === 'error' ? html`<span class="pp-status err" title="${u.error}">Lỗi</span><button type="button" class="pp-retry" data-pp-retry>${icon('refresh')} Thử lại</button>` : ''}`);
      };
      u.on(paint);
      paint();
      u.start();
    }
  }));

  return {
    ids: () => [...existing, ...uploads.filter((u) => u.state === 'done').map((u) => u.photo.id)],
    pending: () => uploads.filter((u) => ['queued', 'processing', 'uploading'].includes(u.state)).length,
    failed: () => uploads.filter((u) => u.state === 'error'),
    async settle() {
      while (uploads.some((u) => ['queued', 'processing', 'uploading'].includes(u.state))) await new Promise((r) => setTimeout(r, 150));
    },
    dispose: () => uploads.forEach((u) => u.dispose()),
  };
}

/** Kiểm tra ảnh trước khi lưu biểu mẫu. Trả về lỗi (nếu có). */
export async function photosReady(ctrl, btn) {
  if (!ctrl) return [];
  if (ctrl.pending()) {
    if (btn) btn.innerHTML = '<span class="spinner"></span>Đang tải ảnh…';
    await ctrl.settle();
  }
  const f = ctrl.failed();
  if (f.length) return [`${f.length} ảnh tải lên thất bại (${esc(f[0].error)}). Bấm "Thử lại" trên ảnh hoặc bỏ ảnh đó rồi lưu lại.`];
  return [];
}

export function openPhotoViewer(store, photoId) {
  const p = store.byId('photos', photoId);
  openSheet({
    title: 'Ảnh', size: 'wide',
    subtitle: p ? `${p.width}×${p.height} · ${bytes(p.bytes_full)} (gốc ${bytes(p.original_bytes)})` : '',
    body: html`<div class="viewer"><img data-photo="${photoId}" data-size="full" alt="Ảnh chi tiết"></div>`,
    onMount: (el) => hydratePhotos(store, el),
  });
}
