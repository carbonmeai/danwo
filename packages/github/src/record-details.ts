/**
 * What a failure's flight record says beyond the error: the step that failed, the last calls the
 * app made to its providers, and the faults injected into them. Read from the record's
 * `record.json`, which is already redacted; a record that is missing or unreadable says nothing.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { FlightRecord } from "@danwo/runner/runner"

/** The parts of a failure's record a pull request comment shows. */
export interface FailureDetails {
  /** The step that failed, as written, with its test file line when known. */
  readonly step: string | undefined
  /** The last provider calls, oldest first, e.g. `POST api.stripe.com/v1/refunds → 500`. */
  readonly calls: readonly string[]
  /** The faults injected during the run, once each. */
  readonly faults: readonly string[]
}

type RecordParts = Pick<FlightRecord, "steps" | "exchanges">

/** Calls shown per failure. */
const LAST_CALLS = 5

function isRecordParts(value: unknown): value is RecordParts {
  return (
    typeof value === "object" &&
    value !== null &&
    "steps" in value &&
    Array.isArray(value.steps) &&
    "exchanges" in value &&
    Array.isArray(value.exchanges)
  )
}

type Exchange = RecordParts["exchanges"][number]

/** `METHOD host/path`, without the query string. */
const target = (exchange: Exchange) =>
  `${exchange.method} ${exchange.host}${exchange.path.split("?")[0] ?? ""}`

function answer(exchange: Exchange): string {
  if (exchange.aborted) return "aborted"

  return exchange.status === null ? "no response" : String(exchange.status)
}

function callLine(exchange: Exchange): string {
  const fault = exchange.fault === null ? "" : ` · fault: ${exchange.fault}`

  return `${target(exchange)} → ${answer(exchange)}${fault}`
}

function failingStep(steps: RecordParts["steps"]): string | undefined {
  const step = steps.findLast((s) => s.error !== undefined) ?? steps.at(-1)

  if (step === undefined) return undefined

  return step.source ? `${step.label} (${step.source.file}:${step.source.line})` : step.label
}

/** The details in the record folder `record` (relative to `cwd`), or none when it cannot be read. */
export async function failureDetails(
  cwd: string,
  record: string | undefined,
): Promise<FailureDetails | undefined> {
  if (record === undefined) return undefined

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(join(cwd, record, "record.json"), "utf8"))
  } catch {
    return undefined
  }

  if (!isRecordParts(parsed)) return undefined

  const outbound = parsed.exchanges.filter((exchange) => exchange.origin !== "page")

  return {
    step: failingStep(parsed.steps),
    calls: outbound.slice(-LAST_CALLS).map(callLine),
    faults: [
      ...new Set(outbound.flatMap((e) => (e.fault === null ? [] : [`${e.fault} on ${target(e)}`]))),
    ],
  }
}
