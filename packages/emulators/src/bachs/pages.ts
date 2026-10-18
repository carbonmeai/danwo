/**
 * The pages Bachs hosts, as the emulator serves them: the checkout page, the card-update page a
 * recovery email links to, and the customer portal. Plain HTML with labelled fields and stable test
 * ids, so a browser agent or a locator can drive them.
 */
import { escapeHtml } from "../stripe/checkout-page.ts"
import { SUCCESS_CARD } from "./cards.ts"
import type { CheckoutSession, Subscription } from "./entities.ts"
import { money } from "./helpers.ts"

const STYLE = `
  :root { color-scheme: light dark; --ink: #14161c; --muted: #6b7280; --line: #e5e7eb;
    --accent: #0f766e; --paper: #ffffff; --wash: #f4f6f8; --bad: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e5e7eb; --muted: #9ca3af;
    --line: #2d3340; --paper: #181b22; --wash: #0f1115; --bad: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
  main { max-width: 440px; margin: 48px auto; padding: 28px; background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .note { color: var(--muted); margin: 0 0 18px; }
  .error { color: var(--bad); margin: 0 0 14px; }
  ul { list-style: none; padding: 0; margin: 0 0 14px; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .total { display: flex; justify-content: space-between; font-weight: 600; margin: 12px 0 18px; }
  label { display: block; color: var(--muted); font-size: 13px; margin-top: 10px; }
  input { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px;
    background: var(--paper); color: var(--ink); font: inherit; }
  button { width: 100%; margin-top: 16px; padding: 11px; border: 0; border-radius: 8px;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  a { color: var(--accent); }
`

/** A whole page around `content`. */
function hostedPage(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${content}</main></body>
</html>`
}

/** A page with a heading and one line, for errors and confirmations. */
export function notice(title: string, message: string): string {
  return hostedPage(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="note">${escapeHtml(message)}</p>`,
  )
}

function priced(minor: number, currency: string): string {
  return currency === "USD" ? `$${money(minor)}` : `${money(minor)} ${currency}`
}

function orderLines(checkout: CheckoutSession): string {
  return checkout.lines
    .map((line) => {
      const each = line.price.amount ?? line.price.preset ?? 0
      const shown =
        line.price.type === "custom"
          ? "Pay what you want"
          : priced(each * line.quantity, checkout.currency)

      return `<li><span>${escapeHtml(line.name)}${line.quantity > 1 ? ` × ${line.quantity}` : ""}</span><span>${shown}</span></li>`
    })
    .join("")
}

/** Email and name fields, when the checkout does not already know who is paying. */
function identityFields(checkout: CheckoutSession): string {
  if (checkout.customerId) return ""

  return `<label>Email <input name="email" type="email" autocomplete="email" required></label>
<label>Name <input name="name" autocomplete="name"></label>`
}

/** An amount field for pay-what-you-want pricing, prefilled with the suggested amount. */
function amountField(checkout: CheckoutSession): string {
  const custom = checkout.lines.find((line) => line.price.type === "custom")

  if (!custom) return ""

  const preset = custom.price.preset === null ? "" : money(custom.price.preset)

  return `<label>Amount (${escapeHtml(checkout.currency)}) <input name="amount" inputmode="decimal" value="${preset}"></label>`
}

/** The checkout page: the order, who is paying, a card field prefilled with a test card, and Pay. */
export function checkoutPage(
  checkout: CheckoutSession,
  total: number,
  error: string | null,
): string {
  const cancel = checkout.cancelUrl
    ? `<p><a href="${escapeHtml(checkout.cancelUrl)}" data-testid="bachs-cancel">Cancel and return</a></p>`
    : ""
  const trial =
    checkout.mode === "subscription"
      ? `<p class="note">Your card is saved for future renewals.</p>`
      : ""
  const label = total > 0 ? `Pay ${priced(total, checkout.currency)}` : "Complete"

  return hostedPage(
    "Bachs Checkout",
    `<h1>Checkout</h1>
<p class="note">Sandbox: no real money moves.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<ul aria-label="Order">${orderLines(checkout)}</ul>
<div class="total"><span>Total</span><span data-testid="bachs-total">${priced(total, checkout.currency)}</span></div>
${trial}
<form method="post" action="/c/${escapeHtml(checkout.token)}/pay">
${identityFields(checkout)}
${amountField(checkout)}
<label>Card number <input name="card" inputmode="numeric" value="${SUCCESS_CARD}"></label>
<button type="submit" data-testid="bachs-pay">${label}</button>
</form>
${cancel}`,
  )
}

/** The card-update page a recovery email links to. */
export function recoveryPage(token: string, error: string | null): string {
  return hostedPage(
    "Update your payment method",
    `<h1>Update your payment method</h1>
<p class="note">Your last payment failed. Enter a new card to keep your subscription.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/recover/${escapeHtml(token)}">
<label>Card number <input name="card" inputmode="numeric" value="${SUCCESS_CARD}"></label>
<button type="submit" data-testid="bachs-update-card">Update card</button>
</form>`,
  )
}

/** One subscription in the portal, with a button to cancel it at the period's end. */
function portalRow(token: string, subscription: Subscription, productName: string): string {
  const ends = subscription.cancelAtPeriodEnd
    ? ` (ends ${subscription.periodEnd.slice(0, 10)})`
    : ""
  const action =
    subscription.status === "canceled" || subscription.cancelAtPeriodEnd
      ? ""
      : `<form method="post" action="/s/${escapeHtml(token)}/cancel/${escapeHtml(subscription.id)}"><button type="submit">Cancel ${escapeHtml(productName)}</button></form>`

  return `<li><span>${escapeHtml(productName)}: ${escapeHtml(subscription.status)}${ends}</span></li>${action}`
}

/** The customer portal: the customer's subscriptions, each cancelable at the end of its period. */
export function portalPage(
  token: string,
  email: string,
  rows: readonly { subscription: Subscription; name: string }[],
): string {
  const list = rows.map((row) => portalRow(token, row.subscription, row.name)).join("")

  return hostedPage(
    "Billing portal",
    `<h1>Billing</h1><p class="note">Signed in as ${escapeHtml(email)}</p>
<ul aria-label="Subscriptions">${list || "<li>No subscriptions</li>"}</ul>`,
  )
}

/**
 * `bachs.js` for the overlay checkout: `Bachs.Initialize({ onEvent })` and
 * `Bachs.Checkout.open({ checkoutUrl })` open the hosted page in a modal iframe, and the page's
 * outcome comes back as `{ type, data }` events (`checkout.opened`, `checkout.completed`,
 * `checkout.closed`).
 */
export const OVERLAY_SCRIPT = `(() => {
  const state = { onEvent: null, local: null, frame: null, origin: null }
  const send = (handler, type, data) => { try { handler && handler({ type, data: data || {} }) } catch (e) { console.error(e) } }
  const close = (reason) => {
    if (!state.frame) return
    state.frame.remove(); state.frame = null
    send(state.onEvent, "checkout.closed", { reason }); send(state.local, "checkout.closed", { reason })
  }
  window.addEventListener("message", (event) => {
    if (!state.frame || event.origin !== state.origin || !event.data || typeof event.data.type !== "string") return
    send(state.onEvent, event.data.type, event.data.data); send(state.local, event.data.type, event.data.data)
    if (event.data.type === "checkout.completed") setTimeout(() => close("completed"), 1200)
  })
  window.Bachs = {
    Initialize(options) { state.onEvent = (options && options.onEvent) || null; return window.Bachs },
    Checkout: {
      open(args) {
        const url = new URL(args.checkoutUrl || args.token)
        state.origin = url.origin; state.local = args.onEvent || null
        const frame = document.createElement("iframe")
        frame.src = url.toString(); frame.title = "Bachs checkout"
        frame.setAttribute("style", "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:rgba(0,0,0,.4)")
        document.body.appendChild(frame); state.frame = frame
        send(state.onEvent, "checkout.opened", {}); send(state.local, "checkout.opened", {})
        return Promise.resolve()
      },
      close() { close("closed_by_merchant") },
      isOpen() { return Boolean(state.frame) },
    },
  }
})()
`

/**
 * The page after paying. In the overlay's iframe it tells the opener (`checkout.completed`); as a
 * full page it goes on to the success URL, with `?checkout_id=` appended.
 */
export function paidPage(
  checkoutId: string,
  reference: string | null,
  redirect: string | null,
): string {
  const data = JSON.stringify({ checkout_id: checkoutId, reference })
  const next = redirect
    ? `<p><a href="${escapeHtml(redirect)}" target="_top" data-testid="bachs-continue">Continue</a></p>`
    : ""
  const target = JSON.stringify(redirect)

  return hostedPage(
    "Payment received",
    `<h1>Payment received</h1><p class="note">Thanks, your payment is being confirmed.</p>${next}
<script>
if (window.parent !== window) window.parent.postMessage({ type: "checkout.completed", data: ${data} }, "*")
else if (${target}) window.location.replace(${target})
</script>`,
  )
}
