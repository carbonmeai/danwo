/**
 * Why a coding CLI gave no answer, as danwo's codes. A CLI that is not installed or not signed in
 * is set up wrongly (`CONFIG_INVALID`, as a missing API key is); a usage limit, a rate limit, a
 * timeout or a crash means the model could not be had (`MODEL_UNAVAILABLE`). Each message names
 * the command that fixes it.
 */
import { DanwoError, type ErrorCode } from "../../support/codes.ts"

/** What an error message says about a CLI. */
export interface CliInfo {
  /** Its name for people: `Codex CLI`. */
  readonly title: string
  /** The program danwo starts: `codex`. */
  readonly program: string
  /** The command that signs it in: `codex login`. */
  readonly login: string
  /** How to install it. */
  readonly install: string
  /** The plan it signs in with, for the message: `ChatGPT`. */
  readonly plan: string
}

/** A CLI-backed model call that failed for a reason outside the app. */
class CliModelError extends DanwoError {
  constructor(code: ErrorCode, message: string) {
    super(code, message)
    this.name = "CliModelError"
  }
}

/** Anything that looks like a key or a bearer token, so a quoted CLI message never shows one. */
const SECRET_LIKE = /\b(?:sk-[\w-]{8,}|Bearer\s+[\w.~+/-]{8,}|eyJ[\w-]{10,}\.[\w-]+\.[\w-]+)/g

/** What the CLI said, on one line, short, with anything key-like masked. */
export function excerpt(text: string): string {
  const line = text.replaceAll(SECRET_LIKE, "***").replaceAll(/\s+/g, " ").trim()

  return line.length > 300 ? `${line.slice(0, 297)}...` : line
}

const QUOTA =
  /\b429\b|rate.?limit|usage.?limit|quota|too many requests|limit reached|hit your limit|insufficient_quota|credit balance|out of credits/i
const SIGNED_OUT =
  /\b401\b|unauthori[sz]ed|not logged in|not signed in|\/login\b|log ?in again|sign ?in again|invalid api key|authentication_error|token (?:has )?expired|missing bearer/i

export function missingCli(cli: CliInfo): CliModelError {
  return new CliModelError(
    "CONFIG_INVALID",
    `${cli.title} is not installed: danwo starts \`${cli.program}\` and found no such program. Install it (${cli.install}), run \`${cli.login}\` once, then run again.`,
  )
}

export function signedOut(cli: CliInfo, said?: string): CliModelError {
  const quoted = said === undefined || said === "" ? "" : ` (it said "${excerpt(said)}")`

  return new CliModelError(
    "CONFIG_INVALID",
    `${cli.title} is not signed in${quoted}. Run \`${cli.login}\` in a terminal; it signs in with your ${cli.plan} plan, and agent steps then run on it.`,
  )
}

export function timedOut(cli: CliInfo, ms: number): CliModelError {
  return new CliModelError(
    "MODEL_UNAVAILABLE",
    `${cli.title} gave no answer in ${Math.round(ms / 1000)} s and was stopped. Run again, or give the model a longer \`timeoutMs\`.`,
  )
}

/** The failure a CLI's exit and output describe: a usage limit, a lost sign-in, or a crash. */
export function cliFailure(cli: CliInfo, said: string, exitCode: number | null): CliModelError {
  if (QUOTA.test(said))
    return new CliModelError(
      "MODEL_UNAVAILABLE",
      `${cli.title} hit your ${cli.plan} plan's usage or rate limit ("${excerpt(said)}"). Wait for the limit to reset, or run agent steps on an API key model meanwhile; replays need no model.`,
    )
  if (SIGNED_OUT.test(said)) return signedOut(cli, said)

  const how = exitCode === null ? "was stopped" : `exited with code ${exitCode}`
  const what = said === "" ? "" : `: ${excerpt(said)}`

  return new CliModelError(
    "MODEL_UNAVAILABLE",
    `${cli.title} ${how} without an answer${what}. Run \`${cli.program} --version\` to check the install, and \`${cli.login}\` if its sign-in has lapsed.`,
  )
}
