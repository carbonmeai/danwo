/**
 * Golden files: the last known structure of each provider's real answers, one file per provider
 * under `fidelity/`. They hold statuses, shapes and facts only, so they are safe to commit; an
 * emulator change that breaks fidelity then fails without any keys.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { compareShapes, type Difference, type DifferenceKind } from "./compare.ts"
import type { Fact, ScenarioRun } from "./scenario.ts"
import type { Shape } from "./shape.ts"

export interface GoldenStep {
  readonly step: string
  readonly status: number
  readonly shape: Shape
}

export interface GoldenScenario {
  readonly steps: readonly GoldenStep[]
  readonly facts: readonly Fact[]
}

/** Where a golden came from: a sandbox run, or the provider's published API description. */
export type GoldenSource = "live" | "openapi"

export interface Golden {
  readonly provider: string
  readonly source: GoldenSource
  /** The day the golden was made, so a stale one is easy to spot. */
  readonly recorded: string
  readonly scenarios: Readonly<Record<string, GoldenScenario>>
}

/** A difference fidelity accepts on purpose, with why. */
export interface KnownDifference {
  readonly provider: string
  readonly scenario?: string
  readonly step?: string
  /** A dot path, or a prefix ending in `.` for everything under it. */
  readonly path?: string
  readonly kind: DifferenceKind
  readonly reason: string
}

/** A difference with the scenario step it was found in. */
export interface StepDifference extends Difference {
  readonly scenario: string
  readonly step: string
}

/** The folder goldens and known differences live in. */
function fidelityDir(root: string): string {
  return join(root, "fidelity")
}

function goldenPath(root: string, provider: string): string {
  return join(fidelityDir(root), `${provider}.json`)
}

/**
 * A golden as stored: every distinct shape once under `shapes`, with steps naming theirs by key.
 * The same object comes back from many calls (create, retrieve, update), so this keeps files small.
 */
interface StoredGolden {
  readonly provider: string
  readonly source: GoldenSource
  readonly recorded: string
  readonly shapes: Readonly<Record<string, Shape>>
  readonly scenarios: Readonly<
    Record<
      string,
      {
        readonly steps: readonly { step: string; status: number; shape: string }[]
        readonly facts: readonly Fact[]
      }
    >
  >
}

function shapeKey(shape: Shape): string {
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 12)
}

function toStored(golden: Golden): StoredGolden {
  const shapes: Record<string, Shape> = {}
  const scenarios = Object.fromEntries(
    Object.entries(golden.scenarios).map(([name, scenario]) => {
      const steps = scenario.steps.map(({ step, status, shape }) => {
        const key = shapeKey(shape)

        shapes[key] = shape

        return { step, status, shape: key }
      })

      return [name, { steps, facts: scenario.facts }]
    }),
  )

  return {
    provider: golden.provider,
    source: golden.source,
    recorded: golden.recorded,
    shapes,
    scenarios,
  }
}

function fromStored(stored: StoredGolden): Golden {
  const scenarios = Object.fromEntries(
    Object.entries(stored.scenarios).map(([name, scenario]): [string, GoldenScenario] => [
      name,
      {
        facts: scenario.facts,
        steps: scenario.steps.map((step) => ({
          ...step,
          shape: stored.shapes[step.shape] ?? { t: "any" },
        })),
      },
    ]),
  )

  return { provider: stored.provider, source: stored.source, recorded: stored.recorded, scenarios }
}

/** A provider's golden, or undefined when none was made yet. */
export async function readGolden(root: string, provider: string): Promise<Golden | undefined> {
  try {
    const stored: StoredGolden = JSON.parse(await readFile(goldenPath(root, provider), "utf8"))

    return fromStored(stored)
  } catch {
    return undefined
  }
}

/** Writes a provider's golden: scenarios readable, each shape on one line, so updates diff cleanly. */
export async function writeGolden(root: string, golden: Golden): Promise<void> {
  const path = goldenPath(root, golden.provider)
  const stored = toStored(golden)
  const shapes = Object.entries(stored.shapes)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, shape]) => `    ${JSON.stringify(key)}: ${JSON.stringify(shape)}`)
  const head = JSON.stringify(
    {
      provider: stored.provider,
      source: stored.source,
      recorded: stored.recorded,
      scenarios: stored.scenarios,
    },
    null,
    2,
  )

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${head.slice(0, -2)},\n  "shapes": {\n${shapes.join(",\n")}\n  }\n}\n`)
}

/** The accepted differences in `fidelity/known-differences.json`. */
export async function readKnownDifferences(root: string): Promise<readonly KnownDifference[]> {
  try {
    const known: readonly KnownDifference[] = JSON.parse(
      await readFile(join(fidelityDir(root), "known-differences.json"), "utf8"),
    )

    return known
  } catch {
    return []
  }
}

/** A run kept as a golden scenario: its steps' statuses and shapes, and its facts. */
export function goldenOf(run: ScenarioRun): GoldenScenario {
  return {
    steps: run.steps.map(({ step, status, shape }) => ({ step, status, shape })),
    facts: run.facts,
  }
}

function stepDifferences(
  scenario: string,
  expected: GoldenStep,
  actual: GoldenStep | undefined,
): StepDifference[] {
  const at = { scenario, step: expected.step }

  if (actual === undefined)
    return [
      {
        ...at,
        kind: "missing-step",
        path: "",
        expected: `status ${expected.status}`,
        actual: "not reached",
      },
    ]
  if (actual.status !== expected.status)
    return [
      {
        ...at,
        kind: "status-mismatch",
        path: "",
        expected: String(expected.status),
        actual: String(actual.status),
      },
    ]

  return compareShapes(expected.shape, actual.shape).map((difference) => ({ ...at, ...difference }))
}

function factDifferences(
  scenario: string,
  expected: readonly Fact[],
  actual: readonly Fact[],
): StepDifference[] {
  return expected.flatMap((fact) => {
    const other = actual.find((candidate) => candidate.name === fact.name)

    if (other !== undefined && other.value === fact.value) return []

    return [
      {
        scenario,
        step: "facts",
        kind: fact.kind ?? "status-mismatch",
        path: fact.name,
        expected: JSON.stringify(fact.value),
        actual: other === undefined ? "not recorded" : JSON.stringify(other.value),
      },
    ]
  })
}

/** Every difference between what the real provider answered and what the emulator answered. */
export function compareRun(
  expected: GoldenScenario,
  actual: GoldenScenario,
  scenario: string,
): StepDifference[] {
  const used = new Set<number>()
  const steps = expected.steps.flatMap((step) => {
    const index = actual.steps.findIndex(
      (candidate, i) => !used.has(i) && candidate.step === step.step,
    )

    if (index >= 0) used.add(index)

    return stepDifferences(scenario, step, actual.steps[index])
  })

  return [...steps, ...factDifferences(scenario, expected.facts, actual.facts)]
}

/** Whether a known difference's optional field allows `value`: unset allows anything. */
function allows(field: string | undefined, value: string): boolean {
  return field === undefined || field === value
}

/** Whether a known difference's path covers `path`: exactly, or as a prefix ending in `.`. */
function coversPath(known: string | undefined, path: string): boolean {
  return known === undefined || known === path || (known.endsWith(".") && path.startsWith(known))
}

function covers(known: KnownDifference, provider: string, difference: StepDifference): boolean {
  return (
    known.provider === provider &&
    known.kind === difference.kind &&
    allows(known.scenario, difference.scenario) &&
    allows(known.step, difference.step) &&
    coversPath(known.path, difference.path)
  )
}

/** Splits differences into the ones a known difference accepts and the ones that count. */
export function applyKnown(
  provider: string,
  differences: readonly StepDifference[],
  known: readonly KnownDifference[],
): { readonly counted: StepDifference[]; readonly accepted: StepDifference[] } {
  const accepted = differences.filter((difference) =>
    known.some((entry) => covers(entry, provider, difference)),
  )

  return { counted: differences.filter((difference) => !accepted.includes(difference)), accepted }
}
