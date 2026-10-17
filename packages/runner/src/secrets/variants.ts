/**
 * The forms a secret's value takes on its way through an app: escaped in JSON, percent-encoded in
 * a URL, form-encoded in a request body (`+` for a space), HTML-escaped in a page, base64-encoded
 * in a header or token. Redaction looks for each of them, ignoring case where case carries no
 * meaning (hex digits, entity names, a value that reached the page upper-cased), so a value is not
 * missed because it was written another way.
 */

/** HTML's escapes of the characters it must escape. */
const HTML: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function htmlEscaped(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => HTML[char] ?? char)
}

/** `value` with the characters a regular expression gives meaning to escaped. */
function literally(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** One way a value can appear: the text, and whether case matters in it. */
interface Variant {
  readonly text: string
  readonly caseMatters: boolean
}

/** Every distinct form of `value` worth looking for. */
function formsOf(value: string): Variant[] {
  const encoded = encodeURIComponent(value)
  const forms: Variant[] = [
    { text: value, caseMatters: false },
    { text: JSON.stringify(value).slice(1, -1), caseMatters: false },
    { text: encoded, caseMatters: false },
    { text: encoded.replaceAll("%20", "+"), caseMatters: false },
    { text: htmlEscaped(value), caseMatters: false },
    { text: Buffer.from(value).toString("base64"), caseMatters: true },
    { text: Buffer.from(value).toString("base64url"), caseMatters: true },
  ]
  const seen = new Set<string>()

  return forms.filter((form) => {
    const key = `${form.caseMatters}:${form.text}`

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

/** Patterns that find `value` in any of its forms. */
export function variantsOf(value: string): readonly RegExp[] {
  return formsOf(value).map(
    (form) => new RegExp(literally(form.text), form.caseMatters ? "g" : "gi"),
  )
}
