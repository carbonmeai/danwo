/**
 * An MCP session's browser opens with the config's `browser.contextOptions`, as a test's does: the
 * page sees the locale, the time zone, the colour scheme and the viewport they set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { type DeskSite, deskSite } from "./desk.ts"

/** A page that prints what the browser tells it about itself. */
const SELF = `<!doctype html><title>Self</title><p id="out"></p>
<script>
  document.getElementById("out").textContent = [
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    innerWidth + "x" + innerHeight,
  ].join(" ")
</script>`

let site: DeskSite

beforeAll(async () => {
  site = await deskSite({ "/": SELF })
})

afterAll(async () => {
  await site.close()
})

describe("an MCP session's browser", () => {
  it("opens with the config's context options", async () => {
    const { text } = await site.open("/", {
      contextOptions: {
        locale: "de-DE",
        timezoneId: "Asia/Tokyo",
        colorScheme: "dark",
        viewport: { width: 800, height: 600 },
      },
    })

    expect(text).toContain("de-DE Asia/Tokyo dark 800x600")
  })
})
