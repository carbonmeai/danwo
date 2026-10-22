/**
 * Ending a recording: each step paired with what it caused behind the app, an invariant drafted
 * from those effects, and the test written to a new file the person can run and then fault.
 */
import { existsSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import type { DanwoConfig, WorkerEnvironment } from "@danwo/runner/runner"
import { z } from "zod"

import { draftInvariant, type InvariantPlan } from "./invariants.ts"
import type { SecretUse } from "./step-writer.ts"
import { bodyLines, fixturesUsed, type Mark, type ResolvedStep, type Step } from "./steps.ts"
import { renderTest, writeNewTest } from "./writer.ts"

/** Where the test goes and what it is called. */
export interface FinishOptions {
  /** The new file, relative to the project folder; default `<testDir>/recorded.danwo.ts`. */
  readonly out?: string | undefined
  readonly name?: string | undefined
}

/** What a finished recording wrote. */
export interface RecordedTest {
  readonly path: string
  /** The path as the person runs it from the project folder. */
  readonly shown: string
  readonly source: string
  /** Secrets the test fills that the config does not define yet. */
  readonly missingSecrets: readonly SecretUse[]
  /** The command that faults the recorded journey next. */
  readonly next: string
}

interface Activity {
  readonly calls: readonly { readonly signature: string }[]
  readonly deliveries: readonly { readonly signature: string }[]
}

export interface FinishInput {
  readonly options: FinishOptions
  readonly steps: readonly Step[]
  readonly activity: Activity | undefined
  readonly env: WorkerEnvironment | undefined
  readonly config: DanwoConfig
  readonly root: string
  readonly secrets: readonly SecretUse[]
  /** The app's own host, as call signatures name it: calls to it are page loads, not effects. */
  readonly appHost: string
}

const BODY_FIXTURES = ["app", "screen", "expect", "agent", "secret", "mail"]

function markOf(step: Step): Mark | undefined {
  return step.kind === "action" ? step.mark : undefined
}

/** The marks where each step's effects end: the next action's start, or the end of the recording. */
function endsOf(steps: readonly Step[], end: Mark): Mark[] {
  let next = end

  return steps
    .toReversed()
    .map((step) => {
      const ends = next

      next = markOf(step) ?? next

      return ends
    })
    .toReversed()
}

/** Whether a call went to the app itself (the browser loading its pages) rather than a provider. */
function toApp(signature: string, appHost: string): boolean {
  const target = signature.split(" ")[1] ?? ""

  return target === appHost || target.startsWith(`${appHost}/`)
}

/** Each step with the provider calls and deliveries made while it was the latest action. */
export function resolveSteps(
  steps: readonly Step[],
  activity: Activity | undefined,
  appHost: string,
): ResolvedStep[] {
  const calls = activity?.calls ?? []
  const deliveries = activity?.deliveries ?? []
  const ends = endsOf(steps, { calls: calls.length, deliveries: deliveries.length })

  return steps.map((step, at) => {
    const from = markOf(step)
    const to = ends[at]

    if (from === undefined || to === undefined) return { step, effects: [] }

    const seen = [
      ...calls.slice(from.calls, to.calls),
      ...deliveries.slice(from.deliveries, to.deliveries),
    ]
      .map((event) => event.signature)
      .filter((signature) => !toApp(signature, appHost))

    return { step, effects: [...new Set(seen)] }
  })
}

const PaidSessions = z.object({ data: z.array(z.unknown()) })

/** Asks the environment's `stripe` fixture, if it has one that answers Stripe's API. */
async function askStripe(
  env: WorkerEnvironment | undefined,
  request: Request,
): Promise<Response | undefined> {
  const stripe: unknown = env?.fixtures?.["stripe"]

  if (typeof stripe !== "object" || stripe === null || !("fetch" in stripe)) return undefined
  if (typeof stripe.fetch !== "function") return undefined

  const answer: unknown = await Reflect.apply(stripe.fetch, stripe, [request])

  return answer instanceof Response ? answer : undefined
}

/** Checkout sessions Stripe has been paid for, read from the emulator. */
async function paidCheckouts(env: WorkerEnvironment | undefined): Promise<number | undefined> {
  const res = await askStripe(
    env,
    new Request("https://api.stripe.com/v1/checkout/sessions?payment_status=paid&limit=100", {
      headers: { authorization: "Bearer sk_test_danwo_recorder" },
    }),
  )

  return res === undefined ? undefined : PaidSessions.parse(await res.json()).data.length
}

/** A free path for the test: `out` as given, or the next unused `recorded*.danwo.ts`. */
function outPath(input: FinishInput): string {
  if (input.options.out !== undefined) {
    if (!input.options.out.endsWith(".danwo.ts"))
      throw new Error("a danwo test file ends in .danwo.ts")

    return resolve(input.root, input.options.out)
  }

  const dir = join(input.root, input.config.testDir ?? ".")
  let n = 1

  while (existsSync(join(dir, recordedName(n)))) n++

  return join(dir, recordedName(n))
}

function recordedName(n: number): string {
  return n === 1 ? "recorded.danwo.ts" : `recorded-${String(n)}.danwo.ts`
}

function secretHints(missing: readonly SecretUse[]): string[] {
  if (missing.length === 0) return []

  const entries = missing.map(
    (use) =>
      `${use.name}: { value: process.env.${use.name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}, purpose: "${use.purpose}" }`,
  )

  return [
    "",
    "Its secrets are filled by name; add them to danwo.config.ts:",
    `  secrets: { ${entries.join(", ")} }`,
  ]
}

function source(
  input: FinishInput,
  resolved: readonly ResolvedStep[],
  plan: InvariantPlan,
  missing: readonly SecretUse[],
): string {
  const body = bodyLines(resolved)

  return renderTest({
    header: [
      "Recorded with `danwo record`. Each `// →` line is what the step before it caused behind the app.",
      ...plan.header,
      ...secretHints(missing),
    ],
    imports: plan.imports,
    preamble: plan.preamble,
    name: input.options.name ?? "recorded journey",
    fixtures: fixturesUsed(body, BODY_FIXTURES),
    body,
    invariant: plan.invariant,
  })
}

/** What `danwo record` prints when the test is written. */
export function recordedReport(recorded: RecordedTest): string {
  return [
    `wrote ${recorded.shown}`,
    ...secretHints(recorded.missingSecrets).filter((line) => line !== ""),
    `next: ${recorded.next}`,
  ].join("\n")
}

/** Writes the recording's test and says how to run it under the fault matrix. */
export async function finishRecording(input: FinishInput): Promise<RecordedTest> {
  const resolved = resolveSteps(input.steps, input.activity, input.appHost)
  const plan = draftInvariant({
    steps: resolved,
    fixtures: Object.keys(input.env?.fixtures ?? {}),
    paidCheckouts: await paidCheckouts(input.env).catch(() => undefined),
    calls: [...(input.activity?.calls ?? []), ...(input.activity?.deliveries ?? [])]
      .map((event) => event.signature)
      .filter((signature) => !toApp(signature, input.appHost)),
  })
  const missing = input.secrets.filter((use) => input.config.secrets?.[use.name] === undefined)
  const path = outPath(input)
  const text = source(input, resolved, plan, missing)

  await writeNewTest(path, text)

  const shown = relative(input.root, path).split("\\").join("/")

  return { path, shown, source: text, missingSecrets: missing, next: `danwo matrix ${shown}` }
}
