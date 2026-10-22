/**
 * One run of a coding CLI: started as a terminal would start it (through `cmd.exe` on Windows, so
 * an npm-installed `.cmd` shim starts), owned so it is stopped with its whole process tree when
 * the run stops, fed its prompt on stdin, and stopped at a deadline.
 */
import { spawnOwned } from "../../support/children.ts"
import { spawnPlan, type SpawnPlan } from "../../support/command-line.ts"
import { type CliInfo, missingCli, timedOut } from "./failure.ts"

/** What a CLI printed and how it ended. */
export interface CliExit {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** A program and the arguments that always go first: `["codex"]`, or a script under Node. */
export type CliCommand = string | readonly [string, ...string[]]

export interface CliRun {
  readonly command: CliCommand
  readonly args: readonly string[]
  readonly stdin?: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly signal?: AbortSignal | undefined
}

/** Output past this much is dropped; an answer is far smaller. */
const MAX_OUTPUT = 16 * 1024 * 1024

/** What `cmd.exe` exits with, and says, when it cannot find the program. */
const WINDOWS_NOT_FOUND = 9009
const WINDOWS_NOT_FOUND_TEXT = /is not recognized as an internal or external command/i

/** How `run` starts on `platform`. */
export function cliPlan(
  command: CliCommand,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string | undefined = process.env.ComSpec,
): SpawnPlan {
  const [program, ...first] = typeof command === "string" ? [command] : command

  return spawnPlan(program, [...first, ...args], platform, comspec)
}

/** Appends `chunk` to `text`, up to the cap. */
function capped(text: string, chunk: Buffer): string {
  return text.length >= MAX_OUTPUT ? text : text + chunk.toString("utf8")
}

/**
 * Runs the CLI to its end. Throws `missingCli` when it is not installed, `timedOut` when it runs
 * past `timeoutMs`, and the signal's reason when the run is aborted; the process tree is stopped
 * in each case.
 */
export async function runCli(cli: CliInfo, run: CliRun): Promise<CliExit> {
  run.signal?.throwIfAborted()

  const plan = cliPlan(run.command, run.args)
  const owned = spawnOwned(plan.command, plan.args, {
    ...(run.cwd !== undefined && { cwd: run.cwd }),
    env: { ...process.env, NO_COLOR: "1", ...run.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  })
  const child = owned.child
  let stdout = ""
  let stderr = ""

  child.stdout?.on("data", (chunk: Buffer) => (stdout = capped(stdout, chunk)))
  child.stderr?.on("data", (chunk: Buffer) => (stderr = capped(stderr, chunk)))
  /* A CLI that exits before reading its input closes the pipe under the write; its exit says why. */
  child.stdin?.on("error", () => undefined)
  child.stdin?.end(run.stdin ?? "")

  /* Why the run was stopped early; the error it ends with once the process tree is gone. */
  let stoppedFor: { readonly error: unknown } | undefined

  const stop = (error: unknown) => {
    if (stoppedFor !== undefined) return

    stoppedFor = { error }
    void owned.stop()
  }

  const timer = setTimeout(() => stop(timedOut(cli, run.timeoutMs)), run.timeoutMs)
  const onAbort = () => stop(run.signal?.reason)

  run.signal?.addEventListener("abort", onAbort, { once: true })

  const ended = new Promise<CliExit>((resolve, reject) => {
    child.once("error", (error: NodeJS.ErrnoException) =>
      reject(error.code === "ENOENT" ? missingCli(cli) : error),
    )
    child.once("close", (code) => {
      const missing =
        plan.windowsVerbatimArguments &&
        (code === WINDOWS_NOT_FOUND || (code === 1 && WINDOWS_NOT_FOUND_TEXT.test(stderr)))

      if (stoppedFor !== undefined) reject(stoppedFor.error)
      else if (missing) reject(missingCli(cli))
      else resolve({ code, stdout, stderr })
    })
  })

  try {
    return await ended
  } finally {
    clearTimeout(timer)
    run.signal?.removeEventListener("abort", onAbort)
  }
}
