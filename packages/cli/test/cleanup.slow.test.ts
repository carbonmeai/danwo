/**
 * `danwo test` and `danwo matrix` leave nothing running: not their workers, not the shop servers
 * the workers started, not the browsers. Each run carries its own marker in its environment, which
 * everything it starts inherits, so its processes can be found whatever happens to their parents.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import { processesWith } from "../../../scripts/no-leftover-processes.ts"
import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SHOP = workCopy(fileURLToPath(new URL("../../../examples/shop", import.meta.url)))
const PROBE = "DANWO_CLEANUP_PROBE"

afterAll(removeWorkCopies)

/** Starts `danwo <args>` in the shop as the leader of its own group, as a terminal would. */
function danwo(args: readonly string[], probe: string): ChildProcess {
  return spawn(process.execPath, [BIN, ...args], {
    cwd: SHOP,
    env: { ...process.env, NO_COLOR: "1", [PROBE]: probe },
    stdio: "ignore",
    detached: true,
  })
}

function exited(child: ChildProcess): Promise<void> {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", () => resolve()))
}

/** Resolves once nothing carrying `probe` runs; rejects with what still does after `ms`. */
async function nothingLeft(probe: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms

  while (processesWith(PROBE, probe).length > 0) {
    if (Date.now() > deadline)
      throw new Error(`still running: ${processesWith(PROBE, probe).join(", ")}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/** Resolves once at least `count` processes carry `probe`: the run's workers and shops are up. */
async function running(probe: string, count: number, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms

  while (processesWith(PROBE, probe).length < count) {
    if (Date.now() > deadline) throw new Error(`the run never started ${count} processes`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const probe = () => Math.random().toString(36).slice(2, 10)

/* It finds what a run left by a marker in each process's environment, which Windows keeps private. */
describe.skipIf(process.platform === "win32")("a run leaves nothing running", () => {
  it("after danwo test exits", async () => {
    const mark = probe()
    const run = danwo(["test"], mark)

    await exited(run)

    expect(run.exitCode).toBe(0)
    await expect(nothingLeft(mark)).resolves.toBeUndefined()
  })

  it.each(["SIGINT", "SIGTERM", "SIGKILL"] as const)(
    "after danwo matrix gets %s mid-run",
    async (signal) => {
      const mark = probe()
      const run = danwo(["matrix", "tests/buy-credits.danwo.ts"], mark)

      /* The CLI, a worker and the shop it started, at least, before the signal lands. */
      await running(mark, 3)
      if (run.pid !== undefined) process.kill(-run.pid, signal)
      await exited(run)

      await expect(nothingLeft(mark)).resolves.toBeUndefined()
    },
  )
})
