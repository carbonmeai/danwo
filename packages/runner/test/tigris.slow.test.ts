import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { s3Objects } from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { s3Environment } from "../src/runner/s3.ts"

const run = promisify(execFile)
const APP = fileURLToPath(new URL("./fixtures/tigris-app.ts", import.meta.url))

const AppOutput = z.object({
  read: z.string().optional(),
  keys: z.array(z.string()).optional(),
  viaUrl: z.string(),
  errors: z.array(z.string()),
})

describe("an app on the Tigris SDK behind the proxy", () => {
  it("reaches the S3 emulator on Tigris's hosts with the variables s3Environment hands it", async () => {
    const s3 = await s3Environment({
      seed: {
        buckets: [{ name: "danwo-reports" }],
        credentials: [{ accessKeyId: "tid_reports", secretAccessKey: "tsec_reports" }],
      },
      unmatched: "block",
    })

    try {
      const { stdout } = await run(process.execPath, [APP], {
        env: s3.proxy.env({ ...process.env, ...s3.env() }),
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        timeout: 60_000,
      })
      const out = AppOutput.parse(JSON.parse(stdout))

      expect(out).toEqual({
        read: "hello tigris",
        keys: ["reports/a.txt", "reports/c.txt"],
        viaUrl: "hello tigris",
        errors: [],
      })
      expect(
        s3Objects(s3.emulator)
          .list("danwo-reports")
          .map((object) => object.key),
      ).toEqual(["reports/a.txt"])

      await s3.proxy.settled()

      const hosts = new Set(s3.proxy.exchanges().map((e) => `${e.disposition} ${e.host}`))

      expect([...hosts].toSorted()).toEqual([
        "routed danwo-reports.t3.storage.dev",
        "routed t3.storage.dev",
      ])
    } finally {
      await s3.close()
    }
  }, 120_000)
})
