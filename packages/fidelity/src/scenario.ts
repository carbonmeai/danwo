/**
 * A fidelity scenario: a short, fixed sequence of API calls a real integration makes, written once
 * and run against either the emulator or the provider's own sandbox. Each call becomes a step whose
 * answer is kept only as its status and shape; what a scenario learns across calls (an idempotent
 * replay returning the same object, newest-first ordering) becomes a fact, never an id.
 */
import { redactCredentials } from "@danwo/runner"

import type { DifferenceKind } from "./compare.ts"
import { asJsonObject, type Json, type Shape, type ShapeOptions, shapeOf } from "./shape.ts"

/** Where a scenario's requests go: the emulator, or the provider's sandbox. */
export interface Target {
  readonly kind: "emulator" | "live"
  /** Sends a request addressed to the provider's real hostname. */
  readonly send: (request: Request) => Promise<Response>
  /** The credentials to call with: a stand-in key for the emulator, the sandbox key for live. */
  readonly credentials: Readonly<Record<string, string>>
}

/** A target that holds resources until closed (an emulator instance). */
export interface OpenTarget extends Target {
  close(): Promise<void>
}

/** What the provider's published schema says an answer looks like, for goldens made without keys. */
export interface StepDoc {
  /** The operation, as `method path` with the schema's own path template. */
  readonly operation?: string
  /**
   * The answer's JSON schema as the provider's documentation gives it, for answers its published
   * description leaves out (error bodies, most often).
   */
  readonly schema?: Readonly<Record<string, unknown>>
  readonly status: number
  /** Values the documentation fixes for this call, such as `status: "requires_payment_method"`. */
  readonly literals?: Readonly<Record<string, string | number | boolean>>
}

export interface StepOptions extends ShapeOptions {
  readonly doc?: StepDoc
  /**
   * The answer is a stream of server-sent events, each a JSON object with a `type`: its body is
   * read as one list of events per type, in the order the types first appear.
   */
  readonly events?: boolean
}

/** A value a scenario derived from answers. Facts never hold an id, a time or a secret. */
export interface Fact {
  readonly name: string
  readonly value: string | number | boolean | null
  /** How a different value is reported; `ordering` for list order, `status-mismatch` otherwise. */
  readonly kind?: DifferenceKind
}

/** One call's answer, as structure. */
export interface Observation {
  readonly step: string
  readonly status: number
  readonly shape: Shape
  readonly doc?: StepDoc
  readonly options?: ShapeOptions
}

/** What one scenario run produced. */
export interface ScenarioRun {
  readonly scenario: string
  readonly steps: readonly Observation[]
  readonly facts: readonly Fact[]
  /** Set when the scenario threw instead of finishing. */
  readonly error?: string
  /** Set when the scenario stopped because the target cannot run it, with why. */
  readonly skipped?: string
}

/** An answer as a scenario sees it. */
export interface Answer {
  readonly status: number
  readonly body: Json
  readonly headers: Headers
}

export interface ScenarioContext {
  readonly target: Target
  /** A short suffix unique to this run, for names and emails. */
  readonly unique: string
  /** Sends one request and records its answer as a step. */
  step(name: string, request: Request, options?: StepOptions): Promise<Answer>
  /** Records a fact derived from answers. */
  fact(name: string, value: Fact["value"], kind?: DifferenceKind): void
  /** Registers sandbox cleanup to run after the scenario, finished or not. */
  cleanup(undo: () => Promise<unknown>): void
  /**
   * Stops the scenario because the target cannot run it (a key without the access it needs, say).
   * A skipped scenario is reported with `reason` and neither compared nor kept in a golden.
   */
  skip(reason: string): never
}

export interface Scenario {
  readonly name: string
  /** Facts the provider's documentation states, for goldens made without keys. */
  readonly documentedFacts?: readonly Fact[]
  run(context: ScenarioContext): Promise<void>
}

/** Parses JSON text, or keeps the text when it is not JSON. */
function parseJson(text: string): Json {
  try {
    const parsed: Json = JSON.parse(text)

    return parsed
  } catch {
    return text
  }
}

/** An event's `type`, or `data` for a payload that names none. */
function eventType(event: Json): string {
  const type = asJsonObject(event)?.["type"]

  return typeof type === "string" ? type : "data"
}

/** A server-sent event stream's `data:` payloads, as lists of events keyed by their `type`. */
function eventsByType(text: string): Json {
  const byType: Record<string, Json[]> = {}

  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue

    const event = parseJson(line.slice(5).trim())
    const type = eventType(event)

    byType[type] = [...(byType[type] ?? []), event]
  }

  return byType
}

/** Parses an answer's body after taking credentials out of it, so nothing secret is ever shaped. */
async function readBody(response: Response, events: boolean): Promise<Json> {
  const text = redactCredentials(await response.text())

  if (text.trim() === "") return null

  return events ? eventsByType(text) : parseJson(text)
}

/** Thrown by `skip` to end a scenario early. */
class ScenarioSkipped extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}

function errorText(error: unknown): string {
  return redactCredentials(error instanceof Error ? error.message : String(error))
}

/** Runs one scenario against one target, always running its cleanup. */
export async function runScenario(scenario: Scenario, target: Target): Promise<ScenarioRun> {
  const steps: Observation[] = []
  const facts: Fact[] = []
  const undo: Array<() => Promise<unknown>> = []
  const context: ScenarioContext = {
    target,
    unique: Date.now().toString(36),
    async step(name, request, options = {}) {
      const response = await target.send(request)
      const { doc, events = false, ...shapeOptions } = options
      const body = await readBody(response, events && response.ok)

      steps.push({
        step: name,
        status: response.status,
        shape: shapeOf(body, shapeOptions),
        ...(doc && { doc }),
        options: shapeOptions,
      })

      return { status: response.status, body, headers: response.headers }
    },
    fact(name, value, kind) {
      facts.push({ name, value, ...(kind && { kind }) })
    },
    cleanup(step) {
      undo.push(step)
    },
    skip(reason) {
      throw new ScenarioSkipped(reason)
    },
  }

  try {
    await scenario.run(context)

    return { scenario: scenario.name, steps, facts }
  } catch (error) {
    if (error instanceof ScenarioSkipped)
      return { scenario: scenario.name, steps, facts, skipped: error.reason }

    return { scenario: scenario.name, steps, facts, error: errorText(error) }
  } finally {
    for (const step of undo.toReversed()) await step().catch(() => undefined)
  }
}
