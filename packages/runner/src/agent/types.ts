/** The agent as a test uses it: plain-language steps and claims about the page. */
import type { z } from "zod"

import type { Params } from "../replay/params.ts"
import type { Budget } from "./budget.ts"

export interface ActOptions {
  /** Values the instruction names in braces, e.g. `{ params: { email: unique("ada@x.test") } }`. */
  readonly params?: Params
  /**
   * Files the step may upload, by name: `{ files: { avatar: "fixtures/avatar.png" } }`. The agent
   * sees only the names; paths resolve against the project root. A recording keeps the names, so
   * a replay needs the same names offered again.
   */
  readonly files?: Readonly<Record<string, string>>
  /** Limits for this step, over the session's: turns, model calls, cost and wall time. */
  readonly budget?: Budget
  /**
   * Whether a replay of this step must have the effects its recording had, on the page and behind
   * it (default true, unless the session turned effects off). `false` replays its actions only.
   */
  readonly effects?: boolean
}

export interface ActResult {
  /** What the step did, in the agent's words (or the replay's). */
  readonly summary: string
  /** Model calls the step made; 0 when it replayed a recording. */
  readonly modelCalls: number
  /** Actions taken on the page. */
  readonly actions: number
}

export interface ExtractOptions {
  /** Values the instruction names in braces, as for `act`. */
  readonly params?: Params
}

/** How long to keep looking, and how often; `true` takes the session's assertion timeout. */
export type PollOption = boolean | { readonly timeout?: number; readonly interval?: number }

export interface AssertOptions {
  /** Ask the judge again until the claim holds or time runs out, instead of once. */
  readonly poll?: PollOption
}

export interface WaitForOptions {
  /** How long to wait, in milliseconds; default 30 000. */
  readonly timeout?: number
  /** How often the judge looks while the condition does not hold yet; default 1 000. */
  readonly interval?: number
  /** Values the condition names in braces, as for `act`. */
  readonly params?: Params
}

export interface Agent {
  /** Carries out `instruction` on the page, replaying a recording of it when there is one. */
  act(instruction: string, options?: ActOptions): Promise<ActResult>
  /**
   * Reads typed data off the page: `extract("the account balance", z.object({ balance:
   * z.number() }))`. The model points at the elements that show each value and the runner reads
   * them, so values come from the page, never from the model; the result is checked against
   * `schema`. A recording of where each value was read replays with no model call.
   */
  extract<T>(instruction: string, schema: z.ZodType<T>, options?: ExtractOptions): Promise<T>
  /**
   * Asks the judge whether `claim` holds for the page as it is now; throws when it does not. With
   * `poll`, asks again until it holds or the time is up.
   */
  assert(claim: string, options?: AssertOptions): Promise<void>
  /**
   * Waits until `condition` holds, e.g. `waitFor("the order shows as paid")`. The judge looks at
   * the page until it does and names text on it that shows so; a recording of that text replays by
   * waiting for it to appear, with no model call. Throws `WAIT_TIMED_OUT` when time runs out.
   */
  waitFor(condition: string, options?: WaitForOptions): Promise<void>
}
