/**
 * The pages the emulator serves in place of Stripe's hosted ones: Checkout's payment page and an
 * invoice receipt. They are plain HTML with stable test ids and accessible names, so a browser
 * agent or a locator can drive them.
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Text made safe for HTML content and attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)
}

/** `1500` in `usd` as `$15.00`; other currencies as `15.00 EUR`. */
export function formatMoney(amount: number, currency: string): string {
  const major = (amount / 100).toFixed(2)

  return currency.toLowerCase() === "usd" ? `$${major}` : `${major} ${currency.toUpperCase()}`
}

const STYLE = `
  :root { color-scheme: light dark; --ink: #1a1f36; --muted: #697386; --line: #e3e8ee;
    --accent: #635bff; --paper: #ffffff; --wash: #f6f9fc; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e6e9f0; --muted: #a3acb9;
    --line: #2f3542; --paper: #1b1f2a; --wash: #12151c; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
  main { max-width: 440px; margin: 48px auto; padding: 28px; background: var(--paper);
    border: 1px solid var(--line); border-radius: 10px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .note { color: var(--muted); margin: 0 0 20px; }
  ul { list-style: none; padding: 0; margin: 0 0 16px; }
  li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .total { display: flex; justify-content: space-between; font-weight: 600; margin: 12px 0 20px; }
  label { display: block; color: var(--muted); font-size: 13px; margin-top: 10px; }
  input { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font: inherit; }
  button { width: 100%; margin-top: 18px; padding: 11px; border: 0; border-radius: 6px;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  a { color: var(--accent); }
`

/** A whole page around `content`. */
function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${content}</main></body>
</html>`
}

/** A page with a heading and one line of explanation, for errors and receipts. */
export function messagePage(title: string, message: string, extra = ""): string {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="note">${escapeHtml(message)}</p>${extra}`,
  )
}

export interface PayPageLine {
  readonly description: string
  readonly quantity: number
  readonly amount: number
}

export interface PayPage {
  readonly sessionId: string
  readonly lines: readonly PayPageLine[]
  readonly total: number
  readonly currency: string
  readonly email: string | null
  readonly cancelUrl: string | null
}

/**
 * Checkout's payment page: the order, a prefilled test card and a Pay button that posts to
 * `/checkout/:id/complete`.
 */
export function renderPayPage(view: PayPage): string {
  const money = (amount: number) => formatMoney(amount, view.currency)
  const lines = view.lines
    .map(
      (line) =>
        `<li><span>${escapeHtml(line.description)}${line.quantity > 1 ? ` × ${line.quantity}` : ""}</span><span>${money(line.amount)}</span></li>`,
    )
    .join("")
  const cancel = view.cancelUrl
    ? `<p><a href="${escapeHtml(view.cancelUrl)}" data-testid="checkout-cancel">Back</a></p>`
    : ""

  return page(
    "Checkout",
    `<h1>Pay danwo</h1>
<p class="note">Test mode: no real card is charged.</p>
<ul aria-label="Order">${lines}</ul>
<div class="total"><span>Total due</span><span data-testid="checkout-total">${money(view.total)}</span></div>
<form method="post" action="/checkout/${escapeHtml(view.sessionId)}/complete">
<label>Email <input name="email" type="email" value="${escapeHtml(view.email ?? "")}" autocomplete="email"></label>
<label>Card number <input name="card" value="4242 4242 4242 4242" inputmode="numeric" readonly></label>
<button type="submit" data-testid="checkout-pay">Pay ${money(view.total)}</button>
</form>
${cancel}`,
  )
}
