import { describe, expect, it } from "vitest"

import { type MailMessage, pickFrom } from "../src/mail/index.ts"
import { createRedactor } from "../src/runner/redact.ts"
import { quoteForCmd } from "../src/support/command-line.ts"

/** How long `run` takes, in milliseconds. */
function timed(run: () => unknown): number {
  const started = performance.now()

  run()

  return performance.now() - started
}

const mail = (html: string, text?: string): MailMessage => ({
  to: ["ada@danwo.test"],
  subject: "Your code",
  html,
  text,
})

describe("reading a mail's HTML", () => {
  it("finds a code outside script and style, wherever the end tag has spaces", () => {
    const html = `<style>p { color: red }</style><script>var x = 999999</script ><p>Code: <b>482913</b></p>`

    expect(pickFrom(mail(html), { kind: "code" })).toBe("482913")
  })

  it("reads entities as the characters they stand for", () => {
    expect(pickFrom(mail("<p>1 &lt; 2 &amp; code 7731</p>"), { kind: "code" })).toBe("7731")
  })

  it("picks a link by the words it is shown as, ignoring non-http hrefs", () => {
    const html = `<a href="mailto:help@danwo.test">Help</a> <a class="btn" href="https://app.danwo.test/verify?t=1&amp;u=2">Verify email</a>`

    expect(pickFrom(mail(html), { kind: "link", match: "verify" })).toBe(
      "https://app.danwo.test/verify?t=1&u=2",
    )
  })

  it("falls back to a bare link in the text part", () => {
    expect(
      pickFrom(mail("<p>no links</p>", "Go to https://app.danwo.test/x"), { kind: "link" }),
    ).toBe("https://app.danwo.test/x")
  })

  it("takes time in step with the body on input built to backtrack", () => {
    const bodies = [
      "<style".repeat(50_000),
      "<script>".repeat(50_000),
      `<a ${'href="http:!" '.repeat(50_000)}`,
      "<".repeat(100_000),
      `<a href="https://x.test">${"<a".repeat(50_000)}`,
    ]

    for (const html of bodies) {
      expect(timed(() => pickFrom(mail(html), { kind: "link" }))).toBeLessThan(500)
      expect(timed(() => pickFrom(mail(html), { kind: "code" }))).toBeLessThan(500)
    }
  })
})

describe("redacting a form", () => {
  it("blanks a nested card field by its leaf name, even after stray brackets", () => {
    const redactor = createRedactor((text) => text)
    const form = `payment_method_data[card][number]=4242424242424242&a[b[number]=1&name=Ada`

    expect(redactor.body(form, "application/x-www-form-urlencoded")).not.toContain("4242")
    expect(
      timed(() => redactor.body(`${"[".repeat(50_000)}=1`, "application/x-www-form-urlencoded")),
    ).toBeLessThan(500)
  })
})

describe("quoting for cmd.exe", () => {
  it("takes time in step with a long run of backslashes", () => {
    expect(timed(() => quoteForCmd("\\".repeat(100_000) + "x"))).toBeLessThan(500)
  })
})
