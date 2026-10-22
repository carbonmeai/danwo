/**
 * Draws the README's hero banner, `hero-dark.png` and `hero-light.png` (1600×800, a 800×400 page
 * at 2×). Every tile on it is danwo's own UI, made fresh from `examples/shop`: the script copies
 * the shop to a temporary folder, runs its tests and a fault matrix with the shop's planted
 * duplicate-webhook bug, serves the dashboard on a free port and screenshots parts of it in both
 * colour schemes, then renders the pull request comment and the matrix's terminal output, and
 * finally screenshots `hero.html` with those tiles. It also draws the website's social card,
 * `website/public/og.png` (1200×630), and the repository's social preview, `github-social.png`
 * (1280×640), from the same page and tiles with a "Star on GitHub" button.
 * Run it with `bun run readme-hero` (or `node brand/readme-hero/render.ts`); pass `--reuse` to
 * compose from the last run's tiles.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { micromark } from "micromark"
import { gfm, gfmHtml } from "micromark-extension-gfm"
import { type Browser, chromium, type Page } from "playwright-core"

import { commentBody, matrixSection } from "../../packages/github/src/pr-comment.ts"

const HERE = import.meta.dirname
const REPO = join(HERE, "..", "..")
const SHOP = join(REPO, "examples", "shop")
const TILES = join(tmpdir(), "danwo-readme-hero-tiles")
const SCHEMES = ["dark", "light"] as const
const TEST_FILE = "tests/buy-credits.danwo.ts"
const RECORD = "tests-buy-credits-buys-500-credits-through-stripe-checkout"
const TRIAL = "duplicate-on-webhook-checkout-session-completed"

type Scheme = (typeof SCHEMES)[number]
type MatrixReport = Parameters<typeof matrixSection>[0]

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What the shop's runs left behind for the tiles. */
interface Runs {
  readonly folder: string
  readonly testRun: string
  readonly matrixRun: string
  readonly matrixOutput: string
  readonly report: MatrixReport
}

/** Wraps the shop's config with a reporter that keeps the matrix's report for the PR comment. */
const HERO_CONFIG = `import { writeFileSync } from "node:fs"

import config from "./danwo.config.ts"

export default {
  ...config,
  reporters: [
    {
      name: "readme-hero",
      async matrixFinished(run: unknown) {
        writeFileSync("matrix-report.json", JSON.stringify(run))
      },
    },
  ],
}
`

/** The shop copied into a temporary folder named `shop`, its installed packages linked. */
function copyShop(): string {
  const folder = join(mkdtempSync(join(tmpdir(), "danwo-hero-")), "shop")

  mkdirSync(folder)

  for (const entry of readdirSync(SHOP).filter(
    (name) => name !== "node_modules" && name !== ".danwo",
  ))
    cpSync(join(SHOP, entry), join(folder, entry), { recursive: true })

  symlinkSync(join(SHOP, "node_modules"), join(folder, "node_modules"), "dir")
  writeFileSync(join(folder, "hero.config.ts"), HERO_CONFIG)

  return folder
}

/** Runs the `danwo` command in `cwd` and returns what it printed; a failing run is expected. */
function danwo(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync(join(cwd, "node_modules", ".bin", "danwo"), args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  })

  return result.stdout
}

/** The shop's clean test run and its matrix with the duplicate-webhook bug, oldest first. */
function makeRuns(folder: string): Runs {
  danwo(folder, ["test"])

  const matrixOutput = danwo(folder, ["matrix", "-c", "hero.config.ts", TEST_FILE], {
    SHOP_BUG: "no-dedupe",
  })
  const [testRun = "", matrixRun = ""] = readdirSync(join(folder, ".danwo", "runs")).toSorted()
  const report: MatrixReport = JSON.parse(readFileSync(join(folder, "matrix-report.json"), "utf8"))

  return { folder, testRun, matrixRun, matrixOutput, report }
}

/** Starts the dashboard for `folder` on a free port and resolves with its address. */
function serve(folder: string): Promise<{ readonly url: string; readonly server: ChildProcess }> {
  const server = spawn(join(folder, "node_modules", ".bin", "danwo"), ["serve", "-p", "0"], {
    cwd: folder,
    stdio: ["ignore", "pipe", "inherit"],
  })

  return new Promise((resolve, reject) => {
    let printed = ""

    server.stdout.on("data", (chunk: Buffer) => {
      printed += chunk.toString()
      const url = /http:\/\/127\.0\.0\.1:\d+/.exec(printed)?.[0]

      if (url !== undefined) resolve({ url, server })
    })
    server.once("exit", (code) => reject(new Error(`danwo serve exited with ${code}`)))
  })
}

/**
 * In the page: the box of the card around `start`, its nearest ancestor with rounded corners and
 * a background of its own, big enough to be a card rather than a button.
 */
function cardBox(start: Element): Box | undefined {
  const chain: Element[] = []

  for (let element: Element | null = start; element !== null; element = element.parentElement)
    chain.push(element)

  const card = chain.find((element) => {
    const style = getComputedStyle(element)

    return (
      parseFloat(style.borderTopLeftRadius) >= 6 &&
      style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
      element.clientWidth > 180 &&
      element.clientHeight > 60
    )
  })
  const rect = card?.getBoundingClientRect()

  return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** The card around the first text in `scope` that matches the pattern `text`. */
async function cardAround(page: Page, text: string, scope = "#main"): Promise<Box> {
  const box = await page.locator(scope).getByText(new RegExp(text)).first().evaluate(cardBox)

  if (!box) throw new Error(`no card around "${text}"`)

  return box
}

/** Fixed parts of a record's overlay, which lays out the same in a 1440×1000 window. */
const OVERLAY = {
  steps: { x: 16, y: 16, width: 395, height: 700 },
  waterfall: { x: 431, y: 80, width: 944, height: 416 },
} as const

/** The smallest box holding all of `boxes`. */
function union(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** `box` grown by `by` pixels on every side. */
const padded = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
})

async function shoot(page: Page, scheme: Scheme, name: string, clip: Box): Promise<void> {
  await page.screenshot({ path: join(TILES, scheme, `${name}.png`), clip })
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
}

/** The overview's figures and the test that breaks under a fault. */
async function overviewTiles(page: Page, scheme: Scheme, base: string): Promise<void> {
  await open(page, `${base}/`)

  const cards = await Promise.all(["^Pass rate$", "^Runs$"].map((text) => cardAround(page, text)))

  await shoot(page, scheme, "overview", union(cards))
  await shoot(page, scheme, "breaks", await cardAround(page, "^Breaks under faults"))
}

/** The matrix run's page: its verdict card and the fault grid with the failed trial beside it. */
async function matrixTiles(page: Page, scheme: Scheme, base: string, runs: Runs): Promise<void> {
  await open(page, `${base}/runs/${runs.matrixRun}`)
  await shoot(page, scheme, "verdict", await cardAround(page, "^Broke under"))

  const grid = await cardAround(page, "^Provider calls$")
  const trial = await cardAround(page, "^Watch this trial$")

  await shoot(page, scheme, "matrix", padded(union([grid, trial]), 17))
}

/** The failed trial's record: whose bug it is and the steps up to the failure. */
async function trialTile(page: Page, scheme: Scheme, base: string, runs: Runs): Promise<void> {
  const record = `.danwo/runs/${runs.matrixRun}/${RECORD}/${TRIAL}`

  await open(page, `${base}/runs/${runs.matrixRun}?open=${encodeURIComponent(record)}`)

  await shoot(page, scheme, "trial", OVERLAY.steps)
}

/** The clean record: the replay at the last step, the steps, the providers' waterfall and calls. */
async function recordTiles(page: Page, scheme: Scheme, base: string, runs: Runs): Promise<void> {
  const record = `.danwo/runs/${runs.testRun}/${RECORD}/attempt-1`

  await open(page, `${base}/runs/${runs.testRun}?open=${encodeURIComponent(record)}`)
  await page
    .locator("button", { hasText: /^0:0\d\.\d$/ })
    .nth(5)
    .click()
  await page.waitForTimeout(1500)

  const video = await page.locator("video").boundingBox()

  if (video) {
    const { x, y, width, height } = video

    await shoot(page, scheme, "replay", {
      x: x - 72,
      y: y - 12,
      width: width + 144,
      height: height + 64,
    })
  }

  await page.getByText("Providers", { exact: true }).click()
  await page.waitForTimeout(1200)
  await shoot(page, scheme, "providers", OVERLAY.waterfall)
  await shoot(page, scheme, "calls", {
    ...(await cardAround(page, "^Took$", "[role=dialog]")),
    height: 330,
  })
}

/** Every dashboard tile in one colour scheme. */
async function dashboardTiles(browser: Browser, scheme: Scheme, base: string, runs: Runs) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  })
  const page = await context.newPage()

  await overviewTiles(page, scheme, base)
  await matrixTiles(page, scheme, base, runs)
  await trialTile(page, scheme, base, runs)
  await recordTiles(page, scheme, base, runs)
  await context.close()
}

const FONTS = `
  @font-face { font-family: Inter; font-weight: 100 900; src: url("${pathToFileURL(join(REPO, "packages/dashboard/public/fonts/InterVariable.woff2")).href}"); }
  @font-face { font-family: "Geist Mono"; font-weight: 100 900; src: url("${pathToFileURL(join(REPO, "packages/dashboard/public/fonts/GeistMono-Variable.woff2")).href}"); }
`

/** Colours for the HTML tiles, as GitHub and a terminal show them in each scheme. */
const PALETTE: Record<Scheme, string> = {
  dark: "--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--head:#151b23;--code:#262c36;--term:#0b0b0c;--pass:#3fb950;--fail:#f85149",
  light:
    "--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--head:#f6f8fa;--code:#eff1f3;--term:#fafafa;--pass:#1a7f37;--fail:#cf222e",
}

/** Screenshots `body` as a page of its own, 560 CSS pixels wide, at 2×. */
async function htmlTile(browser: Browser, scheme: Scheme, name: string, body: string) {
  const page = await browser.newPage({
    viewport: { width: 560, height: 400 },
    deviceScaleFactor: 2,
  })

  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}${readFileSync(join(HERE, "tiles.css"), "utf8")}</style></head><body style="${PALETTE[scheme]}">${body}</body></html>`,
  )
  await page.evaluate(() => document.fonts.ready)
  await page
    .locator("body > *")
    .first()
    .screenshot({ path: join(TILES, scheme, `${name}.png`) })
  await page.close()
}

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** The pull request comment `packages/github` writes for the matrix run, as GitHub shows it. */
function prCommentHtml(runs: Runs): string {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim()
  const links = {
    runUrl: "https://github.com/carbonmeai/danwo/actions",
    artifact: "danwo-runs",
    reportUrl: undefined,
    sha,
  }
  const markdown = commentBody(undefined, matrixSection(runs.report, links))
  const html = micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })

  return `<section class="comment"><header><b>github-actions</b> <span class="bot">bot</span> commented</header><article>${html}</article></section>`
}

/** `danwo matrix`'s output, each trial on one line, as a terminal shows it. */
function terminalHtml(runs: Runs): string {
  const lines = runs.matrixOutput
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("        "))
    .map((line) =>
      escape(line)
        .replace(/^PASS/, '<i class="pass">PASS</i>')
        .replace(/^FAIL/, '<i class="fail">FAIL</i>'),
    )

  return `<pre class="terminal"><span class="prompt">$</span> danwo matrix ${TEST_FILE}\n\n${lines.join("\n")}</pre>`
}

/** Where each picture goes, and the size of the page it is drawn from. */
const PICTURES = {
  dark: { path: join(HERE, "hero-dark.png"), scheme: "dark", height: 400, scale: 2, card: "" },
  light: { path: join(HERE, "hero-light.png"), scheme: "light", height: 400, scale: 2, card: "" },
  og: {
    path: join(REPO, "website", "public", "og.png"),
    scheme: "dark",
    height: 420,
    scale: 1.5,
    card: "&card=og",
  },
  github: {
    path: join(HERE, "github-social.png"),
    scheme: "dark",
    height: 400,
    scale: 1.6,
    card: "&card=github",
  },
} as const

/** Composes one picture from the tiles and writes it where `PICTURES` says. */
async function compose(browser: Browser, picture: keyof typeof PICTURES): Promise<string> {
  const { path, scheme, height, scale, card } = PICTURES[picture]
  const page = await browser.newPage({
    viewport: { width: 800, height },
    deviceScaleFactor: scale,
  })

  await page.goto(
    `${pathToFileURL(join(HERE, "hero.html")).href}?theme=${scheme}&tiles=${pathToFileURL(TILES).href}${card}`,
  )
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle")
  await page.screenshot({ path })
  await page.close()

  return path
}

/** Shrinks `path` losslessly with oxipng, when it is installed. */
function optimise(path: string): void {
  const result = spawnSync("oxipng", ["-o", "4", "--strip", "safe", path], { stdio: "inherit" })

  if (result.error) console.log("oxipng is not installed; the PNG is left as Chromium wrote it")
}

/** Runs the shop, serves its dashboard and captures every tile in both schemes. */
async function captureTiles(browser: Browser): Promise<void> {
  rmSync(TILES, { recursive: true, force: true })

  const runs = makeRuns(copyShop())
  const { url, server } = await serve(runs.folder)

  try {
    for (const scheme of SCHEMES) {
      mkdirSync(join(TILES, scheme), { recursive: true })
      await dashboardTiles(browser, scheme, url, runs)
      await htmlTile(browser, scheme, "pr-comment", prCommentHtml(runs))
      await htmlTile(browser, scheme, "terminal", terminalHtml(runs))
    }
  } finally {
    server.kill("SIGTERM")
    rmSync(join(runs.folder, ".."), { recursive: true, force: true })
  }
}

const browser = await chromium.launch()

try {
  if (!(process.argv.includes("--reuse") && existsSync(TILES))) await captureTiles(browser)

  for (const picture of ["dark", "light", "og", "github"] as const) {
    const path = await compose(browser, picture)

    optimise(path)
    console.log(`${path}: ${Math.round(statSync(path).size / 1024)} KB`)
  }
} finally {
  await browser.close()
}
