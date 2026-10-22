/**
 * Change impact: which tests a change can affect. Every passing test leaves what it touched in
 * `.danwo/impact.json`: the app's pages it visited and the provider calls and webhooks it caused,
 * as route templates. A changed file selects a test when it is the test file or a file the test
 * imports, or when the config's `impact` rules map it to a page, host or call the test touched.
 * A change nothing explains (a lockfile, the config, an unmapped source file) selects every test.
 */
import { readFileSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, posix, resolve } from "node:path"

import { routeOf, type ServiceDelivery } from "@danwo/matrix"
import type { Exchange } from "@danwo/proxy"

import type { AppLogRecord } from "../record/index.ts"
import { relativeSlashed } from "../support/paths.ts"
import type { TestImpact, TestReport } from "./tasks.ts"

/** How a project maps its own source files to what its tests touch (`impact` in the config). */
export interface ImpactConfig {
  /**
   * Globs relative to the project root → what a change there affects: an app path (`/checkout`,
   * covering the pages below it; `/` covers every page), a provider host (`api.stripe.com`), a
   * call (`POST api.stripe.com/v1/checkout/sessions`) or a webhook (`webhook invoice.paid`).
   */
  readonly rules?: Readonly<Record<string, readonly string[]>>
  /** Globs of files no test depends on; default Markdown, plain text and `docs/`. */
  readonly ignore?: readonly string[]
}

/** One test's entry in the impact index. */
export interface ImpactEntry extends TestImpact {
  /** The test file, relative to the project root. */
  readonly file: string
}

/** `.danwo/impact.json`: sorted and timestamp-free, so committing it gives small, stable diffs. */
export interface ImpactIndex {
  readonly version: 1
  readonly tests: Readonly<Record<string, ImpactEntry>>
}

const INDEX_FILE = join(".danwo", "impact.json")
const DEFAULT_IGNORE = ["**/*.md", "**/*.mdx", "**/*.txt", "docs/**"]

const sortedUnique = (values: Iterable<string>) => [...new Set(values)].toSorted()

/** An app URL's path with ids folded to `:id`, or undefined when it is not the app's. */
function appRoute(url: string, baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined || !URL.canParse(url)) return undefined

  const parsed = new URL(url)

  if (parsed.origin !== new URL(baseUrl).origin) return undefined

  return routeOf({ method: "GET", host: "", path: parsed.pathname }).slice("GET ".length)
}

/** What one attempt touched: pages it navigated to, provider calls and webhooks behind it. */
export function impactOf(input: {
  readonly appLog: readonly AppLogRecord[]
  readonly exchanges: readonly Exchange[]
  readonly deliveries: readonly ServiceDelivery[]
  readonly baseUrl: string | undefined
}): TestImpact {
  const routes = input.appLog
    .filter((log) => log.source === "navigation")
    .map((log) => appRoute(log.text, input.baseUrl))
    .filter((route) => route !== undefined)
  const calls = [
    /* The page loading its own scripts and styles is no call the app makes; a change to it is. */
    ...input.exchanges
      .filter((exchange) => exchange.asset !== true)
      .map((exchange) => routeOf(exchange)),
    ...input.deliveries.map((delivery) => `webhook ${delivery.topic}`),
  ]

  return { routes: sortedUnique(routes), calls: sortedUnique(calls) }
}

function impactIndexPath(root: string): string {
  return join(root, INDEX_FILE)
}

/** The project's impact index, empty when there is none yet or it cannot be read. */
export async function readImpactIndex(root: string): Promise<ImpactIndex> {
  try {
    const parsed: unknown = JSON.parse(await readFile(impactIndexPath(root), "utf8"))

    return isImpactIndex(parsed) ? parsed : { version: 1, tests: {} }
  } catch {
    return { version: 1, tests: {} }
  }
}

function isImpactIndex(value: unknown): value is ImpactIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "tests" in value &&
    typeof value.tests === "object" &&
    value.tests !== null
  )
}

/**
 * Updates the index with the run's passing tests (their latest impact replaces the old one) and
 * writes it back sorted. Tests that did not pass keep their earlier entries.
 */
export async function updateImpactIndex(
  root: string,
  reports: readonly TestReport[],
  fileOf: (id: string) => string | undefined,
): Promise<void> {
  const index = await readImpactIndex(root)
  const tests: Record<string, ImpactEntry> = { ...index.tests }

  for (const report of reports) {
    const file = fileOf(report.id)

    if (report.impact !== undefined && file !== undefined) {
      tests[report.id] = { file: relativeSlashed(root, file), ...report.impact }
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(tests).toSorted(([a], [b]) => a.localeCompare(b)),
  )

  await mkdir(dirname(impactIndexPath(root)), { recursive: true })
  await writeFile(
    impactIndexPath(root),
    `${JSON.stringify({ version: 1, tests: sorted }, null, 2)}\n`,
  )
}

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g

const CANDIDATE_SUFFIXES = ["", ".ts", ".mts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"]

/** A relative specifier resolved to a file inside the project, or undefined. */
function resolveLocal(from: string, specifier: string, root: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined

  const base = resolve(dirname(from), specifier)

  /* `resolve` again, so `/index.ts` takes the platform's separator; a folder is no import. */
  return CANDIDATE_SUFFIXES.map((suffix) => resolve(base + suffix)).find(
    (path) =>
      path.startsWith(root) &&
      !path.includes("node_modules") &&
      statSync(path, { throwIfNoEntry: false })?.isFile() === true,
  )
}

function specifiersOf(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((match) => match[1] ?? match[2] ?? match[3] ?? "")
}

/**
 * The project files `file` imports, directly or through others, by relative specifier, read from
 * the sources. Package imports are left out: a change there is a dependency change, which the
 * selection treats as unmapped.
 */
export function localImportsOf(file: string, root: string): string[] {
  const seen = new Set<string>()
  const queue = [file]

  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    let source = ""

    try {
      source = readFileSync(current, "utf8")
    } catch {
      continue
    }

    for (const specifier of specifiersOf(source)) {
      const target = resolveLocal(current, specifier, root)

      if (target !== undefined && target !== file && !seen.has(target)) {
        seen.add(target)
        queue.push(target)
      }
    }
  }

  return [...seen].map((path) => relativeSlashed(root, path)).toSorted()
}

/** A test as the selection sees it. */
interface ImpactTest {
  readonly id: string
  /** Relative to the project root. */
  readonly file: string
  /** Project files it imports, relative to the project root. */
  readonly imports: readonly string[]
}

/** What a set of changed files selects, and why. */
export interface ImpactSelection {
  /** Every test is selected: some change could not be traced to particular tests. */
  readonly all: boolean
  /** Selected test ids → the reasons, one per change that selected it. */
  readonly reasons: ReadonlyMap<string, readonly string[]>
  /** Changes nothing explains, which select every test. */
  readonly unmapped: readonly string[]
  /** Changes no test depends on (the ignore list). */
  readonly ignored: readonly string[]
}

/** Whether target `target` of a rule covers app path `route`. */
function coversRoute(target: string, route: string): boolean {
  const prefix = target.endsWith("/") ? target : `${target}/`

  return route === target || route.startsWith(prefix)
}

/** Whether target `target` covers call `call` (`POST host/path` or `webhook topic`). */
function coversCall(target: string, call: string): boolean {
  const host = call.split(" ")[1]?.split("/")[0]

  return call === target || call.startsWith(`${target}/`) || host === target
}

/** Why `entry` is touched by rule targets, or undefined when it is not. */
function touchedBy(targets: readonly string[], entry: ImpactEntry): string | undefined {
  for (const target of targets) {
    const touched = target.startsWith("/")
      ? entry.routes.some((route) => coversRoute(target, route))
      : entry.calls.some((call) => coversCall(target, call))

    if (touched) return target
  }

  return undefined
}

interface ChangeContext {
  readonly tests: readonly ImpactTest[]
  readonly index: ImpactIndex
  readonly config: ImpactConfig
}

/** Tests whose own file is `change`, or that import it. */
function pickedBySource(change: string, tests: readonly ImpactTest[]): Map<string, string> {
  const picked = new Map<string, string>()

  for (const test of tests) {
    if (test.file === change) picked.set(test.id, `${change} is the test file`)
    else if (test.imports.includes(change)) picked.set(test.id, `the test imports ${change}`)
  }

  return picked
}

/** Why the rule for `glob` selects `test`, or undefined; a test with no data yet is selected. */
function ruleReason(change: string, glob: string, targets: readonly string[], entry?: ImpactEntry) {
  const target = entry === undefined ? "no impact data yet" : touchedBy(targets, entry)

  return target === undefined ? undefined : `${change} (${glob}) → ${target}`
}

/** The tests one changed file selects, with why; undefined when nothing explains the change. */
function selectFor(change: string, context: ChangeContext): Map<string, string> | undefined {
  const picked = pickedBySource(change, context.tests)
  const rules = Object.entries(context.config.rules ?? {}).filter(([glob]) =>
    posix.matchesGlob(change, glob),
  )

  for (const [glob, targets] of rules) {
    for (const test of context.tests) {
      const reason = ruleReason(change, glob, targets, context.index.tests[test.id])

      if (reason !== undefined && !picked.has(test.id)) picked.set(test.id, reason)
    }
  }

  return picked.size > 0 || rules.length > 0 ? picked : undefined
}

/** Selects the tests `changes` (paths relative to the project root) can affect. */
export function selectImpacted(
  changes: readonly string[],
  context: ChangeContext,
): ImpactSelection {
  const ignore = context.config.ignore ?? DEFAULT_IGNORE
  const reasons = new Map<string, string[]>()
  const unmapped: string[] = []
  const ignored: string[] = []

  for (const change of changes) {
    if (ignore.some((glob) => posix.matchesGlob(change, glob))) {
      ignored.push(change)
      continue
    }

    const picked = selectFor(change, context)

    if (picked === undefined) unmapped.push(change)

    for (const [id, reason] of picked ?? []) reasons.set(id, [...(reasons.get(id) ?? []), reason])
  }

  return { all: unmapped.length > 0, reasons, unmapped, ignored }
}

/** Lines explaining a selection, for `danwo impact` and `danwo test --changed`. */
export function selectionLines(selection: ImpactSelection, total: number): string[] {
  const lines = [
    ...selection.ignored.map((file) => `ignored: ${file} (no test depends on it)`),
    ...selection.unmapped.map((file) => `unmapped: ${file} (selects every test)`),
  ]

  if (selection.all) return [...lines, `selected: all ${total} tests`]

  const picked = [...selection.reasons].toSorted(([a], [b]) => a.localeCompare(b))

  return [
    ...lines,
    `selected: ${picked.length} of ${total} tests`,
    ...picked.flatMap(([id, why]) => [`  ${id}`, ...why.map((reason) => `      ${reason}`)]),
  ]
}
