/**
 * `inspect_page` in the job process: starts the project's environment as a worker would, opens a
 * path of the app in danwo's browser behind the environment's proxy, and reads the page as an
 * accessibility tree, the same view danwo's agent gets. A locator can be tried on the page too.
 * Every text that leaves is redacted: the config's secret values and credential shapes.
 */
import { launchBrowser, redactCredentials, SecretVault } from "@danwo/runner"
import { type DanwoConfig, loadConfig, type WorkerEnvironment } from "@danwo/runner/runner"
import type { Locator, Page } from "playwright-core"

import { locate, locatorCode } from "../locators.ts"
import type { Job, JobPlace, LocatorMatch, LocatorQuery, PageInspection } from "./protocol.ts"

/** About 20k tokens of page text at most. */
const MAX_TREE_CHARS = 80_000
const MAX_MATCHES = 5
const MAX_MATCH_CHARS = 400
const LOAD_TIMEOUT_MS = 30_000

/** The page's snapshot without the agent's element refs, which mean nothing to a test author. */
function treeOf(snapshot: string): string {
  const tree = snapshot.replace(/ \[ref=(?:f\d+)?e\d+\]/g, "")

  return tree.length > MAX_TREE_CHARS
    ? `${tree.slice(0, MAX_TREE_CHARS)}\n… (page cut at ${MAX_TREE_CHARS} characters)`
    : tree
}

async function matchOf(locator: Locator, redact: (text: string) => string): Promise<LocatorMatch> {
  const snapshot = redact(await locator.ariaSnapshot({ timeout: 2_000 }).catch(() => ""))

  return { visible: await locator.isVisible(), snapshot: snapshot.slice(0, MAX_MATCH_CHARS) }
}

async function tryLocator(
  page: Page,
  query: LocatorQuery,
  redact: (text: string) => string,
): Promise<NonNullable<PageInspection["locator"]>> {
  const locator = locate(page, query)
  const count = await locator.count()
  const shown = Math.min(count, MAX_MATCHES)
  const matches: LocatorMatch[] = []

  for (let index = 0; index < shown; index++)
    matches.push(await matchOf(locator.nth(index), redact))

  return { code: locatorCode(query), count, matches }
}

/** Redacts the config's secret values and anything shaped like a credential. */
function redactorOf(config: DanwoConfig): (text: string) => string {
  const vault = new SecretVault(config.secrets)

  return (text) => redactCredentials(vault.redact(text))
}

async function readPage(
  baseUrl: string,
  env: WorkerEnvironment | undefined,
  job: Extract<Job, { kind: "inspect" }>,
  redact: (text: string) => string,
): Promise<PageInspection> {
  const proxy = env?.proxy && { url: env.proxy.url, caSpki: env.proxy.caSpki }
  const browser = await launchBrowser({ ...(proxy && { proxy }), headless: true })

  try {
    const page = await (await browser.newContext()).newPage()

    await page.goto(new URL(job.path, baseUrl).href, { timeout: LOAD_TIMEOUT_MS })

    const tree = treeOf(await page.ariaSnapshot({ mode: "ai", timeout: 10_000 }))
    const inspection = {
      url: redact(page.url()),
      title: redact(await page.title()),
      tree: redact(tree),
    }

    return job.locator === undefined
      ? inspection
      : { ...inspection, locator: await tryLocator(page, job.locator, redact) }
  } finally {
    await browser.close()
  }
}

export async function inspectPage(
  job: Extract<Job, { kind: "inspect" }>,
  place: JobPlace,
): Promise<PageInspection> {
  const { config } = await loadConfig(place.cwd, place.config)
  const env = await config.environment?.({ workerIndex: 0 })

  try {
    const baseUrl = env?.baseUrl ?? config.baseUrl

    if (baseUrl === undefined) {
      throw new Error("the project has no baseUrl: set one in danwo.config.ts or its environment")
    }

    return await readPage(baseUrl, env, job, redactorOf(config))
  } finally {
    await env?.close()
  }
}
