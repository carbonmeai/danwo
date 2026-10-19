import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { FAVICON, LOCKUP_ON_DARK, LOCKUP_ON_LIGHT } from "../src/runner/report-brand.ts"
import { renderReport } from "../src/runner/report-html.ts"

const BRAND = join(import.meta.dirname, "..", "..", "..", "brand", "svg")

/** The bytes a base64 SVG data URI carries. */
function bytesOf(uri: string): Buffer {
  return Buffer.from(uri.replace(/^data:image\/svg\+xml;base64,/, ""), "base64")
}

/** Whether `uri` carries exactly the brand file `name`. */
function matches(uri: string, name: string): boolean {
  return bytesOf(uri).equals(readFileSync(join(BRAND, name)))
}

describe("the report's brand", () => {
  it("embeds the brand folder's favicon and lockups unchanged", () => {
    expect(matches(FAVICON, "favicon.svg")).toBe(true)
    expect(matches(LOCKUP_ON_LIGHT, "danwo-lockup-horizontal-on-light.svg")).toBe(true)
    expect(matches(LOCKUP_ON_DARK, "danwo-lockup-horizontal-on-dark.svg")).toBe(true)
  })

  it("puts the favicon in the head and the lockup above the title", () => {
    const html = renderReport("20261019-120000-ab12", [])

    expect(html).toContain(`<link rel="icon" type="image/svg+xml" href="${FAVICON}">`)
    expect(html.indexOf('alt="dánwò"')).toBeLessThan(html.indexOf("<h1>"))
  })
})
