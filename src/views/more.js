import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { mascot, logo, cageArt } from '../ui/brand.js';
import { field, options, showMessages, formValues, busy, toast, confirmDialog, empty, badge, openSheet } from '../ui/components.js';
import { validatePasswordChange, passwordErrorMessage, PASSWORD_MIN } from '../domain/account.js';
import { TASK_GROUPS, planTaskAdd, planTaskEdit, planTaskDelete } from '../domain/checklist.js';
import { ROLES } from '../data/store.js';
import { buildDemo, DEMO_LABEL, DEFAULT_TASKS } from '../data/seed.js';
import { processImage } from '../services/images.js';
import { lowStockItems } from '../domain/inventory.js';
import { primaryMenuRoutes } from '../domain/menu.js';
import { fmtDate, fmtDateTime } from '../core/dates.js';
import { bytes, toInt } from '../core/format.js';

// ---- Vai trò demo: CHỈ để thử giao diện theo quyền. Không phải cơ chế bảo mật. ----
const ROLE_KEY = 'yp_demo_role';
export function demoUser() {
  let role = 'owner';
  try { role = localStorage.getItem(ROLE_KEY) || 'owner'; } catch { /* trình duyệt chặn storage */ }
  if (!ROLES[role]) role = 'owner';
  return { id: `demo-${role}`, name: `Demo ${ROLES[role]}`, role };
}
function setDemoRole(role) { try { localStorage.setItem(ROLE_KEY, role); } catch { /* bỏ qua */ } }

export function ribbon(s) {
  return s.settings.legacyImport
    ? html`<div class="demo-ribbon" style="background:#B9382B;color:#fff">STAGING · DỮ LIỆU THẬT — XEM THỬ CỤC BỘ, KHÔNG CÔNG KHAI</div>`
    : html`<div class="demo-ribbon">STAGING · DỮ LIỆU GIẢ LẬP</div>`;
}

export function renderMenu(app) {
  const s = app.store;
  const items = [
    ['#/inventory', 'store', 'Kho & thức ăn', `${lowStockItems(s.db, s.today()).length} vật tư sắp hết`, lowStockItems(s.db, s.today()).length ? 'red' : 'green'],
    ['#/performance', 'chart', 'Hiệu suất & lứa', 'Tỷ lệ có cồ, nở, ra ràng', ''],
    ['#/health', 'heart', 'Sức khoẻ & cách ly', `${s.db.health_cases.filter((h) => h.status !== 'closed').length} hồ sơ mở`, 'red'],
    ['#/checklist', 'clipboard', 'Checklist hằng ngày', 'Công việc chăm sóc', ''],
    ['#/kinship', 'dna', 'Kiểm tra huyết thống', 'Trước khi ghép đôi', ''],
    s.can('sales.read') && ['#/sales', 'cart', 'Bán hàng', 'Đơn, thanh toán, công nợ', 'gold'],
    s.can('sales.read') && ['#/customers', 'users', 'Khách hàng', `${s.db.customers.length} khách`, ''],
    s.can('finance.read') && ['#/finance', 'wallet', 'Tài chính', 'Thu chi, dòng tiền, báo cáo', 'green'],
    s.can('audit.read') && ['#/audit', 'shield', 'Nhật ký thay đổi', 'Audit trail dữ liệu quan trọng', ''],
    ['#/settings', 'settings', 'Cài đặt', 'Ngưỡng cảnh báo, vai trò, ảnh', ''],
  ].filter(Boolean);
  const primary = primaryMenuRoutes(s.db);
  const main = items.filter(([href]) => primary[href] !== false);
  const rare = items.filter(([href]) => primary[href] === false);
  const grid = (list) => html`<div class="menu-grid">${list.map(([href, ic, t, d, tone]) => html`<a class="menu-item" href="${href}"><span class="row-icon ${tone}">${icon(ic)}</span>${t}<small>${d}</small></a>`)}</div>`;
  return { html: html`<div class="page-head"><div class="grow"><h1>Thêm</h1><div class="sub">Các chức năng khác</div></div></div>
    ${grid(main)}
    ${rare.length ? html`<details class="adv" style="margin-top:12px" data-rare-menu><summary>Chức năng ít dùng (${rare.length})</summary>${grid(rare)}</details>` : ''}` };
}

export function renderSettings(app) {
  const s = app.store;
  const st = s.settings;
  const demo = s.adapter.kind === 'demo';
  const owner = s.can('settings.write');
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Cài đặt</h1></div></div>
      ${demo ? html`<div class="card"><div class="card-title">${icon('users')} Vai trò (chế độ demo)</div>
        <p class="small muted">Trong bản demo, bạn tự chọn vai trò để thử giao diện theo quyền. Đây KHÔNG phải cơ chế bảo mật. Khi chạy với Supabase, quyền do đăng nhập thật + RLS phía database quyết định.</p>
        <div class="btn-row">${Object.entries(ROLES).map(([k, l]) => html`<button class="btn ${s.role === k ? 'primary' : 'soft'} sm" data-role="${k}">${l}</button>`)}</div></div>`
        : html`<div class="card"><div class="card-title">${icon('users')} Tài khoản</div><p>${s.user?.name} · ${ROLES[s.role]}</p><div class="btn-row"><button class="btn soft" data-change-pw>${icon('shield')} Đổi mật khẩu</button><button class="btn ghost" data-logout>${icon('logout')} Đăng xuất</button></div></div>
        <div class="card"><div class="card-title">${icon('refresh')} Đồng bộ dữ liệu</div>
          <p class="small muted">Dữ liệu tự đồng bộ giữa các thiết bị và tải lại khi mở lại app.</p>
          <div class="btn-row"><button class="btn soft" data-sync-now>${icon('refresh')} Đồng bộ ngay</button></div></div>`}

      <div class="card"><div class="card-title">${icon('alert')} Ngưỡng cảnh báo</div>
        <form class="form" data-th>
          <div class="grid2">${field('Lồng chưa cập nhật quá (ngày)', html`<input type="number" name="staleUpdateDays" min="1" inputmode="numeric" value="${st.staleUpdateDays}" ${owner ? '' : 'disabled'}>`)}
            ${field('Nghỉ đẻ lâu quá (ngày)', html`<input type="number" name="longRestDays" min="1" inputmode="numeric" value="${st.longRestDays}" ${owner ? '' : 'disabled'}>`)}</div>
          ${field('Mặc định đánh giá lại sau khi bắt đầu nghỉ (ngày)', html`<input type="number" name="restReviewDays" min="1" inputmode="numeric" value="${st.restReviewDays}" ${owner ? '' : 'disabled'}>`)}
          ${owner ? html`<button class="btn primary" type="submit">${icon('check')} Lưu ngưỡng</button>` : html`<p class="small muted">Chỉ chủ trại được thay đổi.</p>`}
          <div class="form-msg" data-msg></div></form></div>


      ${demo ? html`<div class="card"><div class="card-title">${icon('refresh')} Dữ liệu demo</div>
        <p class="small muted">${DEMO_LABEL}. Lưu trong trình duyệt của máy này (IndexedDB), không gửi đi đâu.</p>
        <label class="check"><input type="checkbox" data-failnet ${s.adapter.failNextUploads ? 'checked' : ''}> Giả lập mất mạng khi tải ảnh (để kiểm thử lỗi upload)</label>
        ${field('Tốc độ mạng giả lập', html`<select data-speed>${options({ 300: 'Rất chậm (~300 kbps)', 1500: '3G/4G yếu (~1.5 Mbps)', 8000: '4G tốt (~8 Mbps)' }, String(s.adapter.simulatedKbps))}</select>`)}
        <div class="btn-row" style="margin-top:10px"><button class="btn danger" data-reset>${icon('refresh')} Tạo lại dữ liệu demo</button></div>
        <div class="def" style="margin-top:12px"><b>Xem thử với dữ liệu thật (chỉ trên máy này):</b> chọn file <code>local-data/v2-from-legacy.json</code> do công cụ <code>tools/import-legacy.mjs</code> tạo từ bản backup. Dữ liệu chỉ nằm trong trình duyệt của máy này, không tải lên đâu. Không dùng tính năng này trên bản công khai.</div>
        <label class="btn soft block" style="margin-top:8px"><input type="file" accept="application/json,.json" hidden data-import-json>${icon('download')} Nạp file JSON dữ liệu cũ (xem thử cục bộ)</label></div>` : ''}

      <div class="card"><div class="card-title">${icon('info')} Thông tin phiên bản</div><dl class="kv">
        <dt>Phiên bản</dt><dd>2.0</dd><dt>Chế độ dữ liệu</dt><dd>${demo ? 'DEMO (IndexedDB trên máy)' : 'Máy chủ Supabase'}</dd></dl>
        <details class="adv" style="margin-top:10px" data-tech><summary>Công cụ kỹ thuật</summary>
          ${demo ? '' : html`<p class="small muted">Dự án: <b>${s.adapter.ref}</b></p>
          <div class="btn-row"><button class="btn soft" data-diag>${icon('shield')} Kiểm tra kết nối</button><button class="btn ghost" data-diag-upload>${icon('camera')} Kiểm tra kèm tải ảnh thử</button></div>
          <div data-diag-out></div>`}
          <p class="small muted" style="margin-top:10px">Đo tốc độ tối ưu ảnh: chọn 1 ảnh để so sánh dung lượng & thời gian tải trước/sau tối ưu. Ảnh chỉ xử lý trên máy, không tải lên.</p>
          <label class="btn soft block"><input type="file" accept="image/*" hidden data-bench>${icon('image')} Chọn ảnh để đo</label>
          <div data-bench-out></div>
          <dl class="kv" style="margin-top:10px"><dt>Số bản ghi</dt><dd>${Object.entries(s.db).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.length}`).join(' · ')}</dd></dl></details></div>`,
    mount(root) {
      root.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-role]');
        if (r) { setDemoRole(r.dataset.role); s.user = demoUser(); toast(`Đang dùng vai trò: ${ROLES[s.role]}`); app.navigate('#/'); app.render(); return; }
        if (e.target.closest('[data-reset]')) {
          if (!(await confirmDialog('Xoá toàn bộ dữ liệu demo trên máy này và tạo lại từ đầu?', { danger: true, ok: 'Tạo lại' }))) return;
          await s.adapter.replaceAll(buildDemo(s.today()));
          await s.load(); toast('Đã tạo lại dữ liệu demo'); app.navigate('#/');
        }
        if (e.target.closest('[data-change-pw]')) { openChangePassword(app); return; }
        if (e.target.closest('[data-logout]')) { await s.adapter.signOut(); location.reload(); }
        if (e.target.closest('[data-sync-now]')) { try { await s.reload(); toast('Đã đồng bộ'); } catch (err) { toast(err.message, 'error'); } }
        const dg = e.target.closest('[data-diag],[data-diag-upload]');
        if (dg) {
          const out = root.querySelector('[data-diag-out]');
          out.innerHTML = '<p class="small muted"><span class="spinner"></span> Đang kiểm tra…</p>';
          const rows = await s.adapter.diagnose({ testUpload: dg.hasAttribute('data-diag-upload'), isOwner: s.role === 'owner' });
          out.innerHTML = String(html`<div class="list" style="margin-top:8px">${rows.map((r) => html`<div class="row"><span class="row-icon ${r.ok ? 'green' : 'red'}">${icon(r.ok ? 'check' : 'alert')}</span><span class="grow"><span class="title">${r.name}</span><br><span class="desc">${r.detail}</span></span></div>`)}</div>`);
        }
      });
      root.querySelector('[data-import-json]')?.addEventListener('change', async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          const missing = ['cages', 'daily_logs', 'transactions'].filter((k) => !Array.isArray(data[k]));
          if (missing.length) throw new Error(`File không đúng định dạng V2 (thiếu ${missing.join(', ')})`);
          if (!(await confirmDialog(`Thay toàn bộ dữ liệu trên máy này bằng file "${f.name}" (${data.cages.length} lồng, ${data.daily_logs.length} nhật ký, ${data.transactions.length} giao dịch)? Dữ liệu demo hiện tại sẽ bị xoá khỏi máy này.`, { danger: true, ok: 'Nạp dữ liệu' }))) return;
          // Gắn cờ "dữ liệu thật — xem thử cục bộ" ở đây (không nằm trong tệp chuyển đổi: khi nhập thật không được ghi đè cài đặt trại)
          const app0 = (data.settings || []).find((x) => x.id === 'app');
          data.settings = [...(data.settings || []).filter((x) => x.id !== 'app'), { id: 'app', value: { ...(app0?.value || {}), farmName: app0?.value?.farmName || 'Trại Yến Phụng (dữ liệu thật — xem thử cục bộ)', legacyImport: new Date().toISOString() } }];
          await s.adapter.replaceAll(data);
          await s.load(); toast('Đã nạp dữ liệu — chế độ XEM THỬ CỤC BỘ'); app.navigate('#/');
        } catch (err) { toast(`Không nạp được: ${err.message}`, 'error'); }
      });
      root.querySelector('[data-failnet]')?.addEventListener('change', (e) => { s.adapter.failNextUploads = e.target.checked; toast(e.target.checked ? 'Ảnh tải lên tiếp theo sẽ bị lỗi mạng giả lập' : 'Đã tắt giả lập lỗi'); });
      root.querySelector('[data-speed]')?.addEventListener('change', (e) => { s.adapter.simulatedKbps = Number(e.target.value); });
      root.querySelector('[data-th]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = formValues(e.target);
        const patch = { staleUpdateDays: toInt(v.staleUpdateDays, 0), longRestDays: toInt(v.longRestDays, 0), restReviewDays: toInt(v.restReviewDays, 0) };
        if (Object.values(patch).some((x) => x < 1 || x > 365)) return showMessages(e.target.querySelector('[data-msg]'), ['Ngưỡng phải từ 1 đến 365 ngày']);
        const r = await s.saveSettings(patch);
        if (!r.ok) return showMessages(e.target.querySelector('[data-msg]'), r.errors);
        toast('Đã lưu ngưỡng cảnh báo');
      });
      root.querySelector('[data-bench]').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const out = root.querySelector('[data-bench-out]');
        out.innerHTML = '<p class="small muted"><span class="spinner"></span> Đang xử lý…</p>';
        try {
          const p = await processImage(f);
          const sec = (b, kbps) => ((b * 8) / (kbps * 1000)).toFixed(1).replace('.', ',');
          out.innerHTML = String(html`<table class="table" style="margin-top:8px"><thead><tr><th></th><th class="r">Ảnh gốc</th><th class="r">Sau tối ưu</th></tr></thead><tbody>
            <tr><td>Kích thước</td><td class="r">${p.originalWidth}×${p.originalHeight}</td><td class="r">${p.width}×${p.height}</td></tr>
            <tr><td>Dung lượng</td><td class="r">${bytes(f.size)}</td><td class="r">${bytes(p.full.size)} + thumb ${bytes(p.thumb.size)}</td></tr>
            <tr><td>Giảm</td><td class="r">—</td><td class="r"><b>${Math.round((1 - (p.full.size + p.thumb.size) / f.size) * 100)}%</b></td></tr>
            <tr><td>Tải lên ở 1,5 Mbps</td><td class="r">~${sec(f.size, 1500)} giây</td><td class="r">~${sec(p.full.size + p.thumb.size, 1500)} giây</td></tr>
            <tr><td>Thời gian xử lý trên máy</td><td class="r">—</td><td class="r">${p.ms} ms</td></tr>
            <tr><td>Định dạng</td><td class="r">${f.type || '?'}</td><td class="r">${p.type}</td></tr></tbody></table>`);
        } catch (err) { out.innerHTML = String(html`<div class="msg error">${err.message}</div>`); }
        e.target.value = '';
      });
    },
  };
}

export function renderAudit(app, _p, query) {
  const s = app.store;
  const t = query.t || '';
  const list = s.db.audit_log.filter((a) => !t || a.table_name === t).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
  const tables = [...new Set(s.db.audit_log.map((a) => a.table_name))].sort();
  const LABEL = { insert: 'Tạo mới', update: 'Sửa', delete: 'Xoá' };
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Nhật ký thay đổi</h1><div class="sub">Audit trail: ai sửa gì, lúc nào, trước/sau</div></div></div>
      <div class="chips"><a class="chip ${!t ? 'active' : ''}" href="#/audit">Tất cả</a>${tables.map((x) => html`<a class="chip ${x === t ? 'active' : ''}" href="#/audit?t=${x}">${x}</a>`)}</div>
      ${s.adapter.serverAudit ? html`<p class="def">Ở chế độ Supabase, audit do trigger phía database ghi (không thể giả mạo từ trình duyệt).</p>` : ''}
      <div class="card">${list.length ? html`<div class="list">${list.map((a) => html`<details class="row" style="display:block"><summary style="cursor:pointer;list-style:none">
        ${badge(LABEL[a.action] || a.action, a.action === 'delete' ? 'danger' : a.action === 'update' ? 'warn' : 'ok')} <b>${a.table_name}</b> · ${fmtDateTime(a.at)} · ${a.actor_name || a.actor}
        ${a.changed?.length ? html`<br><span class="small muted">Trường thay đổi: ${a.changed.join(', ')}</span>` : ''}</summary>
        ${a.action !== 'insert' ? html`<div class="small" style="margin-top:6px">${(a.changed || []).map((k) => html`<div><b>${k}</b>: <span class="money-out">${JSON.stringify(a.before?.[k])}</span> → <span class="money-in">${JSON.stringify(a.after?.[k])}</span></div>`)}</div>` : ''}</details>`)}</div>`
        : empty('Chưa có thay đổi nào được ghi nhận.')}</div>`,
  };
}

export function renderChecklist(app) {
  const s = app.store;
  const today = s.today();
  const row = s.db.checklist.find((c) => c.id === 'tasks') || { id: 'tasks', tasks: DEFAULT_TASKS, done: {} };
  const done = row.done?.[today] || {};
  const n = row.tasks.filter((t) => done[t.id]).length;
  const groups = [...new Set(row.tasks.map((t) => t.group))];
  const canW = s.can('checklist.write');
  const canEdit = s.can('settings.write'); // như V1: chỉ chủ trại sửa danh sách công việc
  return {
    html: html`<div class="page-head"><a class="back" href="#/more">${icon('back')}</a><div class="grow"><h1>Checklist hôm nay</h1><div class="sub">${fmtDate(today)} · ${n}/${row.tasks.length} việc</div></div>
        ${canEdit ? html`<button class="btn soft sm" data-task-add>${icon('plus')} Công việc</button>` : ''}</div>
      <div class="progress" style="margin-bottom:12px"><i style="width:${row.tasks.length ? (n / row.tasks.length) * 100 : 0}%"></i></div>
      ${groups.map((g) => html`<div class="section"><h2>${g}</h2></div><div class="card"><div class="list">${row.tasks.filter((t) => t.group === g).map((t) => html`
        <div class="row"><label class="grow" style="display:flex;gap:12px;align-items:center;cursor:pointer"><input type="checkbox" data-task="${t.id}" ${done[t.id] ? 'checked' : ''} ${canW ? '' : 'disabled'} style="width:24px;height:24px;accent-color:var(--teal-600)">
        <span class="grow"><span class="title" style="${done[t.id] ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${t.title}</span><br><span class="desc">${t.time}</span></span></label>
        ${canEdit ? html`<button type="button" class="btn ghost sm" data-task-edit="${t.id}" aria-label="Sửa ${t.title}">${icon('edit')}</button>` : ''}</div>`)}</div></div>`)}`,
    mount(root) {
      const save = async (record, msg) => {
        const r = await s.run({ ops: [{ table: 'checklist', op: 'put', record: { ...record, created_at: record.created_at || new Date().toISOString() } }] }, { requires: 'settings.write' });
        if (!r.ok) return r.errors;
        toast(msg); app.render(); return null;
      };
      const openTask = (task) => {
        const cur = s.db.checklist.find((c) => c.id === 'tasks') || row;
        const groupsNow = [...new Set([...TASK_GROUPS, ...cur.tasks.map((t) => t.group)])];
        openSheet({
          title: task ? 'Sửa công việc' : 'Thêm công việc', size: 'small',
          body: html`<form class="form" data-tf>
            ${field('Tên công việc *', html`<input name="title" value="${task?.title || ''}" maxlength="80" required>`)}
            <div class="grid2">${field('Buổi *', html`<select name="group">${options(Object.fromEntries(groupsNow.map((g) => [g, g])), task?.group || 'Sáng')}</select>`)}
              ${field('Giờ (tuỳ chọn)', html`<input type="time" name="time" value="${task && task.time !== '—' ? task.time : ''}">`)}</div>
            ${task ? html`<p class="small muted">Xoá công việc chỉ bỏ khỏi danh sách; lịch sử đánh dấu các ngày trước vẫn giữ.</p>` : ''}
            <div class="form-msg" data-msg></div></form>`,
          footer: html`${task ? html`<button class="btn danger" data-del>${icon('trash')} Xoá</button>` : html`<button class="btn ghost" data-close>Huỷ</button>`}<button class="btn primary" data-save>${icon('check')} Lưu</button>`,
          onMount: (el, close) => {
            const msg = el.querySelector('[data-msg]');
            el.querySelector('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
              const latest = s.db.checklist.find((c) => c.id === 'tasks') || row;
              const v = formValues(el.querySelector('[data-tf]'));
              const p = task ? planTaskEdit(latest, task.id, v) : planTaskAdd(latest, v);
              if (p.errors.length) return showMessages(msg, p.errors);
              const err = await save(p.record, task ? 'Đã sửa công việc' : 'Đã thêm công việc');
              if (err) return showMessages(msg, err);
              close();
            }));
            el.querySelector('[data-del]')?.addEventListener('click', async () => {
              if (!(await confirmDialog(`Xoá "${task.title}" khỏi checklist?`, { danger: true, ok: 'Xoá' }))) return;
              const p = planTaskDelete(s.db.checklist.find((c) => c.id === 'tasks') || row, task.id);
              const err = p.errors.length ? p.errors : await save(p.record, 'Đã xoá công việc');
              if (err) return showMessages(msg, err);
              close();
            });
          },
        });
      };
      root.querySelector('[data-task-add]')?.addEventListener('click', () => openTask(null));
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-task-edit]'); if (!b) return;
        e.preventDefault();
        openTask((s.db.checklist.find((c) => c.id === 'tasks') || row).tasks.find((t) => t.id === b.dataset.taskEdit));
      });
      root.addEventListener('change', async (e) => {
        const id = e.target.dataset.task; if (!id) return;
        const cur = s.db.checklist.find((c) => c.id === 'tasks') || row;
        const rec = { ...cur, done: { ...(cur.done || {}), [today]: { ...(cur.done?.[today] || {}), [id]: e.target.checked } } };
        const r = await s.run({ ops: [{ table: 'checklist', op: 'put', record: rec }] }, { requires: 'checklist.write' });
        if (!r.ok) { e.target.checked = !e.target.checked; toast(r.errors.join('; '), 'error'); }
      });
    },
  };
}

export function renderPublic(app) {
  const s = app.store;
  const demo = s.adapter.kind === 'demo';
  return html`${demo ? ribbon(s) : ''}
    <header class="app-header"><div class="app-header-in">${logo()}<span class="header-spacer"></span>
      ${demo ? html`<button class="role-chip" data-back-owner>Quay lại vai trò Chủ trại</button>` : html`<button class="role-chip" data-login>Đăng nhập</button>`}</div></header>
    <main>
      <section class="public-hero">${mascot(140, { wave: true })}<h1>Yến Phụng Pet</h1><p>Thế Giới Yến Phụng</p></section>
      <div class="card"><div class="card-title">${cageArt(40)} Chim đang có tại trại</div>
        <div class="list">${s.db.listings.filter((l) => l.published).map((l) => html`<div class="row"><span class="row-icon gold">${icon('bird')}</span><span class="grow"><span class="title">${l.title}</span><br><span class="desc">${l.note}</span></span><b>${l.price_text}</b></div>`)}</div></div>
      <p class="def">Khách (công khai) chỉ xem thông tin giới thiệu. Không truy cập được nhật ký trại, tài chính, khách hàng hay công nợ. Hình linh vật là tranh minh hoạ, không phải ảnh chim thật.</p>
    </main>`;
}
export function mountPublic(root, app) {
  root.querySelector('[data-back-owner]')?.addEventListener('click', () => { setDemoRole('owner'); app.store.user = demoUser(); location.hash = '#/'; app.render(); });
  root.querySelector('[data-login]')?.addEventListener('click', () => renderLogin(app));
}

/** Đổi mật khẩu (Chủ trại & Nhân viên tự đổi) — xác thực mật khẩu hiện tại qua Supabase Auth, app không lưu mật khẩu. */
function openChangePassword(app) {
  const email = app.store.user?.email || '';
  openSheet({
    title: 'Đổi mật khẩu', subtitle: email, size: 'small',
    body: html`<form class="form" data-pw autocomplete="on">
      <input type="text" name="username" autocomplete="username" value="${email}" hidden readonly>
      ${field('Mật khẩu hiện tại', html`<input type="password" name="current" autocomplete="current-password" required>`)}
      ${field('Mật khẩu mới', html`<input type="password" name="next" autocomplete="new-password" minlength="${PASSWORD_MIN}" required>`, `Ít nhất ${PASSWORD_MIN} ký tự, khác mật khẩu hiện tại.`)}
      ${field('Nhập lại mật khẩu mới', html`<input type="password" name="confirm" autocomplete="new-password" required>`)}
      <label class="check"><input type="checkbox" data-show-pw> Hiện mật khẩu</label>
      <div class="form-msg" data-msg></div></form>`,
    footer: html`<button class="btn ghost" data-close>Huỷ</button><button class="btn primary" data-save>${icon('check')} Đổi mật khẩu</button>`,
    onMount: (el) => {
      const form = el.querySelector('[data-pw]'); const msg = el.querySelector('[data-msg]'); const btn = el.querySelector('[data-save]');
      el.querySelector('[data-show-pw]').addEventListener('change', (e) => form.querySelectorAll('input[type=password],input[data-pw-shown]').forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; i.toggleAttribute('data-pw-shown', e.target.checked); }));
      const submit = async () => {
        const v = formValues(form);
        const errs = validatePasswordChange(v);
        if (errs.length) { showMessages(msg, errs); return; }
        await busy(btn, async () => {
          try {
            await app.store.adapter.changePassword(v.current, v.next);
            form.reset();
            el.querySelector('.sheet-body').innerHTML = String(html`<div class="msg ok" role="status" data-pw-done>${icon('check')}<div><b>Đã đổi mật khẩu thành công.</b><br>Máy này vẫn đăng nhập. Các thiết bị khác đang dùng tài khoản này sẽ phải đăng nhập lại bằng mật khẩu mới.</div></div>`);
            el.querySelector('.sheet-foot').innerHTML = String(html`<button class="btn primary block" data-close>Đóng</button>`);
            toast('Đã đổi mật khẩu');
          } catch (err) {
            showMessages(msg, [passwordErrorMessage(err)]);
            if (err?.code === 'wrong_current') { form.current.value = ''; form.current.focus(); }
          }
        }, 'Đang đổi…');
      };
      btn.addEventListener('click', submit);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    },
  });
}

/** Đăng nhập thật (chỉ dùng ở chế độ Supabase). */
export function renderLogin(app) {
  const root = document.getElementById('app');
  root.innerHTML = String(html`<main><div class="login-wrap"><div class="public-hero">${mascot(110)}<h1>Yến Phụng Pet</h1><p>Thế Giới Yến Phụng</p></div>
    <form class="card form" data-login>
      ${field('Email', html`<input type="email" name="email" autocomplete="username" required>`)}
      ${field('Mật khẩu', html`<input type="password" name="password" autocomplete="current-password" required>`)}
      <button class="btn primary" type="submit">${icon('shield')} Đăng nhập</button>
      <div class="form-msg" data-msg></div>
      <p class="small muted">Tài khoản do chủ trại cấp trong Supabase Auth. Quyền (Chủ trại / Nhân viên) được kiểm soát phía máy chủ.</p></form></div></main>`);
  root.querySelector('[data-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    await busy(btn, async () => {
      try {
        const v = formValues(e.target);
        await app.store.adapter.signIn(v.email, v.password);
        location.reload();
      } catch (err) { showMessages(e.target.querySelector('[data-msg]'), [`Đăng nhập thất bại: ${err.message}`]); }
    }, 'Đang đăng nhập…');
  });
}
