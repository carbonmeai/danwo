/**
 * What a failed Playwright test leaves behind for danwo: the calls the app made through the proxy,
 * the webhooks delivered, and the emulators' state, redacted the way danwo's own flight records
 * are, attached to the test's report beside Playwright's trace.
 */
import { writeFile } from "node:fs/promises"

import { deliveriesOf } from "@danwo/matrix"
import {
  createRedactor,
  environmentState,
  redactExchange,
  type WorkerEnvironment,
} from "@danwo/runner/runner"
import type { TestInfo } from "@playwright/test"

import type { WorkerSetup } from "./environment.ts"

/** Where a test's evidence starts: counts of what the environment had seen before it. */
export interface EvidenceMark {
  readonly exchanges: number
  readonly deliveries: number
}

export function markOf(env: WorkerEnvironment): EvidenceMark {
  return {
    exchanges: env.proxy?.exchanges().length ?? 0,
    deliveries: deliveriesOf(env.webhooks).length,
  }
}

/** The exchanges since `mark`, unredacted (bodies included) for the test's own use. */
export function exchangesSince(env: WorkerEnvironment, mark: EvidenceMark) {
  return env.proxy?.exchanges().slice(mark.exchanges) ?? []
}

/** The webhook delivery attempts since `mark`. */
export function deliveriesSince(env: WorkerEnvironment, mark: EvidenceMark) {
  return deliveriesOf(env.webhooks).slice(mark.deliveries)
}

export interface Verdict {
  readonly bodyError: string | null
  readonly invariantError: string | null
  readonly fault: string | null
}

/** Writes the test's flight record next to its output and attaches it; returns its path. */
export async function attachRecord(
  setup: WorkerSetup,
  mark: EvidenceMark,
  verdict: Verdict,
  testInfo: TestInfo,
): Promise<string> {
  const redactor = createRedactor(setup.vault.redact)
  const record = {
    test: testInfo.titlePath.join(" › "),
    status: testInfo.status ?? "failed",
    fault: verdict.fault,
    bodyError: verdict.bodyError === null ? null : redactor.text(verdict.bodyError),
    invariantError: verdict.invariantError === null ? null : redactor.text(verdict.invariantError),
    exchanges: exchangesSince(setup.env, mark).map((exchange) =>
      redactExchange(exchange, redactor),
    ),
    deliveries: deliveriesSince(setup.env, mark),
    state: environmentState(setup.env, redactor),
  }
  const path = testInfo.outputPath("danwo-flight-record.json")

  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`)
  await testInfo.attach("danwo flight record", { path, contentType: "application/json" })

  return path
}
