/**
 * A replayed step's effects as reports show them: how the comparison went, and for a step whose
 * effects differed, what the recording expected and what the replay did.
 */
import type { Effects } from "../replay/effects.ts"
import type { EffectsEvent, StepEvent } from "./steps.ts"

/** The step's effect comparison, when its replay was compared. */
export function effectsOf(events: readonly StepEvent[]): EffectsEvent | undefined {
  return events.find((event): event is EffectsEvent => event.kind === "effects")
}

/** Effects as one line: elements in (+) and out (-) of the page, then the backend's calls. */
function effectsLine(effects: Effects): string {
  const page = [
    ...effects.page.appeared.map((element) => `+${element}`),
    ...effects.page.vanished.map((element) => `-${element}`),
  ]
  const parts = [
    page.length > 0 ? `page ${page.join(", ")}` : "page unchanged",
    effects.backend.length > 0 ? `backend ${effects.backend.join(", ")}` : "no backend calls",
  ]

  return parts.join("; ")
}

/** What a report says about one comparison: the verdict, its reason, then expected and observed. */
export function effectNotes(check: EffectsEvent): string[] {
  const head = `effects ${check.result}${check.reason === undefined ? "" : `: ${check.reason}`}`
  const lines = [head]

  if (check.note !== undefined) lines.push(check.note)
  if (check.result !== "diverged") return lines
  if (check.expected !== undefined) lines.push(`expected: ${effectsLine(check.expected)}`)
  if (check.observed !== undefined) lines.push(`observed: ${effectsLine(check.observed)}`)

  return lines
}
