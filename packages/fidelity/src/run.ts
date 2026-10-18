/**
 * Runs fidelity suites. With a provider's sandbox credentials it runs every scenario against both
 * the sandbox and the emulator and compares them, optionally keeping the sandbox's structure as the
 * new golden. Without credentials it compares the emulator against the committed golden.
 */
import {
  type Golden,
  type GoldenScenario,
  type StepDifference,
  applyKnown,
  compareRun,
  goldenOf,
  readGolden,
  readKnownDifferences,
  writeGolden,
} from "./golden.ts"
import { type ApiDescription, documentedShape } from "./openapi.ts"
import type { FidelityProvider } from "./provider.ts"
import { runScenario, type Scenario, type ScenarioRun, type Target } from "./scenario.ts"

/** How a provider was checked. */
export type FidelityMode = "live" | "offline" | "openapi"

export interface ScenarioReport {
  readonly scenario: string
  readonly counted: readonly StepDifference[]
  readonly accepted: readonly StepDifference[]
  /** The scenario threw on the emulator or the sandbox. */
  readonly error?: string
  /** No golden covers this scenario yet. */
  readonly unchecked?: boolean
}

export interface ProviderReport {
  readonly provider: string
  readonly mode: FidelityMode
  readonly scenarios: readonly ScenarioReport[]
  /** Set when a golden file was written. */
  readonly wrote?: string
}

export interface FidelityOptions {
  /** The repository root: goldens live in its `fidelity/` folder. */
  readonly root: string
  readonly providers: readonly FidelityProvider[]
  readonly env: Readonly<Record<string, string | undefined>>
  /** Keep the sandbox's structure (or the description's) as the new golden. */
  readonly updateGolden?: boolean
  /** Make goldens from these API descriptions instead of a sandbox, by provider name. */
  readonly descriptions?: ReadonlyMap<string, ApiDescription>
  /** Never call a sandbox, even with credentials set. */
  readonly offline?: boolean
}

/** Runs one scenario on a fresh emulator, so scenarios never see each other's data. */
async function onEmulator(provider: FidelityProvider, scenario: Scenario): Promise<ScenarioRun> {
  const target = await provider.emulator()

  try {
    return await runScenario(scenario, target)
  } finally {
    await target.close()
  }
}

function documentedGolden(
  run: ScenarioRun,
  scenario: Scenario,
  description: ApiDescription,
  looseNulls: boolean,
): GoldenScenario {
  const steps = run.steps.flatMap((step) =>
    step.doc === undefined
      ? []
      : [
          {
            step: step.step,
            status: step.doc.status,
            shape: documentedShape(description, step.doc, looseNulls),
          },
        ],
  )

  return { steps, facts: scenario.documentedFacts ?? [] }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Checked {
  readonly reports: ScenarioReport[]
  readonly golden: Record<string, GoldenScenario>
}

async function checkAgainst(
  provider: FidelityProvider,
  expectedOf: (
    scenario: Scenario,
    emulated: ScenarioRun,
  ) => Promise<{ run?: ScenarioRun; golden?: GoldenScenario }>,
  known: Parameters<typeof applyKnown>[2],
): Promise<Checked> {
  const reports: ScenarioReport[] = []
  const golden: Record<string, GoldenScenario> = {}

  for (const scenario of provider.scenarios) {
    const emulated = await onEmulator(provider, scenario)
    const expected = await expectedOf(scenario, emulated)
    const error = expected.run?.error ?? emulated.error

    if (expected.golden === undefined) {
      reports.push({
        scenario: scenario.name,
        counted: [],
        accepted: [],
        unchecked: true,
        ...(error !== undefined && { error }),
      })
      continue
    }

    golden[scenario.name] = expected.golden

    const differences = compareRun(expected.golden, goldenOf(emulated), scenario.name)
    const { counted, accepted } = applyKnown(provider.name, differences, known)

    reports.push({
      scenario: scenario.name,
      counted,
      accepted,
      ...(error !== undefined && { error }),
    })
  }

  return { reports, golden }
}

function expectations(
  provider: FidelityProvider,
  live: Target | undefined,
  options: FidelityOptions,
  saved: Golden | undefined,
): {
  mode: FidelityMode
  of: (
    scenario: Scenario,
    emulated: ScenarioRun,
  ) => Promise<{ run?: ScenarioRun; golden?: GoldenScenario }>
} {
  const description = options.descriptions?.get(provider.name)

  if (live !== undefined)
    return {
      mode: "live",
      of: async (scenario) => {
        const run = await runScenario(scenario, live)

        return { run, ...(run.error === undefined && { golden: goldenOf(run) }) }
      },
    }
  if (description !== undefined)
    return {
      mode: "openapi",
      of: (scenario, emulated) =>
        Promise.resolve({
          golden: documentedGolden(
            emulated,
            scenario,
            description,
            provider.openapiLooseNulls === true,
          ),
        }),
    }

  return {
    mode: "offline",
    of: (scenario) => {
      const golden = saved?.scenarios[scenario.name]

      return Promise.resolve(golden === undefined ? {} : { golden })
    },
  }
}

/** Checks one provider. */
async function checkProvider(
  provider: FidelityProvider,
  options: FidelityOptions,
): Promise<ProviderReport> {
  const live = options.offline === true ? undefined : provider.live(options.env)
  const saved = await readGolden(options.root, provider.name)
  const known = await readKnownDifferences(options.root)
  const plan = expectations(provider, live, options, saved)
  const { reports, golden } = await checkAgainst(provider, plan.of, known)
  const write =
    options.updateGolden === true && plan.mode !== "offline" && Object.keys(golden).length > 0

  if (!write) return { provider: provider.name, mode: plan.mode, scenarios: reports }

  const source = plan.mode === "live" ? "live" : "openapi"

  await writeGolden(options.root, {
    provider: provider.name,
    source,
    recorded: today(),
    scenarios: { ...saved?.scenarios, ...golden },
  })

  return {
    provider: provider.name,
    mode: plan.mode,
    scenarios: reports,
    wrote: `fidelity/${provider.name}.json`,
  }
}

/** Checks every provider in `options.providers`, one after the other. */
export async function runFidelity(options: FidelityOptions): Promise<ProviderReport[]> {
  const reports: ProviderReport[] = []

  for (const provider of options.providers) reports.push(await checkProvider(provider, options))

  return reports
}

const KIND_LABELS: Readonly<Record<StepDifference["kind"], string>> = {
  "missing-field": "missing field",
  "extra-field": "extra field",
  "type-mismatch": "type mismatch",
  "status-mismatch": "status mismatch",
  "error-code-mismatch": "error-code mismatch",
  ordering: "ordering",
  "missing-step": "missing step",
}

function differenceLine(difference: StepDifference): string {
  const where = difference.path === "" ? "" : ` ${difference.path}`

  return `      ${KIND_LABELS[difference.kind]}${where}: real ${difference.expected}, emulator ${difference.actual}`
}

function scenarioLines(report: ScenarioReport): string[] {
  const head = report.unchecked === true ? "  ·" : report.counted.length === 0 ? "  ✓" : "  ✗"
  const note =
    report.unchecked === true
      ? " (no golden yet)"
      : report.accepted.length > 0
        ? ` (${report.accepted.length} known)`
        : ""
  const lines = [`${head} ${report.scenario}${note}`]
  const byStep = Map.groupBy(report.counted, (difference) => difference.step)

  for (const [step, differences] of byStep)
    lines.push(`    ${step}`, ...differences.map(differenceLine))
  if (report.error !== undefined) lines.push(`    error: ${report.error}`)

  return lines
}

/** A report as lines for a terminal. */
export function formatFidelity(reports: readonly ProviderReport[]): string[] {
  return reports.flatMap((report) => {
    const failing = report.scenarios.filter((s) => s.counted.length > 0).length
    const header = `${report.provider} (${report.mode}): ${report.scenarios.length - failing} of ${report.scenarios.length} scenarios match`

    return [
      header,
      ...report.scenarios.flatMap(scenarioLines),
      ...(report.wrote === undefined ? [] : [`  wrote ${report.wrote}`]),
      "",
    ]
  })
}

/** Whether every checked scenario matched. */
export function fidelityPassed(reports: readonly ProviderReport[]): boolean {
  return reports.every((report) =>
    report.scenarios.every((scenario) => scenario.counted.length === 0),
  )
}
