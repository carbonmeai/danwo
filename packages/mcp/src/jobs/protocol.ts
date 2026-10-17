/**
 * What the MCP server asks of a job process and what comes back. Every job that loads the
 * project's config or test files runs in a fresh child process: Node caches imported modules, so a
 * long-lived server would otherwise keep serving the config and tests as they were first loaded.
 * Messages are plain JSON over the child's IPC channel.
 */
import type { MatrixRunReport, RecordMode, TestRunReport } from "@danwo/runner/runner"

/** How to find an element: one of the screen's `getBy*` queries. */
export interface LocatorQuery {
  readonly by: "role" | "text" | "label" | "placeholder" | "testId" | "altText" | "title"
  readonly value: string
  /** For `role`: the accessible name. */
  readonly name?: string | undefined
  readonly exact?: boolean | undefined
}

export type Job =
  | { readonly kind: "config" }
  | { readonly kind: "list" }
  | {
      readonly kind: "test"
      readonly patterns: readonly string[]
      readonly grep: string | undefined
      readonly record: RecordMode
    }
  | {
      readonly kind: "matrix"
      readonly file: string
      readonly grep: string | undefined
      readonly faults: string | undefined
    }
  | {
      readonly kind: "inspect"
      readonly path: string
      readonly locator: LocatorQuery | undefined
    }

/** Where a job runs: the project folder and its config file, as the CLI would take them. */
export interface JobPlace {
  readonly cwd: string
  readonly config: string | undefined
}

/** A test as `list_tests` reports it. */
export interface ListedTest {
  readonly id: string
  /** Relative to the project root. */
  readonly file: string
  readonly mode: string
  readonly invariant: boolean
}

/** One element a locator matched. */
export interface LocatorMatch {
  readonly visible: boolean
  /** The element's own accessibility snapshot, cut short. */
  readonly snapshot: string
}

export interface PageInspection {
  readonly url: string
  readonly title: string
  /** The page's accessibility tree, redacted and capped. */
  readonly tree: string
  readonly locator?: {
    readonly code: string
    readonly count: number
    readonly matches: LocatorMatch[]
  }
}

/** The parts of a project's config a coding agent needs to know. */
export interface ConfigSummary {
  readonly root: string
  /** The config file, relative to the root; undefined without one. */
  readonly file: string | undefined
  /** Where tests live, relative to the root. */
  readonly testDir: string
  readonly testMatch: readonly string[]
  readonly baseUrl: string | undefined
  readonly environment: boolean
  readonly workers: number
  readonly retries: number
  /** The agent's model id, when it is a gateway id; "set" for a model object. */
  readonly model: string | undefined
  readonly secrets: readonly string[]
  readonly files: readonly string[]
  readonly cache: string | undefined
}

export interface JobResults {
  readonly config: ConfigSummary
  readonly list: { readonly root: string; readonly tests: readonly ListedTest[] }
  readonly test: { readonly code: number; readonly report: TestRunReport | undefined }
  readonly matrix: { readonly code: number; readonly report: MatrixRunReport | undefined }
  readonly inspect: PageInspection
}

/** What a job process sends: progress lines, then exactly one result or failure. */
export type JobMessage =
  | { readonly type: "line"; readonly text: string }
  | { readonly type: "result"; readonly result: unknown }
  | { readonly type: "failed"; readonly message: string }

/** What the server sends a job process: the job and where to run it. */
export interface JobRequest {
  readonly job: Job
  readonly place: JobPlace
}

/** Narrows an IPC message to a job message. */
export function isJobMessage(value: unknown): value is JobMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false

  return value.type === "line" || value.type === "result" || value.type === "failed"
}

/** Narrows an IPC message to a job request. */
export function isJobRequest(value: unknown): value is JobRequest {
  return typeof value === "object" && value !== null && "job" in value && "place" in value
}
