/**
 * The fixed set of error codes danwo reports, each in a class that decides what a failure means and
 * how a run exits:
 *
 * | Class          | Meaning                                                     | Exit |
 * | -------------- | ----------------------------------------------------------- | ---- |
 * | `test`         | the app or the test did not do what the test expects        | 1    |
 * | `blocked`      | the test could not be judged (the page never got there)     | 1    |
 * | `inconclusive` | the judge could not tell from what the page shows           | 1    |
 * | `config`       | the project, a test or a call is set up wrongly             | 2    |
 * | `infra`        | the browser, the environment or the model provider failed   | 3    |
 * | `interrupted`  | the run was stopped                                         | 130  |
 *
 * `danwo matrix` reports a trial whose failure is `blocked`, `inconclusive` or `infra` as "not
 * judged": nothing about the fault is known from it.
 */

export type ErrorClass = "test" | "blocked" | "inconclusive" | "config" | "infra" | "interrupted"

/** Every code, with its class and what it means. */
const ERROR_CODES = {
  EXPECTATION_FAILED: ["test", "an `expect` check did not hold within its timeout"],
  LOCATOR_NOT_FOUND: ["test", "a locator matched no element"],
  LOCATOR_AMBIGUOUS: ["test", "a locator that acts or is checked matched more than one element"],
  LOCATOR_NOT_READY: ["test", "the element was there but not visible, enabled or stable in time"],
  LOCATOR_FAILED: ["test", "an action on an element failed"],
  SCREENSHOT_MISMATCH: ["test", "a screenshot differs from its baseline"],
  CLAIM_FAILED: ["test", "the judge says an `agent.assert` claim does not hold"],
  CLAIM_BLOCKED: ["blocked", "the judge could not evaluate the claim (the page is not there)"],
  CLAIM_INCONCLUSIVE: ["inconclusive", "the judge could not tell whether the claim holds"],
  AGENT_STEP_FAILED: ["test", "the agent could not carry out an `agent.act` step"],
  AGENT_LOOPING: ["test", "the agent kept repeating itself and was made to stop"],
  BUDGET_EXCEEDED: ["test", "a step or test used up its turns, model calls, cost or time"],
  EXTRACT_FAILED: ["test", "`agent.extract` could not read a valid result"],
  WAIT_TIMED_OUT: ["test", "`agent.waitFor` did not see its condition hold in time"],
  MODEL_OUTPUT_INVALID: [
    "inconclusive",
    "the model kept answering in a form danwo could not use, even when told what was wrong",
  ],
  MODEL_REFUSED: [
    "inconclusive",
    "the model declined a step, or its provider's content filter stopped the answer; not asked again",
  ],
  APP_ERROR: [
    "test",
    "the app failed during a step: a 5xx response, an uncaught error, a console error",
  ],
  PROVIDER_ERROR: ["test", "a provider call failed during a step and the app did not recover"],
  NOTHING_RECORDED: ["blocked", "strict replay found no recording of a step"],
  STALE_RECORDING: [
    "blocked",
    "strict replay found a recording of the step made under another key",
  ],
  REPLAY_MISSING: [
    "blocked",
    "under replay-only, a step had no recording that replays, and no model may run it",
  ],
  SECRET_REFUSED: ["test", "a secret was about to go into a field its purpose does not allow"],
  SESSION_SETUP_FAILED: ["test", "a saved session's setup failed"],
  TIMED_OUT: ["test", "the test ran past its deadline"],
  TEST_FAILED: ["test", "the test threw an error of its own"],
  CONFIG_INVALID: ["config", "the project or the call is set up wrongly"],
  MODEL_UNAVAILABLE: ["infra", "the model provider could not be reached or refused the call"],
  BROWSER_FAILED: ["infra", "the browser crashed, closed or could not start"],
  ENVIRONMENT_FAILED: ["infra", "the worker's environment (app, emulators, proxy) failed"],
  INTERRUPTED: ["interrupted", "the run was stopped (Ctrl-C or a signal)"],
} as const satisfies Record<string, readonly [ErrorClass, string]>

export type ErrorCode = keyof typeof ERROR_CODES

const CODES: readonly string[] = Object.keys(ERROR_CODES)

/** Whether `code` is one of danwo's codes. */
function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && CODES.includes(code)
}

/** The class of a code. */
export function classOf(code: ErrorCode): ErrorClass {
  return ERROR_CODES[code][0]
}

/** The exit code a class of failure gives a run. */
const EXIT: Record<ErrorClass, number> = {
  test: 1,
  blocked: 1,
  inconclusive: 1,
  config: 2,
  infra: 3,
  interrupted: 130,
}

/** Which class decides the run's exit when several failed: the first of these present. */
const PRECEDENCE: readonly ErrorClass[] = [
  "interrupted",
  "config",
  "infra",
  "test",
  "blocked",
  "inconclusive",
]

/** The exit code of a run whose failures fell in `classes`; 0 when none failed. */
export function exitCodeOf(classes: readonly ErrorClass[]): number {
  const deciding = PRECEDENCE.find((kind) => classes.includes(kind))

  return deciding === undefined ? 0 : EXIT[deciding]
}

/** The exit code a run that stopped with `error` gives, by the error's class. */
export function exitCodeForError(error: unknown): number {
  return exitCodeOf([classOf(codeOf(error))])
}

/** One row of the code table: a code, its class, the exit code it gives and what it means. */
export interface ErrorCodeRow {
  readonly code: ErrorCode
  readonly class: ErrorClass
  readonly exit: number
  readonly meaning: string
}

/** Every error code with its class, exit code and meaning, in the table's order. */
export function errorCodeTable(): readonly ErrorCodeRow[] {
  return CODES.filter(isErrorCode).map((code) => {
    const [kind, meaning] = ERROR_CODES[code]

    return { code, class: kind, exit: EXIT[kind], meaning }
  })
}

/** Whether a failure of this class says nothing about the app: the run could not be judged. */
export function notJudged(kind: ErrorClass): boolean {
  return kind === "blocked" || kind === "inconclusive" || kind === "infra"
}

/** An error that carries one of danwo's codes. */
export class DanwoError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "DanwoError"
    this.code = code
  }
}

/** Errors other code raises, matched by their name or what they say. */
const KNOWN: readonly { readonly code: ErrorCode; readonly test: (error: Error) => boolean }[] = [
  { code: "EXPECTATION_FAILED", test: (error) => error.name === "AssertionError" },
  {
    code: "CONFIG_INVALID",
    test: (error) =>
      ["AI_LoadAPIKeyError", "AI_NoSuchModelError", "GatewayAuthenticationError"].includes(
        error.name,
      ),
  },
  {
    code: "MODEL_UNAVAILABLE",
    test: (error) =>
      /^AI_(APICall|Retry|EmptyResponseBody|InvalidResponseData)/.test(error.name) ||
      error.name.startsWith("Gateway"),
  },
  {
    code: "BROWSER_FAILED",
    test: (error) =>
      /Target page, context or browser has been closed|browserType\.launch|Browser closed|browser has disconnected/.test(
        error.message,
      ),
  },
]

/** The code of any error: its own when it is one of danwo's, else what it is known to be. */
export function codeOf(error: unknown): ErrorCode {
  if (!(error instanceof Error)) return "TEST_FAILED"

  const own = "code" in error ? error.code : undefined

  if (isErrorCode(own)) return own

  return KNOWN.find((known) => known.test(error))?.code ?? "TEST_FAILED"
}
