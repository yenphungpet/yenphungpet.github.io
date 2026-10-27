// Quy trình ảnh: chọn → xem trước tức thì → xử lý → tải lên (có tiến trình, thử lại) → chỉ khi THÀNH CÔNG mới tạo bản ghi ảnh.

import { processImage, extFor } from './images.js';
import { uid } from '../core/ids.js';

export class PhotoUpload {
  constructor(store, file) {
    this.store = store;
    this.file = file;
    this.id = uid();
    this.previewUrl = URL.createObjectURL(file);
    this.state = 'queued'; // queued | processing | uploading | done | error
    this.progress = 0;
    this.error = '';
    this.photo = null; // bản ghi photos khi thành công
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  set(patch) { Object.assign(this, patch); this.emit(); }

  async start() {
    if (this.state === 'processing' || this.state === 'uploading' || this.state === 'done') return;
    try {
      if (!this.processed) {
        this.set({ state: 'processing', progress: 0, error: '' });
        this.processed = await processImage(this.file);
      }
      const p = this.processed;
      const d = new Date();
      const base = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${this.id}`;
      const ext = extFor(p.type);
      const fullKey = `${base}_full.${ext}`;
      const thumbKey = `${base}_thumb.${ext}`;
      const total = p.full.size + p.thumb.size;
      this.set({ state: 'uploading', progress: 0 });
      const t0 = performance.now();
      await this.store.adapter.uploadPhoto(thumbKey, p.thumb, (l) => this.set({ progress: l / total }));
      await this.store.adapter.uploadPhoto(fullKey, p.full, (l) => this.set({ progress: (p.thumb.size + l) / total }));
      const uploadMs = Math.round(performance.now() - t0);
      const rec = {
        id: this.id, full_key: fullKey, thumb_key: thumbKey, mime: p.type,
        width: p.width, height: p.height, bytes_full: p.full.size, bytes_thumb: p.thumb.size,
        original_bytes: p.originalBytes, original_width: p.originalWidth, original_height: p.originalHeight,
        process_ms: p.ms, upload_ms: uploadMs, created_at: new Date().toISOString(), created_by: this.store.user?.id || null,
      };
      // Chỉ tạo bản ghi ảnh sau khi cả 2 tệp đã tải lên thành công
      const r = await this.store.run({ ops: [{ table: 'photos', op: 'put', record: rec }] });
      if (!r.ok) throw new Error(r.errors.join('; '));
      this.set({ state: 'done', progress: 1, photo: rec });
    } catch (e) {
      this.set({ state: 'error', error: e.message || String(e) });
    }
  }

  retry() { this.state = 'queued'; return this.start(); }
  dispose() { URL.revokeObjectURL(this.previewUrl); this.listeners.clear(); }
}

const urlCache = new Map();
/** URL hiển thị ảnh (thumb hoặc full) — cache trong phiên. */
export async function photoUrl(store, photoId, size = 'thumb') {
  const p = store.byId('photos', photoId);
  if (!p) return null;
  const key = size === 'full' ? p.full_key : p.thumb_key;
  if (urlCache.has(key)) return urlCache.get(key);
  const url = await store.adapter.photoUrl(key);
  if (url) urlCache.set(key, url);
  return url;
}

/** Gắn src cho mọi <img data-photo="id" data-size="thumb|full"> trong vùng root. Supabase: ký link mọi ảnh trong MỘT yêu cầu. */
export async function hydratePhotos(store, root) {
  const imgs = [...root.querySelectorAll('img[data-photo]:not([data-ready])')];
  if (!imgs.length) return;
  imgs.forEach((img) => { img.dataset.ready = '1'; });
  const keyOf = (img) => { const p = store.byId('photos', img.dataset.photo); return p ? (img.dataset.size === 'full' ? p.full_key : p.thumb_key) : null; };
  if (store.adapter.photoUrls) {
    const keys = imgs.map(keyOf).filter((k) => k && !urlCache.has(k));
    if (keys.length) {
      try { for (const [k, u] of Object.entries(await store.adapter.photoUrls(keys))) urlCache.set(k, u); } catch { /* hiện "Không tải được ảnh" bên dưới */ }
    }
    for (const img of imgs) { const u = urlCache.get(keyOf(img)); if (u) img.src = u; else img.alt = 'Không tải được ảnh'; }
    return;
  }
  await Promise.all(imgs.map(async (img) => {
    const url = await photoUrl(store, img.dataset.photo, img.dataset.size || 'thumb');
    if (url) img.src = url; else img.alt = 'Không tải được ảnh';
  }));
}
