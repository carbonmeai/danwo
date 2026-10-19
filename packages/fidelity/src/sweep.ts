/**
 * `danwo fidelity --sweep`: finds what earlier live runs left in the providers' sandboxes and,
 * with `--yes`, removes it. Only objects carrying the `danwo-fidelity` tag are ever removed; older
 * leftovers that only look like fidelity runs (from before runs were tagged) are listed, never
 * touched.
 */
import { CleanupLedger, type Created, FIDELITY_TAG, type LeftBehind } from "./ledger.ts"
import type { FidelityProvider } from "./provider.ts"

/** Something found in a sandbox that an earlier live run may have left. */
export interface Leftover {
  readonly kind: string
  readonly id: string
  /** A short, non-secret description: a tagged email or a name. */
  readonly label: string
  /** Carries the `danwo-fidelity` tag, so the sweep may remove it. */
  readonly tagged: boolean
  /** Removes it, as the ledger would undo it. */
  readonly remove: Created["undo"]
  readonly settled?: Created["settled"]
}

export interface SweepReport {
  readonly provider: string
  /** Why the provider was not swept: no credentials, or no way to find or remove leftovers. */
  readonly unavailable?: string
  readonly found: readonly Leftover[]
  /** Tagged leftovers that could not be removed, when `yes` was given. */
  readonly failed: readonly LeftBehind[]
  /** Whether tagged leftovers were removed (`--yes`), rather than only listed. */
  readonly removed: boolean
}

export interface SweepOptions {
  readonly providers: readonly FidelityProvider[]
  readonly env: Readonly<Record<string, string | undefined>>
  /** Remove the tagged leftovers; without it they are only listed. */
  readonly yes?: boolean
}

/** Thrown by a provider's sweep when its target lacks what listing needs, such as a key. */
export class SweepUnavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "SweepUnavailable"
  }
}

/** Whether `text` carries the fidelity tag. */
export function isTagged(text: string | undefined | null): boolean {
  return typeof text === "string" && text.includes(FIDELITY_TAG)
}

async function sweepOne(provider: FidelityProvider, options: SweepOptions): Promise<SweepReport> {
  const empty = { provider: provider.name, found: [], failed: [], removed: false }

  if (provider.sweep === undefined)
    return { ...empty, unavailable: provider.leaves ?? "nothing to sweep" }

  const target = provider.live(options.env)

  if (target === undefined) return { ...empty, unavailable: "no sandbox credentials set" }

  let found: readonly Leftover[]

  try {
    found = await provider.sweep(target)
  } catch (error) {
    if (error instanceof SweepUnavailable) return { ...empty, unavailable: error.message }

    throw error
  }

  if (options.yes !== true) return { ...empty, found }

  const ledger = new CleanupLedger()

  for (const item of found.filter((leftover) => leftover.tagged))
    ledger.add({
      kind: item.kind,
      id: item.id,
      undo: item.remove,
      ...(item.settled !== undefined && { settled: item.settled }),
    })

  return {
    provider: provider.name,
    found,
    failed: (await ledger.drain()).toReversed(),
    removed: true,
  }
}

/** Sweeps every provider in `options.providers`, one after the other. */
export async function sweepFidelity(options: SweepOptions): Promise<SweepReport[]> {
  const reports: SweepReport[] = []

  for (const provider of options.providers) reports.push(await sweepOne(provider, options))

  return reports
}

function foundLine(item: Leftover): string {
  return `    ${item.kind} ${item.id} (${item.label})`
}

function reportLines(report: SweepReport): string[] {
  if (report.unavailable !== undefined)
    return [`${report.provider}: not swept (${report.unavailable})`, ""]

  const tagged = report.found.filter((item) => item.tagged)
  const untagged = report.found.filter((item) => !item.tagged)
  const verb = report.removed ? "removed" : "would remove"
  const removed = tagged.length - report.failed.length

  return [
    `${report.provider}: ${report.removed ? removed : tagged.length} tagged leftover(s) ${verb}`,
    ...tagged.map(foundLine),
    ...(untagged.length === 0
      ? []
      : [
          `  ${untagged.length} untagged object(s) that look like older fidelity runs, listed only:`,
          ...untagged.map(foundLine),
        ]),
    ...(report.failed.length === 0
      ? []
      : [
          "  could not remove:",
          ...report.failed.map((item) => `    ${item.kind} ${item.id}: ${item.reason}`),
        ]),
    "",
  ]
}

/** A sweep as lines for a terminal. */
export function formatSweep(reports: readonly SweepReport[], yes: boolean): string[] {
  const tagged = reports.reduce(
    (count, report) => count + report.found.filter((item) => item.tagged).length,
    0,
  )

  return [
    ...reports.flatMap(reportLines),
    ...(yes || tagged === 0 ? [] : ["run again with --yes to remove the tagged leftovers"]),
  ]
}

/** Whether every tagged leftover the sweep tried to remove is gone. */
export function sweepPassed(reports: readonly SweepReport[]): boolean {
  return reports.every((report) => report.failed.length === 0)
}
