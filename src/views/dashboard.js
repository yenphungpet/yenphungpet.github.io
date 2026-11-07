import { html } from '../ui/html.js';
import { icon } from '../ui/icons.js';
import { mascot } from '../ui/brand.js';
import { statTile, badge } from '../ui/components.js';
import { dashboardMetrics, todayTasks, METRIC_DEFS, alertCount, heroLine } from '../domain/dashboard.js';
import { fmtMoneyShort } from '../core/format.js';
import { fmtDate } from '../core/dates.js';

export function render(app) {
  const s = app.store;
  const today = s.today();
  const { metrics: m, alerts } = dashboardMetrics(s.db, today, s.settings);
  const tasks = todayTasks(s.db, today, s.settings, s.role, (id) => s.userName(id));
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const fresh = s.adapter.kind === 'demo' || !s.lastLoad ? null : s.stale ? html`<p class="msg warn">${icon('alert')} <span>${s.status.message}. Số dưới đây có thể chưa mới.</span></p>` : html`<p class="small muted">Số liệu từ máy chủ lúc ${new Date(s.lastLoad).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</p>`;
  const canFin = s.can('finance.read');

  return { html: html`
    <section class="hero">
      ${mascot(78, { wave: true })}
      <div><h1>${greet}!</h1><p>${fmtDate(today)} · ${s.settings.farmName || 'Trại Yến Phụng'}</p>
      <p>${heroLine(tasks.length, alertCount(alerts))}</p></div>
    </section>

    ${fresh}
    <div class="section"><h2>Lồng sinh sản</h2><a href="#/cages">Xem tất cả</a></div>
    <div class="stats">
      ${statTile('Tổng lồng sinh sản', m.cages, { href: '#/cages', def: METRIC_DEFS.cages })}
      ${statTile('Đang hoạt động', m.activeCages, { tone: 'green', href: '#/cages?f=active', def: METRIC_DEFS.activeCages, sub: 'có lứa đang mở' })}
      ${statTile('Cặp đang nghỉ', m.resting, { href: '#/cages?f=resting', def: METRIC_DEFS.resting })}
      ${statTile('Trứng đang có', m.eggs, { tone: 'gold', href: '#/cages?f=incubating', def: METRIC_DEFS.eggs, sub: 'còn trong tổ' })}
      ${statTile('Chim non đang có', m.chicks, { tone: 'green', href: '#/cages?f=rearing', def: METRIC_DEFS.chicks, sub: 'trong tổ sinh sản' })}
      ${statTile('Chim lồng phóng', m.penTotal, { href: '#/pens', def: METRIC_DEFS.penTotal, sub: `${m.pens.length} lồng đang dùng${m.penOriginUnknown ? ` · ${m.penOriginUnknown} con chưa rõ nguồn gốc` : ''}` })}
      ${statTile('Chim có thể bán', m.saleable.known ? m.saleable.qty : '—', { def: METRIC_DEFS.saleable, sub: m.saleable.known ? 'đã xác nhận đủ điều kiện' : 'Chưa xác định' })}
      ${statTile('Chim giống', m.breeders.total, { tone: 'gold', href: '#/breeders', def: METRIC_DEFS.breederTotal, sub: `${m.breeders.inBreederPen} ở khu giống · ${m.breeders.paired} đang ghép ở lồng SS` })}
    </div>
    <p class="def">Cách tính: trứng đang có = trứng đã đẻ − đã nở − hỏng − không cồ − đã chuyển đi, của mọi lứa đang mở, cộng nhóm trứng nhận từ lồng khác; khớp tổng ô Trứng trên thẻ lồng. Chim non chỉ tính chim còn trong tổ; chim đã ra lồng phóng tính ở lồng phóng, không cộng trùng. Chuyển giữa các lồng phóng không đổi tổng. Chim có thể bán chỉ tính chim đã xác nhận đủ điều kiện, không suy từ số chim lồng phóng. Mỗi chim giống đếm một lần.</p>

    <div class="section"><h2>Việc cần làm hôm nay</h2><a href="#/checklist">Checklist</a></div>
    <div class="card">
      ${tasks.length ? html`<div class="list">${tasks.map((t) => html`<a class="row" href="${t.href}">
        <span class="row-icon ${t.kind === 'health' ? 'red' : t.kind === 'rest' || t.kind === 'stock' ? 'gold' : ''}">${icon(t.icon)}</span>
        <span class="grow"><span class="title">${t.title}</span><br><span class="desc">${t.detail}</span></span>${icon('chevron')}</a>`)}</div>`
        : html`<div class="empty">${icon('check')}<p>Không có việc tồn đọng.</p></div>`}
    </div>

    <div class="section"><h2>Cảnh báo</h2></div>
    <div class="card ${alerts.stale.length || alerts.health.length ? 'alert-card' : ''}">
      <div class="list">
        <a class="row" href="#/cages?f=stale"><span class="row-icon gold">${icon('history')}</span>
          <span class="grow"><span class="title">Lồng quá ${s.settings.staleUpdateDays} ngày chưa cập nhật</span><br>
          <span class="desc">${alerts.stale.length ? alerts.stale.slice(0, 10).map((x) => `${x.cage.code} (${x.daysSinceUpdate === null ? 'chưa có' : x.daysSinceUpdate + 'n'})`).join(', ') : 'Không có'}</span></span>
          ${badge(alerts.stale.length, alerts.stale.length ? 'warn' : 'ok')}</a>
        <a class="row" href="#/cages?f=longrest"><span class="row-icon">${icon('moon')}</span>
          <span class="grow"><span class="title">Cặp nghỉ đẻ lâu / quá hạn đánh giá</span><br>
          <span class="desc">${alerts.longRest.length ? alerts.longRest.map((x) => `${x.cage.code} (${x.rest.days}n)`).join(', ') : 'Không có'} · chỉ nhắc đánh giá lại điều kiện nuôi & sức khoẻ</span></span>
          ${badge(alerts.longRest.length, alerts.longRest.length ? 'warn' : 'ok')}</a>
        <a class="row" href="#/health"><span class="row-icon red">${icon('heart')}</span>
          <span class="grow"><span class="title">Sức khoẻ / cách ly đang theo dõi</span><br>
          <span class="desc">${alerts.health.length ? alerts.health.map((h) => h.symptoms).join(' · ') : 'Không có hồ sơ mở'}</span></span>
          ${badge(alerts.health.length, alerts.health.length ? 'danger' : 'ok')}</a>
        <a class="row" href="#/inventory?f=low"><span class="row-icon gold">${icon('store')}</span>
          <span class="grow"><span class="title">Kho & thức ăn sắp hết</span><br>
          <span class="desc">${alerts.lowStock.length ? alerts.lowStock.map((x) => `${x.item.name}: ${String(x.balance).replace('.', ',')} ${x.item.unit}`).join(' · ') : 'Không có vật tư dưới ngưỡng'}</span></span>
          ${badge(alerts.lowStock.length, alerts.lowStock.length ? 'danger' : 'ok')}</a>
        ${m.penReconcile.qty ? html`<a class="row" href="#/pens" data-pen-reconcile><span class="row-icon gold">${icon('alert')}</span>
          <span class="grow"><span class="title">Lồng phóng đã ngừng dùng còn số chim trên sổ</span><br>
          <span class="desc">${m.penReconcile.qty} con ở ${m.penReconcile.pens} lồng. Không cộng vào tổng. Cần đối soát số chim này đang ở đâu; app không tự đổi số.</span></span>
          ${badge(m.penReconcile.qty, 'warn')}</a>` : ''}
        ${alerts.warnings.length ? html`<a class="row" href="#/cages?f=warn"><span class="row-icon red">${icon('alert')}</span>
          <span class="grow"><span class="title">Bất thường trong nhật ký gần nhất</span><br>
          <span class="desc">${alerts.warnings.map((x) => `${x.cage.code}: ${x.warnings.join(', ')}`).join(' · ')}</span></span>
          ${badge(alerts.warnings.length, 'danger')}</a>` : ''}
        ${alerts.checks.length ? html`<div class="row" data-checks><span class="row-icon gold">${icon('alert')}</span>
          <span class="grow"><span class="title">Số liệu cần đối chiếu</span><br>
          ${alerts.checks.map((c) => html`<span class="desc" style="display:block">${c.cage ? html`<a href="#/cage/${c.cage.id}">${c.cage.code}</a>: ${c.text}` : html`<a href="#/bird/${c.bird.id}">${c.text}</a>`}</span>`)}
          <span class="desc muted">Chỉ báo để kiểm tra — app không tự sửa dữ liệu.</span></span>
          ${badge(alerts.checks.length, alerts.checks.some((c) => c.level === 'danger') ? 'danger' : alerts.checks.some((c) => c.level === 'warn') ? 'warn' : 'muted')}</div>` : ''}
      </div>
    </div>

    ${canFin ? html`
    <div class="section"><h2>Thu chi tháng này</h2><a href="#/finance">Tài chính</a></div>
    <div class="stats">
      ${statTile('Thu (dòng tiền)', fmtMoneyShort(m.month.income), { tone: 'green', href: '#/finance' })}
      ${statTile('Chi', fmtMoneyShort(m.month.expense), { tone: 'red', href: '#/finance' })}
      ${statTile('Chênh lệch thu − chi', fmtMoneyShort(m.month.diff), { href: '#/finance', sub: 'không phải lợi nhuận ròng' })}
      ${statTile('Công nợ phải thu', fmtMoneyShort(m.debt.receivable), { tone: 'gold', href: '#/sales?f=debt', sub: `${m.debt.count} đơn${m.debt.refundDue ? ` · cần hoàn ${fmtMoneyShort(m.debt.refundDue)}` : ''}` })}
    </div>` : html`<p class="def">${icon('shield')} Thống kê thu chi chỉ hiển thị với vai trò Chủ trại.</p>`}
  `, mount() { if (Date.now() - (s.lastProbe || 0) > 10000) s.probeFreshness().catch(() => {}); } };
}
