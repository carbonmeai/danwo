/**
 * A stand-in for the Codex CLI, run with Node: it answers `--version`, `login status` and
 * `exec --json` the way the real one does, and logs each `exec` (its arguments, its prompt, what its
 * working folder held, which image files existed) as one JSON line to `FAKE_CLI_LOG`.
 *
 * `FAKE_CLI_MODE` picks the answer: `act` (the default) clicks the button named `FAKE_CLI_BUTTON`
 * and then calls `done`, or gives a judge's verdict when no tools are offered; `malformed` answers
 * with prose; `hang` never answers; `quota` and `expired` fail as a used-up plan and a lapsed
 * sign-in do; `signed-out` fails the status check; `no-usage` reports no token counts.
 */
import { appendFileSync, existsSync, readdirSync } from "node:fs"

const args = process.argv.slice(2)
const mode = process.env.FAKE_CLI_MODE ?? "act"

function emit(event: unknown): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

/** The value after `flag`, each time it appears. */
function values(flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []))
}

function answer(prompt: string): string {
  if (!prompt.includes("## Tools"))
    return JSON.stringify({ verdict: "holds", reason: "the page shows it" })
  if (prompt.includes("## Result of click"))
    return JSON.stringify({
      calls: [{ tool: "done", input: JSON.stringify({ status: "passed", summary: "clicked" }) }],
      text: "",
    })

  const name = process.env.FAKE_CLI_BUTTON ?? ""
  const line = prompt
    .split("\n")
    .find((entry) => entry.includes("- button") && entry.includes(name))
  const ref = line === undefined ? undefined : /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]

  return JSON.stringify({ calls: [{ tool: "click", input: JSON.stringify({ ref }) }], text: "" })
}

/** Logs the run: its arguments, its prompt, its working folder and which images exist. */
function logRun(prompt: string): void {
  const work = values("--cd")[0] ?? ""
  const log = process.env.FAKE_CLI_LOG

  if (log === undefined) return

  const run = {
    args,
    prompt,
    cwd: process.cwd(),
    workEntries: existsSync(work) ? readdirSync(work) : null,
    images: values("--image").map(existsSync),
  }

  appendFileSync(log, `${JSON.stringify(run)}\n`)
}

/** A failed turn, as a used-up plan or a lapsed sign-in ends one. */
function failTurn(): void {
  const message =
    mode === "quota"
      ? "You've hit your usage limit. Upgrade to Pro or try again later."
      : "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header"

  emit({ type: "error", message: `Reconnecting... 1/5 (${message})` })
  emit({ type: "turn.failed", error: { message } })
  process.exitCode = 1
}

const USAGE = {
  input_tokens: 1200,
  cached_input_tokens: 200,
  output_tokens: 40,
  reasoning_output_tokens: 10,
}

async function exec(): Promise<void> {
  let prompt = ""

  for await (const chunk of process.stdin) prompt += String(chunk)

  logRun(prompt)
  emit({ type: "thread.started", thread_id: "fake" })
  emit({ type: "turn.started" })

  if (mode === "hang") {
    await new Promise(() => setInterval(() => undefined, 1_000))

    return
  }

  if (mode === "quota" || mode === "expired") {
    failTurn()

    return
  }

  const text = mode === "malformed" ? "I would click the button." : answer(prompt)

  emit({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } })
  emit(mode === "no-usage" ? { type: "turn.completed" } : { type: "turn.completed", usage: USAGE })
}

if (args[0] === "--version") console.log("codex-cli 9.9.9")
else if (args[0] === "login" && args[1] === "status") {
  if (mode === "signed-out") {
    console.error("Not logged in")
    process.exitCode = 1
  } else console.error("Logged in using ChatGPT")
} else if (args[0] === "exec") await exec()
else {
  console.error(`fake codex: unknown command ${args.join(" ")}`)
  process.exitCode = 2
}
