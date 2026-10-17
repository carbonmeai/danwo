/**
 * How `danwo-playwright matrix` and the fixture talk across the Playwright process they share
 * nothing else with: the matrix sets two environment variables, the fixture appends one JSON line
 * per test to the outcome file.
 */
import type { ServiceDelivery } from "@danwo/core"
import type { Exchange } from "@danwo/proxy"
import { z } from "@danwo/runner/runner"

/** Where the fixture appends each test's outcome; set by the matrix for every trial. */
export const OUTCOME_FILE = "DANWO_PLAYWRIGHT_OUTCOME"

/** The fault a trial arms, by its matrix label; absent for the clean trial. */
export const TRIAL_FAULT = "DANWO_PLAYWRIGHT_FAULT"

const ExchangeLine = z.object({
  disposition: z.enum(["routed", "passthrough", "blocked"]),
  method: z.string(),
  host: z.string(),
  path: z.string(),
  startedAt: z.string(),
  id: z.string(),
  fault: z.string().nullable(),
  status: z.number().nullable(),
  durationMs: z.number().nullable(),
  aborted: z.boolean(),
})

const DeliveryLine = z.object({
  messageId: z.number(),
  topic: z.string(),
  endpointId: z.string(),
  attempt: z.number(),
  at: z.string(),
  status: z.number().nullable(),
  error: z.string().nullable(),
  durationMs: z.number(),
  delivered: z.boolean(),
  fault: z.string().nullable(),
  service: z.string().exactOptional(),
})

/** One test's outcome as the fixture saw it. */
const OutcomeLine = z.object({
  title: z.string(),
  file: z.string(),
  /** Where the body ended up: Playwright's status for the test before the invariant ran. */
  body: z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]),
  bodyError: z.string().nullable(),
  /** Null when the test declares no invariant. */
  invariant: z.object({ error: z.string().nullable() }).nullable(),
  /** The test file line the failure went through, when Playwright knows it. */
  line: z.number().nullable(),
  exchanges: z.array(ExchangeLine),
  deliveries: z.array(DeliveryLine),
  /** The flight record attached to the test's report, when one was. */
  record: z.string().nullable(),
})

export type TestOutcome = z.infer<typeof OutcomeLine>

/** An exchange as the outcome file carries it: everything but its bodies. */
export function exchangeLine(exchange: Exchange): z.infer<typeof ExchangeLine> {
  const { request: _request, response: _response, ...call } = exchange

  return call
}

/** A delivery as the outcome file carries it. */
export function deliveryLine(delivery: ServiceDelivery): z.infer<typeof DeliveryLine> {
  return delivery
}

/** Every outcome line in `text`, in the order the tests finished. */
export function readOutcomes(text: string): TestOutcome[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => OutcomeLine.parse(JSON.parse(line)))
}
