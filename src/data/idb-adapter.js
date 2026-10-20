// Adapter DEMO: lưu dữ liệu giả lập trong IndexedDB của trình duyệt (mỗi máy một bản riêng).
// Ảnh lưu dạng Blob trong IndexedDB (không dùng localStorage, không dùng Base64).

import { TABLES, emptyDb } from './schema.js';

const DB_NAME = 'yenphungpet-v2-demo';
const DB_VERSION = 4; // v2: thêm inventory_items, inventory_movements; v3: inventory_costs; v4: cage_notes (onupgradeneeded tạo store còn thiếu, giữ dữ liệu cũ)

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('_blobs')) d.createObjectStore('_blobs');
      if (!d.objectStoreNames.contains('_meta')) d.createObjectStore('_meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Giao dịch bị huỷ')); });
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IdbAdapter {
  constructor() {
    this.kind = 'demo';
    this.serverAudit = false;
    this.failNextUploads = false; // bật trong Cài đặt để kiểm thử lỗi mạng
    this.simulatedKbps = 1500;    // tốc độ mạng giả lập cho thanh tiến trình (≈ 3G/4G yếu)
  }

  async init() { this.db = await open(); }

  async isSeeded() {
    const tx = this.db.transaction('_meta', 'readonly');
    return !!(await reqP(tx.objectStore('_meta').get('seeded')));
  }

  async getMeta(key) {
    const tx = this.db.transaction('_meta', 'readonly');
    return reqP(tx.objectStore('_meta').get(key));
  }

  async setMeta(key, value) {
    const tx = this.db.transaction('_meta', 'readwrite');
    tx.objectStore('_meta').put(value, key);
    await done(tx);
  }

  async loadAll() {
    const out = emptyDb();
    const tx = this.db.transaction(TABLES, 'readonly');
    await Promise.all(TABLES.map(async (t) => { out[t] = await reqP(tx.objectStore(t).getAll()); }));
    return out;
  }

  /** Ghi nguyên tử: tất cả thao tác thành công hoặc không thao tác nào được ghi. */
  async commit(ops) {
    const tables = [...new Set(ops.map((o) => o.table))];
    if (!tables.length) return;
    const tx = this.db.transaction(tables, 'readwrite');
    for (const o of ops) {
      const s = tx.objectStore(o.table);
      if (o.op === 'delete') s.delete(o.record.id); else s.put(o.record);
    }
    await done(tx);
  }

  async replaceAll(data) {
    const tx = this.db.transaction([...TABLES, '_blobs', '_meta'], 'readwrite');
    for (const t of TABLES) {
      const s = tx.objectStore(t);
      s.clear();
      for (const r of data[t] || []) s.put(r);
    }
    tx.objectStore('_blobs').clear();
    tx.objectStore('_meta').put(new Date().toISOString(), 'seeded');
    tx.objectStore('_meta').put(3, 'seedVersion');
    await done(tx);
  }

  /** Tải ảnh (giả lập mạng để có thanh tiến trình thật sự theo dung lượng). */
  async uploadPhoto(key, blob, onProgress) {
    const total = blob.size;
    const durationMs = Math.max(250, Math.min(6000, (total / 1024) / this.simulatedKbps * 8 * 1000));
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, durationMs / steps));
      if (this.failNextUploads && i === Math.ceil(steps * 0.6)) throw new Error('Mất kết nối mạng (giả lập)');
      onProgress?.(Math.round((i / steps) * total), total);
    }
    const tx = this.db.transaction('_blobs', 'readwrite');
    tx.objectStore('_blobs').put(blob, key);
    await done(tx);
    return { key };
  }

  async photoUrl(key) {
    const tx = this.db.transaction('_blobs', 'readonly');
    const blob = await reqP(tx.objectStore('_blobs').get(key));
    return blob ? URL.createObjectURL(blob) : null;
  }

  async storageEstimate() {
    return navigator.storage?.estimate ? navigator.storage.estimate() : null;
  }
}
