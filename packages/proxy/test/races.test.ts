import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"
import { z } from "zod"

import { startProxy } from "../src/index.ts"

const run = promisify(execFile)
const RETRY_APP = fileURLToPath(new URL("./fixtures/retry-app.ts", import.meta.url))
const Tries = z.object({ first: z.union([z.number(), z.string()]), second: z.number() })

describe("slow-then-retry", () => {
  it("holds a call until its client gives up, then still processes it, so the retry races it", async () => {
    const processed: number[] = []
    const proxy = await startProxy({
      routes: [
        {
          hosts: ["pay.danwo.test"],
          handler: async () => {
            processed.push(Date.now())

            return new Response(JSON.stringify({ charge: processed.length }), { status: 201 })
          },
        },
      ],
      unmatched: "block",
    })

    try {
      let calls = 0

      proxy.setFault(() => (calls++ === 0 ? { kind: "slow-then-retry", ms: 5_000 } : undefined))

      const began = Date.now()
      const { stdout } = await run(
        process.execPath,
        [RETRY_APP, "https://pay.danwo.test/charges", "300"],
        { env: proxy.env() },
      )
      const tries = Tries.parse(JSON.parse(stdout))

      await proxy.settled()

      const [held, retry] = proxy.exchanges()

      expect(tries).toEqual({ first: "TimeoutError", second: 201 })
      // Both the abandoned call and its retry reached the provider: two charges, not one.
      expect(processed).toHaveLength(2)
      expect(Date.now() - began).toBeLessThan(5_000)
      expect(held).toMatchObject({
        fault: "slow-then-retry 5000ms",
        aborted: true,
        client: "server",
      })
      expect(retry).toMatchObject({ fault: null, status: 201 })
    } finally {
      await proxy.stop()
    }
  }, 30_000)
})
