import { raw } from './html.js';

// Linh vật Yến Phụng (vẹt Yến Phụng / budgerigar) hoạt hình — hình minh hoạ vector, KHÔNG phải ảnh chim thật.
// Đặc điểm nhận diện: mặt vàng, vằn đen trên đầu & cánh, má xanh tím, chấm đen ở họng, mũi (cere) xanh, đuôi dài.
let n = 0;
export function mascot(size = 96, { wave = false } = {}) {
  const k = `m${++n}`;
  return raw(`<svg class="mascot" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Linh vật Yến Phụng Pet">
  <defs>
    <radialGradient id="${k}b" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#B4F07E"/><stop offset=".55" stop-color="#5DBF4E"/><stop offset="1" stop-color="#2E8A3E"/></radialGradient>
    <radialGradient id="${k}h" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF6C2"/><stop offset=".5" stop-color="#FFDB5C"/><stop offset="1" stop-color="#E9A92B"/></radialGradient>
    <linearGradient id="${k}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2B7FA8"/><stop offset="1" stop-color="#173F6B"/></linearGradient>
    <radialGradient id="${k}w" cx="30%" cy="25%" r="80%"><stop offset="0" stop-color="#9BE36F"/><stop offset="1" stop-color="#3B9A45"/></radialGradient>
    <radialGradient id="${k}c" cx="40%" cy="35%" r="60%"><stop offset="0" stop-color="#9DB4FF"/><stop offset="1" stop-color="#4E62D9"/></radialGradient>
  </defs>
  <ellipse cx="60" cy="112" rx="30" ry="5" fill="#0F5C5A" opacity=".18"/>
  <path d="M70 84 C82 96 92 104 104 116 C94 114 84 108 74 98 Z" fill="url(#${k}t)"/>
  <path d="M66 86 C74 98 80 106 86 118 C78 114 70 106 64 96 Z" fill="#1F5F8B"/>
  <ellipse cx="58" cy="74" rx="27" ry="31" fill="url(#${k}b)"/>
  <ellipse cx="52" cy="66" rx="12" ry="9" fill="#fff" opacity=".18"/>
  <path d="M68 56 C88 60 92 84 80 100 C72 92 66 80 64 66 Z" fill="url(#${k}w)" ${wave ? 'class="mascot-wing"' : ''}/>
  <g fill="none" stroke="#1E2B22" stroke-width="2" stroke-linecap="round" opacity=".75">
    <path d="M70 64 q5 3 10 1"/><path d="M71 71 q6 3 12 1"/><path d="M72 78 q6 3 12 1"/><path d="M73 85 q5 3 9 1"/>
  </g>
  <g fill="none" stroke="#FFE27A" stroke-width="1.4" stroke-linecap="round" opacity=".9">
    <path d="M70 66.5 q5 3 10 1"/><path d="M71 73.5 q6 3 12 1"/><path d="M72 80.5 q6 3 12 1"/>
  </g>
  <circle cx="56" cy="40" r="25" fill="url(#${k}h)"/>
  <g fill="none" stroke="#1E2B22" stroke-width="1.8" stroke-linecap="round" opacity=".7">
    <path d="M62 19 q6 1 10 5"/><path d="M66 25 q5 2 8 6"/><path d="M69 32 q4 2 6 6"/><path d="M57 17 q6 0 11 3"/>
  </g>
  <ellipse cx="42" cy="52" rx="6.5" ry="5" fill="url(#${k}c)"/>
  <g fill="#1E2B22"><circle cx="46" cy="61" r="1.9"/><circle cx="52" cy="62.5" r="1.9"/><circle cx="58" cy="62" r="1.9"/></g>
  <circle cx="52" cy="38" r="8.5" fill="#fff"/>
  <circle cx="50.5" cy="38.5" r="5.6" fill="#1B2430"/>
  <circle cx="48.6" cy="36.2" r="2" fill="#fff"/><circle cx="52.4" cy="40.6" r=".9" fill="#fff"/>
  <path d="M30 41 q2.5 -4.5 7 -3.5 q2 2.5 0 5 q-4 1 -7 -1.5Z" fill="#4E7FD9"/>
  <path d="M29.5 42.5 C26 46 26.5 53 31 55 C32 51 34.5 48 37 45.5 C35 43.5 32 42.5 29.5 42.5Z" fill="#F6C27A" stroke="#C98B3D" stroke-width="1"/>
  <ellipse cx="64" cy="44" rx="4" ry="2.6" fill="#FF9E8A" opacity=".45"/>
  <g stroke="#B98A84" stroke-width="3" stroke-linecap="round" fill="none"><path d="M50 102 v6 M46 108 h8"/><path d="M62 102 v6 M58 108 h8"/></g>
</svg>`);
}

/** Minh hoạ lồng chim nhỏ (vector). */
export function cageArt(size = 64) {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F2C14E"/><stop offset="1" stop-color="#C98F1F"/></linearGradient></defs>
  <path d="M32 4 v5" stroke="#C98F1F" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="4" r="3" fill="none" stroke="#C98F1F" stroke-width="2"/>
  <path d="M10 30 C10 16 20 9 32 9 C44 9 54 16 54 30 V54 H10 Z" fill="#E8F4EF" stroke="url(#cg)" stroke-width="3"/>
  <g stroke="#C98F1F" stroke-width="1.6" opacity=".8"><path d="M18 16 V54M25 11 V54M32 9 V54M39 11 V54M46 16 V54"/></g>
  <rect x="7" y="52" width="50" height="7" rx="3" fill="url(#cg)"/>
  <path d="M14 40 H50" stroke="#8B5E2B" stroke-width="2.4" stroke-linecap="round"/>
</svg>`);
}

/** Minh hoạ tổ với trứng. */
export function nestArt(size = 64, eggs = 3) {
  const eg = [[22, 30], [32, 27], [42, 30], [27, 33], [37, 33]].slice(0, Math.max(0, Math.min(5, eggs)))
    .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="7" fill="url(#eg)" stroke="#E2D6BC" stroke-width=".8"/>`).join('');
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <defs><radialGradient id="eg" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#EFE6D2"/></radialGradient>
  <linearGradient id="ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C8924C"/><stop offset="1" stop-color="#8A5A2B"/></linearGradient></defs>
  ${eg}
  <path d="M8 34 C10 52 54 52 56 34 C46 40 18 40 8 34Z" fill="url(#ng)"/>
  <g stroke="#6E4520" stroke-width="1.2" fill="none" opacity=".7"><path d="M12 38 q10 6 20 2"/><path d="M30 44 q12 2 22 -6"/><path d="M14 44 q8 4 18 4"/></g>
</svg>`);
}

export function logo() {
  return raw(`<span class="logo">${mascot(36)}<span class="logo-text"><b>Yến Phụng Pet</b><small>Thế Giới Yến Phụng</small></span></span>`);
}
