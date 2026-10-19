/**
 * What the dashboard may ask danwo to run, and the exact arguments each request becomes. Nothing
 * from the browser reaches the command line as text it chose: a test is named by its id, which must
 * be one of the project's tests, and a fault filter is matched literally.
 */

/** A run the dashboard can start. */
export type RunRequest =
  | { readonly action: "rerun-failed"; readonly runId: string }
  | { readonly action: "test"; readonly testId: string }
  /** Several of the project's tests by id, or every test when none is named. */
  | { readonly action: "tests"; readonly testIds: readonly string[] }
  | { readonly action: "matrix"; readonly testId: string; readonly faults?: string }

/** One of the project's tests, as `danwo test --list` prints it. */
export interface KnownTest {
  readonly id: string
  /** Relative to the project root. */
  readonly file: string
  readonly invariant?: boolean
}

/** The arguments for the CLI and a short name for the run, or why it cannot start. */
export type Launch =
  | { readonly args: readonly string[]; readonly label: string }
  | { readonly error: string }

/** The longest fault filter accepted. */
const MAX_FILTER = 120

/** `text` matched literally in a regular expression. */
export function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

/** A regular expression matching exactly these test ids. */
function exactly(ids: readonly string[]): string {
  return `^(?:${ids.map(literal).join("|")})$`
}

function findTest(known: readonly KnownTest[], id: string): KnownTest | undefined {
  return known.find((test) => test.id === id)
}

/**
 * A run started from the dashboard keeps its recording whatever happens, so the tests it ran
 * always have one to watch.
 */
const RECORD = ["--record", "always"] as const

/** The tests to run again, each one the project still has. */
function rerunFailed(known: readonly KnownTest[], failed: readonly string[]): Launch {
  const tests = failed.flatMap((id) => findTest(known, id) ?? [])

  if (tests.length === 0) return { error: "none of the run's failed tests is in the project now" }

  const files = [...new Set(tests.map((test) => test.file))]
  const count = tests.length

  return {
    args: ["test", ...files, "--grep", exactly(tests.map((test) => test.id)), ...RECORD],
    label: `rerun ${count} failed ${count === 1 ? "test" : "tests"}`,
  }
}

/** The picked tests, or the whole suite when none is picked. */
function someTests(known: readonly KnownTest[], ids: readonly string[]): Launch {
  if (ids.length === 0) return { args: ["test", ...RECORD], label: "run every test" }

  const tests = ids.flatMap((id) => findTest(known, id) ?? [])

  if (tests.length === 0) return { error: "none of the picked tests is in the project now" }

  const files = [...new Set(tests.map((test) => test.file))]
  const count = tests.length

  return {
    args: ["test", ...files, "--grep", exactly(tests.map((test) => test.id)), ...RECORD],
    label: `run ${count} ${count === 1 ? "test" : "tests"}`,
  }
}

function oneTest(known: readonly KnownTest[], id: string): Launch {
  const test = findTest(known, id)

  if (test === undefined) return { error: `no test named ${id} in the project` }

  return { args: ["test", test.file, "--grep", exactly([id]), ...RECORD], label: `rerun ${id}` }
}

/** The `--faults` arguments for a filter matched literally; none for an empty one. */
function faultArgs(filter: string): string[] {
  return filter === "" ? [] : ["--faults", literal(filter)]
}

function matrix(known: readonly KnownTest[], id: string, faults = ""): Launch {
  const test = findTest(known, id)
  const filter = faults.trim()

  if (test === undefined) return { error: `no test named ${id} in the project` }
  if (filter.length > MAX_FILTER) return { error: `the fault filter is longer than ${MAX_FILTER}` }

  return {
    args: ["matrix", test.file, "--grep", exactly([id]), ...faultArgs(filter)],
    label: filter === "" ? `matrix of ${id}` : `matrix of ${id}, faults with “${filter}”`,
  }
}

/**
 * The launch for `request`: `known` is the project's tests, `failed` the failed test ids of the run
 * a rerun repeats.
 */
export function launchOf(
  request: RunRequest,
  known: readonly KnownTest[],
  failed: readonly string[] = [],
): Launch {
  if (request.action === "rerun-failed") return rerunFailed(known, failed)
  if (request.action === "test") return oneTest(known, request.testId)
  if (request.action === "tests") return someTests(known, request.testIds)

  return matrix(known, request.testId, request.faults)
}

/** A request's text field, or undefined when it is missing or not text. */
type Field = (key: string) => string | undefined

/** How each action's request is read from what the browser sent. */
const READERS: Readonly<Record<string, (field: Field, value: unknown) => RunRequest | undefined>> =
  {
    "rerun-failed": (field) => {
      const runId = field("runId")

      return runId === undefined ? undefined : { action: "rerun-failed", runId }
    },
    test: (field) => {
      const testId = field("testId")

      return testId === undefined ? undefined : { action: "test", testId }
    },
    tests: (_field, value) => {
      const ids: unknown =
        typeof value === "object" && value !== null ? Reflect.get(value, "testIds") : undefined

      return Array.isArray(ids) && ids.every((id) => typeof id === "string")
        ? { action: "tests", testIds: ids }
        : undefined
    },
    matrix: (field) => {
      const testId = field("testId")
      const faults = field("faults")

      return testId === undefined
        ? undefined
        : { action: "matrix", testId, ...(faults !== undefined && { faults }) }
    },
  }

/** A request as it arrives from the browser, checked field by field. */
export function requestOf(value: unknown): RunRequest {
  const field: Field = (key) => {
    const got: unknown =
      typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined

    return typeof got === "string" ? got : undefined
  }

  const request = READERS[field("action") ?? ""]?.(field, value)

  if (request === undefined) throw new Error("expected a run request")

  return request
}
