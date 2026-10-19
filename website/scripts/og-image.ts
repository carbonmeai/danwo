/**
 * Draws the site's social card, `public/og.png` (1200×630): the on-dark lockup from `brand/` over
 * the tagline, set in Inter. Run with `bun run --cwd website og` after the brand or tagline changes,
 * and commit the image.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { chromium } from "playwright-core"

import { SITE } from "../src/lib/site.ts"

const WEBSITE = join(import.meta.dirname, "..")
const REPO = join(WEBSITE, "..")

const lockup = readFileSync(join(REPO, "brand", "svg", "danwo-lockup-horizontal-on-dark.svg"))
const inter = readFileSync(
  join(REPO, "packages", "dashboard", "public", "fonts", "InterVariable.woff2"),
)

const html = `<!doctype html>
<html><head><style>
  @font-face { font-family: Inter; src: url("data:font/woff2;base64,${inter.toString("base64")}") format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: 1200px; height: 630px; background: #0a0a0a; }
  body { display: grid; place-content: center; justify-items: center; gap: 44px; font-family: Inter; }
  img { width: 560px; height: auto; display: block; }
  p { margin: 0; color: #a3a3a6; font-size: 40px; font-weight: 500; letter-spacing: -0.02em; }
  b { color: #ffffff; font-weight: 500; }
</style></head>
<body>
  <img alt="dánwò" src="data:image/svg+xml;base64,${lockup.toString("base64")}">
  <p>${SITE.tagline.replace(/^([^.]+\.)/, "<b>$1</b>")}</p>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })

await page.setContent(html, { waitUntil: "load" })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(WEBSITE, "public", "og.png") })
await browser.close()
