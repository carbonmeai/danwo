/**
 * Noticing an agent that is stuck: the same action again and again, two or three actions in a
 * cycle (open, close, open, close), or a run of actions that all fail. The first time the step is
 * warned; if it happens again the step is stopped.
 */

/** How many identical actions in a row count as stuck. */
const REPEATS = 3
/** How many failed actions in a row count as stuck. */
const FAILURES = 3
/** Cycle lengths looked for; a cycle counts once it went round twice. */
const CYCLES = [2, 3] as const

interface Done {
  readonly signature: string
  readonly failed: boolean
}

/** The last `n` entries of `list`, or undefined when there are fewer. */
function lastOf<T>(list: readonly T[], n: number): readonly T[] | undefined {
  return list.length >= n ? list.slice(-n) : undefined
}

function repeating(history: readonly Done[]): string | undefined {
  const last = lastOf(history, REPEATS)

  return last?.every((done) => done.signature === last[0]?.signature)
    ? `the same action ${REPEATS} times in a row`
    : undefined
}

function cycling(history: readonly Done[]): string | undefined {
  for (const length of CYCLES) {
    const last = lastOf(history, length * 2)
    const first = last?.slice(0, length).map((done) => done.signature)
    const second = last?.slice(length).map((done) => done.signature)
    const distinct = new Set(first).size > 1

    if (first && second && distinct && first.every((signature, at) => signature === second[at]))
      return `the same ${length} actions in a cycle, twice`
  }

  return undefined
}

function failing(history: readonly Done[]): string | undefined {
  return lastOf(history, FAILURES)?.every((done) => done.failed)
    ? `${FAILURES} actions in a row that failed`
    : undefined
}

/** What the guard makes of the latest action. */
export type GuardCall =
  | { readonly kind: "ok" }
  | { readonly kind: "warn"; readonly message: string }
  | { readonly kind: "stop"; readonly reason: string }

/** Watches one step's actions for the agent going round in circles. */
export class LoopGuard {
  private history: Done[] = []
  private warned = false

  /** Notes an action and whether it failed; says whether to carry on, warn, or stop. */
  note(signature: string, failed: boolean): GuardCall {
    this.history.push({ signature, failed })

    const stuck = repeating(this.history) ?? cycling(this.history) ?? failing(this.history)

    if (stuck === undefined) return { kind: "ok" }
    if (this.warned) return { kind: "stop", reason: `the agent kept going round: ${stuck}` }

    this.warned = true
    this.history = []

    return {
      kind: "warn",
      message: `You have made ${stuck} without getting further. Try a different approach; if the instruction cannot be carried out on this page, call done with status "failed" and say why.`,
    }
  }
}
