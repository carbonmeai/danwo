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
import { cleanUpOnInterrupt, type LeftBehind, leftBehindLines, UNREMOVABLE } from "./ledger.ts"
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
  /** The sandbox could not run this scenario, and why; nothing was compared. */
  readonly skipped?: string
  /** What the live run made and could not undo, or kept on request. */
  readonly leftBehind?: readonly LeftBehind[]
  /** How many objects the live run made and undid. */
  readonly undone?: number
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
  /** Leave what live runs make in the sandboxes, reported as kept, for debugging. */
  readonly keep?: boolean
  /** Where an interrupted run says what it undid; standard error by default. */
  readonly write?: (line: string) => void
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

/** What a live run undid and left behind, as report fields. */
function cleanupOf(run: ScenarioRun | undefined): Pick<ScenarioReport, "leftBehind" | "undone"> {
  if (run === undefined) return {}

  return {
    ...(run.leftBehind !== undefined && { leftBehind: run.leftBehind }),
    ...(run.undone !== undefined && { undone: run.undone }),
  }
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
    const skipped = expected.run?.skipped
    const cleanup = cleanupOf(expected.run)

    if (skipped !== undefined) {
      reports.push({ scenario: scenario.name, counted: [], accepted: [], skipped, ...cleanup })
      continue
    }

    if (expected.golden === undefined) {
      reports.push({
        scenario: scenario.name,
        counted: [],
        accepted: [],
        unchecked: true,
        ...(error !== undefined && { error }),
        ...cleanup,
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
      ...cleanup,
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
        const run = await runScenario(scenario, live, { keep: options.keep === true })

        return {
          run,
          ...(run.error === undefined && run.skipped === undefined && { golden: goldenOf(run) }),
        }
      },
    }
  if (description !== undefined)
    return {
      mode: "openapi",
      of: (scenario, emulated) => {
        const golden = documentedGolden(
          emulated,
          scenario,
          description,
          provider.openapiLooseNulls === true,
        )

        /* A scenario with no documented step (one recorded live) keeps its saved golden. */
        return Promise.resolve(golden.steps.length === 0 ? {} : { golden })
      },
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

/**
 * Checks every provider in `options.providers`, one after the other. While it runs, an interrupt
 * undoes what live scenarios made before the process exits.
 */
export async function runFidelity(options: FidelityOptions): Promise<ProviderReport[]> {
  const reports: ProviderReport[] = []
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`))
  const release = cleanUpOnInterrupt(write)

  try {
    for (const provider of options.providers) reports.push(await checkProvider(provider, options))
  } finally {
    release()
  }

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

function scenarioHead(report: ScenarioReport): string {
  if (report.skipped !== undefined) return "  -"
  if (report.unchecked === true) return "  ·"

  return report.counted.length === 0 ? "  ✓" : "  ✗"
}

function scenarioNote(report: ScenarioReport): string {
  if (report.skipped !== undefined) return ` (skipped: ${report.skipped})`
  if (report.unchecked === true) return " (no golden yet)"

  return report.accepted.length > 0 ? ` (${report.accepted.length} known)` : ""
}

function scenarioLines(report: ScenarioReport): string[] {
  const lines = [`${scenarioHead(report)} ${report.scenario}${scenarioNote(report)}`]
  const byStep = Map.groupBy(report.counted, (difference) => difference.step)

  for (const [step, differences] of byStep)
    lines.push(`    ${step}`, ...differences.map(differenceLine))
  if (report.error !== undefined) lines.push(`    error: ${report.error}`)

  return lines
}

/** Whether the provider gives no way to remove what was left. */
function isUnremovable(item: LeftBehind): boolean {
  return item.reason.startsWith(UNREMOVABLE)
}

/**
 * Everything a provider's live scenarios left in its sandbox: kept on request, kept because the
 * provider cannot remove it, and stuck (an undo that went wrong).
 */
function leftovers(report: ProviderReport): {
  kept: LeftBehind[]
  unremovable: LeftBehind[]
  stuck: LeftBehind[]
} {
  const all = report.scenarios.flatMap((scenario) => scenario.leftBehind ?? [])

  return {
    kept: all.filter((item) => item.reason === "kept"),
    unremovable: all.filter(isUnremovable),
    stuck: all.filter((item) => item.reason !== "kept" && !isUnremovable(item)),
  }
}

function providerLines(report: ProviderReport): string[] {
  const failing = report.scenarios.filter((s) => s.counted.length > 0).length
  const skipped = report.scenarios.filter((s) => s.skipped !== undefined).length
  const header = `${report.provider} (${report.mode}): ${report.scenarios.length - failing - skipped} of ${report.scenarios.length} scenarios match${skipped > 0 ? `, ${skipped} skipped` : ""}`
  const { kept, unremovable, stuck } = leftovers(report)

  return [
    header,
    ...report.scenarios.flatMap(scenarioLines),
    ...leftBehindLines("could not be undone", stuck),
    ...leftBehindLines("kept, as --keep asked", kept),
    ...leftBehindLines("kept, the provider cannot remove it", unremovable),
    ...(report.wrote === undefined ? [] : [`  wrote ${report.wrote}`]),
    "",
  ]
}

/** The closing line for live runs: whether the sandboxes were left as they were found. */
function cleanupSummary(reports: readonly ProviderReport[]): string[] {
  const live = reports.filter((report) => report.mode === "live")

  if (live.length === 0) return []

  const stuck = live.flatMap((report) => leftovers(report).stuck)
  const kept = live.flatMap((report) => {
    const { kept: asked, unremovable } = leftovers(report)

    return [...asked, ...unremovable]
  })
  const undone = live
    .flatMap((report) => report.scenarios)
    .reduce((sum, scenario) => sum + (scenario.undone ?? 0), 0)

  if (stuck.length > 0)
    return [
      `left behind: ${stuck.length} object(s) in the sandboxes could not be undone; \`danwo fidelity --sweep\` removes tagged leftovers`,
    ]
  if (kept.length > 0)
    return [
      `kept: ${kept.length} object(s) in the sandboxes, listed above with why; \`danwo fidelity --sweep\` removes the tagged ones a provider lets it`,
    ]

  return undone === 0 ? [] : [`cleaned up: ${undone} object(s) undone, nothing left behind`]
}

/** A report as lines for a terminal. */
export function formatFidelity(reports: readonly ProviderReport[]): string[] {
  return [...reports.flatMap(providerLines), ...cleanupSummary(reports)]
}

/**
 * Whether every checked scenario matched and the live runs left nothing behind they were meant
 * to undo (what `--keep` kept on purpose does not count).
 */
export function fidelityPassed(reports: readonly ProviderReport[]): boolean {
  return reports.every(
    (report) =>
      report.scenarios.every((scenario) => scenario.counted.length === 0) &&
      leftovers(report).stuck.length === 0,
  )
}
