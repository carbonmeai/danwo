/**
 * The hosted payment page a link opens: card details, then a PIN, an OTP or an address as the test
 * card asks; or a bank transfer, or mobile money with its OTP. Plain HTML with labelled fields and
 * named buttons, so a browser agent or locators can pay with Flutterwave's test cards.
 */
import type { LinkExtra, PaymentLink } from "./entities.ts"

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)
}

/** `7500` in `NGN` as `NGN 7,500.00`. */
function formatAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STYLE = `
  :root { color-scheme: light dark; --ink: #12122c; --muted: #6b6b80; --line: #e4e4ec;
    --accent: #f5a623; --paper: #ffffff; --wash: #f7f7fa; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ececf3; --muted: #a5a5b8;
    --line: #2d2d3c; --paper: #1a1a26; --wash: #121219; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
  main { max-width: 420px; margin: 48px auto; padding: 28px; background: var(--paper);
    border: 1px solid var(--line); border-radius: 10px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 6px; }
  .note { color: var(--muted); margin: 0 0 16px; }
  .error { color: #c62828; margin: 0 0 12px; }
  label { display: block; color: var(--muted); font-size: 13px; margin-top: 10px; }
  input { width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 6px;
    background: var(--paper); color: var(--ink); font: inherit; }
  button { width: 100%; margin-top: 14px; padding: 11px; border: 0; border-radius: 6px;
    background: var(--accent); color: #12122c; font: inherit; font-weight: 600; cursor: pointer; }
  button.quiet { background: transparent; color: var(--muted); border: 1px solid var(--line); }
`

/** A whole page around `content`. */
function checkoutHtml(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${content}</main></body>
</html>`
}

/** A page with a heading and a sentence, for links that cannot be paid. */
export function noticePage(title: string, message: string): string {
  return checkoutHtml(title, `<h1>${escape(title)}</h1><p class="note">${escape(message)}</p>`)
}

function field(label: string, name: string, extra = ""): string {
  return `<label>${escape(label)}<input name="${name}" ${extra}></label>`
}

function form(link: PaymentLink, action: string, fields: string, button: string): string {
  return `<form method="post" action="/v3/hosted/pay/${escape(link.id)}/${action}">${fields}<button type="submit">${escape(button)}</button></form>`
}

/** The first step: card, bank transfer or mobile money, as the link allows. */
function detailsStep(link: PaymentLink): string {
  const options = link.payment_options.split(",").map((option) => option.trim())
  const allows = (option: string) => link.payment_options === "" || options.includes(option)
  const total = formatAmount(link.amount, link.currency)
  const card = allows("card")
    ? `<h2>Card</h2>${form(
        link,
        "card",
        field("Card number", "card_number", 'inputmode="numeric" autocomplete="cc-number"') +
          field("Expiry date", "expiry", 'placeholder="MM/YY" autocomplete="cc-exp"') +
          field("CVV", "cvv", 'inputmode="numeric" autocomplete="cc-csc"'),
        `Pay ${total}`,
      )}`
    : ""
  const transfer = allows("banktransfer")
    ? `<h2>Bank transfer</h2><p class="note">Transfer ${escape(total)} to account 9519802749, Flutterwave MFB.</p>${form(link, "bank-transfer", "", "I've sent the money")}`
    : ""
  const mobile = allows("mobilemoney")
    ? `<h2>Mobile money</h2>${form(link, "mobile-money", field("Phone number", "phone", 'inputmode="tel"'), "Pay with mobile money")}`
    : ""

  return card + transfer + mobile
}

/** The step a customer is on, as its form. */
function stepForm(link: PaymentLink, extra: LinkExtra): string {
  switch (extra.stage) {
    case "pin":
      return form(link, "pin", field("Card PIN", "pin", 'inputmode="numeric"'), "Submit PIN")
    case "otp":
      return `<p class="note">Enter the OTP your bank sent you.</p>${form(link, "otp", field("OTP", "otp", 'inputmode="numeric" autocomplete="one-time-code"'), "Verify OTP")}`
    case "address":
      return form(
        link,
        "address",
        field("Billing address", "address") + field("City", "city") + field("Zip code", "zip"),
        "Continue",
      )
    case "mobile-otp":
      return `<p class="note">Enter the OTP sent to ${escape(extra.phone ?? "your phone")}.</p>${form(link, "mobile-otp", field("OTP", "otp", 'inputmode="numeric" autocomplete="one-time-code"'), "Verify OTP")}`
    default:
      return detailsStep(link)
  }
}

/** The payment page of `link` at the step its customer is on. */
export function payPage(link: PaymentLink, extra: LinkExtra): string {
  const total = formatAmount(link.amount, link.currency)
  const error =
    extra.error === null ? "" : `<p class="error" role="alert">${escape(extra.error)}</p>`
  const cancel = `<form method="post" action="/v3/hosted/pay/${escape(link.id)}/cancel"><button class="quiet" type="submit">Cancel payment</button></form>`

  return checkoutHtml(
    link.title || "Flutterwave Checkout",
    `<h1>${escape(link.title || "Complete your payment")}</h1>
<p class="note">${escape(link.description || link.customer.email)} · <strong data-testid="amount">${escape(total)}</strong></p>
${error}${stepForm(link, extra)}${cancel}`,
  )
}
