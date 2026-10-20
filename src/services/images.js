// Xử lý ảnh phía trình duyệt trước khi tải lên:
//  1. Giải mã ảnh, tự xoay đúng hướng theo EXIF (imageOrientation: 'from-image').
//  2. Thu nhỏ bản "xem" (cạnh dài ≤ 1600px — đủ rõ để quan sát lông, mắt, chân chim).
//  3. Tạo thumbnail (cạnh dài ≤ 360px) cho danh sách.
//  4. Mã hoá WebP (nếu trình duyệt hỗ trợ) hoặc JPEG.
// Không dùng Base64/FileReader.readAsDataURL — xem trước bằng Object URL cho tức thì và nhẹ bộ nhớ.

export const IMAGE_DEFAULTS = { maxFull: 1600, maxThumb: 360, qFull: 0.8, qThumb: 0.7 };

let webpSupport = null;
async function supportsWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    webpSupport = !!b && b.type === 'image/webp';
  } catch { webpSupport = false; }
  return webpSupport;
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* thử cách khác */ }
  }
  // Fallback: <img> — trình duyệt hiện đại tự áp dụng EXIF orientation (CSS image-orientation mặc định from-image)
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

async function encode(src, w, h, quality, type) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  canvas.width = canvas.height = 0; // giải phóng bộ nhớ trên điện thoại
  if (!blob) throw new Error('Không mã hoá được ảnh');
  return blob;
}

/** Trả về { full, thumb, width, height, originalBytes, ms, type } */
export async function processImage(file, opts = {}) {
  const o = { ...IMAGE_DEFAULTS, ...opts };
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Tệp không phải ảnh');
  const t0 = performance.now();
  const src = await decode(file);
  const W = src.width; const H = src.height;
  if (!W || !H) throw new Error('Không đọc được kích thước ảnh');
  const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';
  const [fw, fh] = fit(W, H, o.maxFull);
  const [tw, th] = fit(W, H, o.maxThumb);
  const full = await encode(src, fw, fh, o.qFull, type);
  const thumb = await encode(src, tw, th, o.qThumb, type);
  if (src.close) src.close();
  return { full, thumb, width: fw, height: fh, originalWidth: W, originalHeight: H, originalBytes: file.size, ms: Math.round(performance.now() - t0), type };
}

export function extFor(type) { return type === 'image/webp' ? 'webp' : 'jpg'; }
