/**
 * A replayed step's effects side by side: each change to the page and each backend call, marked
 * by whether the recording expected it, the replay did it, or both.
 */
import type { effectsOf } from "@danwo/runner/runner"

type EffectsEvent = NonNullable<ReturnType<typeof effectsOf>>

/** One line of the diff. */
export interface EffectLine {
  readonly area: "page" | "backend"
  /** The element that appeared (`+`) or vanished (`-`), or the backend call. */
  readonly text: string
  /** `both` matched; `expected` the replay missed; `observed` the recording never had. */
  readonly seen: "both" | "expected" | "observed"
}

type Effects = NonNullable<EffectsEvent["expected"]>

function linesOf(effects: Effects | undefined): { area: EffectLine["area"]; text: string }[] {
  if (effects === undefined) return []

  return [
    ...effects.page.appeared.map((text) => ({ area: "page" as const, text: `+ ${text}` })),
    ...effects.page.vanished.map((text) => ({ area: "page" as const, text: `- ${text}` })),
    ...effects.backend.map((text) => ({ area: "backend" as const, text })),
  ]
}

function key(line: { readonly area: string; readonly text: string }): string {
  return `${line.area}\n${line.text}`
}

/** The diff of what a step's recording expected against what its replay did, page first. */
export function effectDiff(event: EffectsEvent): EffectLine[] {
  const expected = linesOf(event.expected)
  const observed = linesOf(event.observed)
  const seenNow = new Set(observed.map(key))
  const seenBefore = new Set(expected.map(key))

  return [
    ...expected.map(
      (line) => ({ ...line, seen: seenNow.has(key(line)) ? "both" : "expected" }) as const,
    ),
    ...observed
      .filter((line) => !seenBefore.has(key(line)))
      .map((line) => ({ ...line, seen: "observed" }) as const),
  ].toSorted((a, b) => (a.area === b.area ? 0 : a.area === "page" ? -1 : 1))
}
