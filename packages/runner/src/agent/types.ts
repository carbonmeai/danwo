/** The agent as a test uses it: plain-language steps and claims about the page. */
import type { z } from "zod"

import type { Params } from "../replay/params.ts"

export interface ActOptions {
  /** Values the instruction names in braces, e.g. `{ params: { email: unique("ada@x.test") } }`. */
  readonly params?: Params
  /**
   * Files the step may upload, by name: `{ files: { avatar: "fixtures/avatar.png" } }`. The agent
   * sees only the names; paths resolve against the project root. A recording keeps the names, so
   * a replay needs the same names offered again.
   */
  readonly files?: Readonly<Record<string, string>>
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
  /** Asks the judge whether `claim` holds for the page as it is now; throws when it does not. */
  assert(claim: string): Promise<void>
}
