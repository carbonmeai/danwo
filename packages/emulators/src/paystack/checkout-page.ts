/**
 * The hosted payment page the emulator serves at `checkout.paystack.com/<access code>`: card,
 * bank transfer and USSD, with the PIN and OTP steps some test cards ask for. Plain HTML with
 * accessible names, so a browser agent or a locator can pay through it.
 */
import { escapeHtml } from "../stripe/checkout-page.ts"
import { testCardNumbers } from "./cards.ts"
import type { Transaction, TransactionExtra } from "./entities.ts"
import { formatAmount } from "./helpers.ts"

const STYLE = `
  :root { color-scheme: light dark; --ink: #011b33; --muted: #6b7b8c; --line: #e3e8ee;
    --accent: #09a5db; --ok: #3bb75e; --paper: #ffffff; --wash: #f3f6f9; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e6edf3; --muted: #9aa8b5;
    --line: #2b3440; --paper: #161c24; --wash: #0e1319; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
  main { max-width: 420px; margin: 40px auto; padding: 24px; background: var(--paper);
    border: 1px solid var(--line); border-radius: 10px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 15px; margin: 22px 0 6px; }
  .who { color: var(--muted); margin: 2px 0 14px; }
  .note { color: var(--muted); font-size: 13px; }
  label { display: block; color: var(--muted); font-size: 13px; margin-top: 10px; }
  input { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font: inherit; }
  button { width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 6px;
    background: var(--ok); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.quiet { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  [role=alert] { color: #d33; margin: 8px 0; }
  code { font-size: 16px; }
`

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

function heading(transaction: Transaction): string {
  const amount = formatAmount(transaction.amount, transaction.currency)

  return `<h1 data-testid="amount">Pay ${escapeHtml(amount)}</h1>
<p class="who">${escapeHtml(transaction.customer.email)}</p>`
}

function alert(message: string | undefined): string {
  return message === undefined ? "" : `<p role="alert">${escapeHtml(message)}</p>`
}

function cardForm(code: string, amount: string): string {
  return `<section aria-labelledby="card"><h2 id="card">Pay with Card</h2>
<form method="post" action="/${code}/card">
  <label>Card number <input name="number" inputmode="numeric" autocomplete="cc-number" required></label>
  <label>Expiry (MM/YY) <input name="expiry" placeholder="MM/YY" autocomplete="cc-exp" required></label>
  <label>CVV <input name="cvv" inputmode="numeric" autocomplete="cc-csc" required></label>
  <button type="submit">Pay ${escapeHtml(amount)}</button>
</form>
<p class="note">Test cards: ${testCardNumbers().join(", ")}</p></section>`
}

function transferForm(code: string, amount: string): string {
  return `<section aria-labelledby="transfer"><h2 id="transfer">Pay with Bank Transfer</h2>
<p>Transfer ${escapeHtml(amount)} to <code data-testid="transfer-account">9000000000</code> (Test Bank).</p>
<form method="post" action="/${code}/transfer"><button type="submit">I've sent the money</button></form></section>`
}

function ussdForm(code: string): string {
  return `<section aria-labelledby="ussd"><h2 id="ussd">Pay with USSD</h2>
<p>Dial <code data-testid="ussd-code">*737*000*${escapeHtml(code.slice(0, 4))}#</code> on your phone.</p>
<form method="post" action="/${code}/ussd"><button type="submit">I've completed the payment</button></form></section>`
}

/** The page to choose how to pay, with an error from the last attempt if there was one. */
export function choosePage(
  transaction: Transaction,
  extra: TransactionExtra,
  error?: string,
): string {
  const code = extra.accessCode
  const amount = formatAmount(transaction.amount, transaction.currency)
  const sections = [
    extra.channels.includes("card") ? cardForm(code, amount) : "",
    extra.channels.includes("bank_transfer") ? transferForm(code, amount) : "",
    extra.channels.includes("ussd") ? ussdForm(code) : "",
  ]

  return page(
    "Paystack Checkout",
    `${heading(transaction)}${alert(error)}${sections.join("")}
<form method="post" action="/${code}/cancel"><button class="quiet" type="submit">Cancel payment</button></form>`,
  )
}

/** One more step a card asks for: its PIN, or the OTP the bank sent. */
export function stepPage(
  transaction: Transaction,
  extra: TransactionExtra,
  step: "pin" | "otp",
  error?: string,
): string {
  const field =
    step === "pin"
      ? `<label>Card PIN <input name="pin" type="password" inputmode="numeric" required></label>`
      : `<p>Enter the OTP sent to your phone.</p>
  <label>OTP <input name="otp" inputmode="numeric" autocomplete="one-time-code" required></label>`

  return page(
    "Paystack Checkout",
    `${heading(transaction)}${alert(error)}
<form method="post" action="/${extra.accessCode}/${step}">
  ${field}
  <button type="submit">${step === "pin" ? "Continue" : "Authorize"}</button>
</form>`,
  )
}

/** The page after paying, when the transaction has no callback URL to return to. */
export function donePage(transaction: Transaction, outcome: "paid" | "cancelled"): string {
  const message =
    outcome === "paid"
      ? `<h1>Payment successful</h1><p>You paid ${escapeHtml(formatAmount(transaction.amount, transaction.currency))}.</p>`
      : "<h1>Payment cancelled</h1><p>No money was taken.</p>"

  return page(
    "Paystack Checkout",
    `${message}<p class="note">Reference: ${escapeHtml(transaction.reference)}</p>`,
  )
}
