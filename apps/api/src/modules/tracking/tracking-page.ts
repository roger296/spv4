/**
 * The public tracking page (spec section 10). Server-rendered HTML in the account's branding.
 * Shows the town only, never the full address.
 */
import type { accounts, orders, trackingEvents } from '../../db/schema/index.js';

type Account = typeof accounts.$inferSelect;
type Order = typeof orders.$inferSelect;
type Event = typeof trackingEvents.$inferSelect;

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STATUS_COPY: Record<string, string> = {
  NEW: 'Being prepared', UPDATE_PRODUCT: 'Being prepared', LABEL_GENERATED: 'Label printed, awaiting collection', SHIPPED: 'With the courier',
  IN_TRANSIT: 'On its way', DELIVERED: 'Delivered', PROBLEM: 'Needs attention', CANCELLED: 'Cancelled',
};

export function renderTrackingPage(account: Account | null, order: Order | null, events: Event[], error: string | null): string {
  const brand = account?.settings.trackingBranding ?? {};
  const colour = brand.colour ?? '#3B5266';
  const name = esc(account?.name ?? 'Smooth Parcel');
  const title = order ? `Parcel ${esc(order.trackingNumber ?? order.orderNumber)}` : 'Track your parcel';
  const body = error
    ? `<p class="muted">${esc(error)}</p>`
    : order
      ? `
      <p class="status">${esc(STATUS_COPY[order.status] ?? order.status)}</p>
      <dl>
        <dt>Order</dt><dd>${esc(order.orderNumber)}</dd>
        <dt>Courier</dt><dd>${esc(order.courierName ?? '')} ${esc(order.methodName ?? '')}</dd>
        <dt>Tracking number</dt><dd>${esc(order.trackingNumber ?? '')}${order.trackingLink ? ` · <a href="${esc(order.trackingLink)}" rel="noopener">Courier tracking</a>` : ''}</dd>
        <dt>Going to</dt><dd>${esc(order.city ?? '')}${order.country ? `, ${esc(order.country)}` : ''}</dd>
      </dl>
      <h2>History</h2>
      ${events.length ? `<ol class="timeline">${[...events].reverse().map((e) => `<li><time>${esc(e.occurredAt.toISOString().replace('T', ' ').slice(0, 16))}</time><span>${esc(e.courierStatus)}${e.location ? ` — ${esc(e.location)}` : ''}</span></li>`).join('')}</ol>` : '<p class="muted">No courier scans yet. Tracking usually starts once the parcel has been collected.</p>'}
      <h2>Something wrong?</h2>
      <form method="post" action="/v4/track/${esc(account!.slug)}/${encodeURIComponent(order.trackingNumber ?? order.orderNumber)}/report" onsubmit="return report(event)">
        <textarea name="message" required maxlength="2000" placeholder="Tell us what has happened"></textarea>
        <button type="submit">Report a problem</button>
        <p id="reported" class="muted" hidden>Thank you. The sender has been told.</p>
      </form>`
      : '<p class="muted">Enter your tracking number in the address bar.</p>';
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${name}</title>
<style>
:root{--c:${esc(colour)}}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f5f4f0;color:#15161a}
main{max-width:640px;margin:0 auto;padding:24px 16px}header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header img{height:40px}header h1{font-size:20px;margin:0}
.card{background:#fff;border:1px solid #c7ccd1;padding:20px}.status{font-size:24px;font-weight:700;color:var(--c);margin:0 0 16px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 20px}dt{color:#6b6e76}dd{margin:0}
h2{font-size:16px;margin:24px 0 8px}.timeline{list-style:none;padding:0;margin:0;border-left:2px solid var(--c)}.timeline li{padding:6px 0 6px 14px;display:flex;gap:12px}.timeline time{color:#6b6e76;white-space:nowrap;font-variant-numeric:tabular-nums}
.muted{color:#6b6e76}textarea{width:100%;min-height:80px;box-sizing:border-box;padding:8px;border:1px solid #c7ccd1}button{background:var(--c);color:#fff;border:0;padding:10px 16px;margin-top:8px;cursor:pointer}
footer{margin-top:24px;font-size:13px;color:#6b6e76}a{color:var(--c)}
</style></head><body><main>
<header>${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="">` : ''}<h1>${name}</h1></header>
<div class="card">${body}</div>
<footer>${brand.supportEmail ? `Questions? <a href="mailto:${esc(brand.supportEmail)}">${esc(brand.supportEmail)}</a> · ` : ''}Powered by Smooth Parcel</footer>
</main>
<script>
async function report(e){e.preventDefault();const f=e.target;const r=await fetch(f.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:f.message.value})});if(r.ok){f.message.value='';document.getElementById('reported').hidden=false;}return false;}
</script></body></html>`;
}
