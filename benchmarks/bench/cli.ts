/**
 * Runs `danwo test` and `danwo matrix` in the benchmark's folder and reads what each run left in
 * `.danwo/history`: the per-test outcome, time and model usage, or the matrix's verdicts.
 */
import { spawn } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { z } from "zod"

/** The benchmark's folder, where its danwo project lives. */
export const BENCH_ROOT = fileURLToPath(new URL("..", import.meta.url))

const DANWO = join(BENCH_ROOT, "node_modules", "@danwo", "cli", "bin", "danwo.mjs")

const Spent = z.object({ calls: z.number(), usd: z.number() })
const Attempt = z.object({
  status: z.string(),
  durationMs: z.number(),
  usage: z.object({ spent: Spent }).optional(),
})
const TestRun = z.object({
  kind: z.literal("test"),
  startedAt: z.string(),
  tests: z.array(z.object({ id: z.string(), status: z.string(), attempts: z.array(Attempt) })),
})
const MatrixRun = z.object({
  kind: z.literal("matrix"),
  startedAt: z.string(),
  durationMs: z.number(),
  clean: z.object({ status: z.string() }),
  trials: z.array(z.object({ fault: z.string().nullable(), status: z.string() })),
})

export type TestRun = z.infer<typeof TestRun>

/** What one CLI run printed and how it exited. */
interface CliRun {
  readonly code: number
  readonly out: string
}

/** Runs `danwo <args>` in the benchmark's folder with `env` on top of this process's. */
function danwo(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DANWO, ...args], {
      cwd: BENCH_ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""

    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()))
    child.once("error", reject)
    child.once("close", (code) => resolve({ code: code ?? 1, out }))
  })
}

/** The newest run summary in `.danwo/history`. */
async function newestHistory(): Promise<unknown> {
  const dir = join(BENCH_ROOT, ".danwo", "history")
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).toSorted()
  const last = names.at(-1)

  if (last === undefined) throw new Error("danwo left no run history")

  return JSON.parse(await readFile(join(dir, last), "utf8"))
}

/** Runs `danwo test` and returns its run summary. */
export async function runTests(args: readonly string[], env: NodeJS.ProcessEnv) {
  const run = await danwo(["test", ...args], env)

  return { ...run, history: TestRun.parse(await newestHistory()) }
}

/** Runs `danwo matrix` and returns its run summary, plus how many lint errors it printed. */
export async function runMatrix(args: readonly string[], env: NodeJS.ProcessEnv) {
  const run = await danwo(["matrix", ...args], env)
  const lint = /integration lint: (\d+) errors?/.exec(run.out)

  return {
    ...run,
    history: MatrixRun.parse(await newestHistory()),
    lintErrors: Number(lint?.[1] ?? 0),
  }
}
