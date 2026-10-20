// Yến Phụng Pet V2 — khởi động ứng dụng, router, khung giao diện.
import { IdbAdapter } from './data/idb-adapter.js';
import { Store, ROLES } from './data/store.js';
import { buildDemo, buildDemoInventory } from './data/seed.js';
import { planMoveLegacyCosts } from './domain/inventory.js';
import { todayVN } from './core/dates.js';
import { html, raw } from './ui/html.js';
import { icon } from './ui/icons.js';
import { logo } from './ui/brand.js';
import { toast, closeAllSheets } from './ui/components.js';
import { hydratePhotos } from './services/photos.js';
import { openPhotoViewer } from './ui/photo-picker.js';

import * as dashboard from './views/dashboard.js';
import * as cages from './views/cages.js';
import * as pens from './views/pens.js';
import * as breeders from './views/breeders.js';
import * as health from './views/health.js';
import * as performance from './views/performance.js';
import * as finance from './views/finance.js';
import * as sales from './views/sales.js';
import * as more from './views/more.js';
import * as inventory from './views/inventory.js';

const ROUTES = [
  ['/', dashboard.render, 'home'],
  ['/cages', cages.renderList, 'cages'],
  ['/cage/:id', cages.renderDetail, 'cages'],
  ['/clutch/:id', performance.renderClutch, 'cages'],
  ['/pens', pens.render, 'pens'],
  ['/pen/:id', pens.renderLedger, 'pens'],
  ['/breeders', breeders.renderList, 'breeders'],
  ['/bird/:id', breeders.renderProfile, 'breeders'],
  ['/kinship', breeders.renderKinship, 'breeders'],
  ['/health', health.renderList, 'more'],
  ['/health/:id', health.renderDetail, 'more'],
  ['/performance', performance.render, 'more'],
  ['/finance', finance.render, 'more', 'finance.read'],
  ['/sales', sales.renderList, 'more', 'sales.read'],
  ['/order/:id', sales.renderOrder, 'more', 'sales.read'],
  ['/customers', sales.renderCustomers, 'more', 'sales.read'],
  ['/inventory', inventory.render, 'more'],
  ['/inventory/:id', inventory.renderDetail, 'more'],
  ['/inventory-check', inventory.renderCheck, 'more'],
  ['/more', more.renderMenu, 'more'],
  ['/settings', more.renderSettings, 'more'],
  ['/audit', more.renderAudit, 'more', 'audit.read'],
  ['/checklist', more.renderChecklist, 'more'],
];

const NAV = [
  ['home', '#/', 'home', 'Tổng quan'],
  ['cages', '#/cages', 'cage', 'Lồng SS'],
  ['pens', '#/pens', 'pen', 'Lồng phóng'],
  ['breeders', '#/breeders', 'bird', 'Chim giống'],
  ['more', '#/more', 'more', 'Thêm'],
];

function match(path) {
  for (const [pattern, fn, nav, perm] of ROUTES) {
    const ps = pattern.split('/'); const xs = path.split('/');
    if (ps.length !== xs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(xs[i]);
      else if (ps[i] !== xs[i]) { ok = false; break; }
    }
    if (ok) return { fn, nav, params, perm };
  }
  return null;
}

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export class App {
  constructor(store, cfg) {
    this.store = store;
    this.cfg = cfg;
    this.root = document.getElementById('app');
    this.lastPath = null;
  }

  navigate(hash) { if (location.hash === hash) this.render(); else location.hash = hash; }

  shell(content, nav) {
    const s = this.store;
    const st = s.status;
    const demo = s.adapter.kind === 'demo';
    return html`
      ${demo ? more.ribbon(s) : ''}
      <header class="app-header"><div class="app-header-in">
        <a href="#/" aria-label="Trang chủ Yến Phụng Pet">${logo()}</a>
        <span class="header-spacer"></span>
        <span class="sync ${st.state}" data-sync><i></i><span>${st.message}</span></span>
        <a class="role-chip" href="#/settings" title="Vai trò hiện tại">${ROLES[s.role]}</a>
      </div></header>
      <main id="view">${content}</main>
      <nav class="bottom-nav" aria-label="Điều hướng chính"><div class="bottom-nav-in">
        ${NAV.map(([k, href, ic, label]) => html`<a class="nav-item ${k === nav ? 'active' : ''}" href="${href}" ${k === nav ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`)}
      </div></nav>`;
  }

  render() {
    const { path, query } = parseHash();
    if (this.store.role === 'public') {
      this.root.innerHTML = String(more.renderPublic(this));
      more.mountPublic?.(this.root, this);
      return;
    }
    const m = match(path);
    let view;
    if (!m) view = { html: html`<div class="empty"><p>Không tìm thấy trang.</p><a class="btn soft" href="#/">Về Tổng quan</a></div>` };
    else if (m.perm && !this.store.can(m.perm)) view = { html: html`<div class="card"><div class="msg warn">${icon('shield')} Vai trò hiện tại không có quyền xem mục này.</div></div>` };
    else {
      try { view = m.fn(this, m.params, query); } catch (e) {
        console.error(e);
        view = { html: html`<div class="msg error">Lỗi hiển thị trang: ${e.message}</div>` };
      }
    }
    const samePage = this.lastPath === path;
    const y = window.scrollY;
    this.root.innerHTML = String(this.shell(view.html, m?.nav));
    this.lastPath = path;
    const main = this.root.querySelector('#view');
    view.mount?.(main);
    hydratePhotos(this.store, main);
    window.scrollTo(0, samePage ? y : 0);
  }

  bindGlobal() {
    window.addEventListener('hashchange', () => { closeAllSheets(); this.render(); });
    this.store.subscribe(() => { clearTimeout(this._t); this._t = setTimeout(() => this.render(), 30); });
    this.store.emitStatus = (st) => {
      const el = document.querySelector('[data-sync]');
      if (el) { el.className = `sync ${st.state}`; el.querySelector('span').textContent = st.message; }
    };
    document.addEventListener('click', (e) => {
      const v = e.target.closest('[data-view-photo]');
      if (v) { e.preventDefault(); openPhotoViewer(this.store, v.dataset.viewPhoto); }
    });
    window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(`Lỗi: ${e.reason?.message || e.reason}`, 'error'); });
  }
}

async function boot() {
  const cfg = window.YP_CONFIG || { mode: 'demo' };
  const el = document.getElementById('app');
  try {
    let adapter;
    if (cfg.mode === 'supabase') {
      const { SupabaseAdapter } = await import('./data/supabase-adapter.js');
      adapter = new SupabaseAdapter(cfg.supabase);
    } else {
      adapter = new IdbAdapter();
    }
    await adapter.init();
    const store = new Store(adapter);
    if (adapter.kind === 'demo') {
      if (!(await adapter.isSeeded())) await adapter.replaceAll(buildDemo(todayVN()));
      else if ((await adapter.getMeta('seedVersion')) !== 3) {
        // Nâng cấp dữ liệu demo của bản trước, KHÔNG xoá dữ liệu người dùng đang thử:
        // v2 bổ sung Kho demo; v3 (B12) chuyển chi phí phiếu nhập sang inventory_costs như migration 0009
        const data = await adapter.loadAll();
        const isDemo = data.settings.find((x) => x.id === 'app')?.value?.demo;
        if (isDemo && !data.inventory_items.length) {
          buildDemoInventory(data, todayVN());
          await adapter.commit([
            ...data.inventory_items.map((record) => ({ table: 'inventory_items', op: 'put', record })),
            ...data.inventory_movements.map((record) => ({ table: 'inventory_movements', op: 'put', record })),
            ...(data.inventory_costs || []).map((record) => ({ table: 'inventory_costs', op: 'put', record })),
            ...data.transactions.filter((t) => t.source === 'inventory').map((record) => ({ table: 'transactions', op: 'put', record })),
          ]);
        }
        const moved = planMoveLegacyCosts(data);
        if (moved.length) await adapter.commit(moved);
        await adapter.setMeta('seedVersion', 3);
      }
      store.user = more.demoUser();
    } else {
      const p = await adapter.profile();
      store.user = p ? { id: p.id, name: p.display_name || p.email, role: p.role } : null;
    }
    const app = new App(store, cfg);
    window.__yp = app; // hỗ trợ kiểm thử tự động
    app.bindGlobal();
    if (!store.user) { more.renderLogin(app); return; }
    await store.load();
    store.startSync();
    app.render();
  } catch (e) {
    console.error(e);
    el.innerHTML = String(html`<div class="login-wrap card"><div class="msg error">${icon('alert')} Không khởi động được ứng dụng: ${e.message}</div>
      <p class="small muted">Nếu đang dùng chế độ riêng tư (ẩn danh) của trình duyệt, IndexedDB có thể bị chặn. Hãy mở bằng tab thường.</p></div>`);
  }
}

boot();
