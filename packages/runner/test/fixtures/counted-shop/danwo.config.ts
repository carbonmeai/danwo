/**
 * The shop example's config, with every reset, snapshot and restore of its environment written
 * to the file `DANWO_COUNT_FILE` names, one line per call with the worker's index.
 */
import { appendFileSync } from "node:fs"

import shop from "../../../../../examples/shop/danwo.config.ts"
import { defineConfig } from "../../../src/runner/config.ts"
import type { WorkerEnvironment } from "../../../src/runner/environment.ts"

function count(call: string, workerIndex: number): void {
  const file = process.env.DANWO_COUNT_FILE

  if (file) appendFileSync(file, `${call} ${workerIndex}\n`)
}

/** The shop's environment with its starting-point calls counted; everything else as it is. */
function counted(env: WorkerEnvironment, workerIndex: number): WorkerEnvironment {
  const counting = (call: "reset" | "snapshot" | "restore") => async () => {
    count(call, workerIndex)
    await env[call]?.()
  }

  if (env.proxy === undefined) throw new Error("the shop's environment has no proxy")

  return {
    get baseUrl() {
      return env.baseUrl
    },
    proxy: env.proxy,
    webhooks: env.webhooks,
    fixtures: env.fixtures ?? {},
    settle: async () => env.settle?.(),
    reset: counting("reset"),
    snapshot: counting("snapshot"),
    restore: counting("restore"),
    close: () => env.close(),
  }
}

export default defineConfig({
  ...shop,
  testDir: "../../../../../examples/shop/tests",
  async environment(context) {
    const env = await shop.environment?.(context)

    if (env === undefined) throw new Error("the shop config has no environment")

    return counted(env, context.workerIndex)
  },
})
