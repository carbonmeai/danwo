import { execFile, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { s3Objects } from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"
import { describe, expect, it } from "vitest"

import { awsEnvironment, awsService } from "../src/runner/aws.ts"
import { s3Service } from "../src/runner/s3.ts"
import { startServices } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"

const run = promisify(execFile)
const APP = fileURLToPath(new URL("./fixtures/aws-app.mjs", import.meta.url))

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 })

    return true
  } catch {
    return false
  }
}

interface AppOutput {
  object?: string
  keys?: string[]
  message?: string
  s3Error?: string
  sqsError?: string
}

async function runApp(proxy: Proxy, env: NodeJS.ProcessEnv = {}): Promise<AppOutput> {
  const { stdout } = await run(process.execPath, [APP], {
    env: proxy.env({
      ...process.env,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_REGION: "us-east-1",
      ...env,
    }),
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    timeout: 60_000,
  })

  return JSON.parse(stdout) as AppOutput
}

describe.skipIf(!dockerAvailable())("MiniStack behind the proxy", () => {
  it("serves an unmodified app's S3 and SQS calls, and resets between runs", async () => {
    const aws = await awsEnvironment({ docker: true, unmatched: "block" })

    try {
      const first = await runApp(aws.proxy, { APP_CREATE_BUCKET: "1" })

      expect(first).toEqual({ object: "hello", keys: ["reports/a.txt"], message: "job-1" })
      await aws.proxy.settled()
      const hosts = new Set(aws.proxy.exchanges().map((e) => `${e.disposition} ${e.host}`))

      expect([...hosts].toSorted()).toEqual([
        "routed danwo-app.s3.us-east-1.amazonaws.com",
        "routed sqs.us-east-1.amazonaws.com",
      ])

      // After a reset the bucket is gone, so the app's put fails.
      await aws.reset()
      const second = await runApp(aws.proxy)

      expect(second.s3Error).toMatch(/NoSuchBucket/)
      expect(aws.proxy.exchanges().every((e) => e.disposition === "routed")).toBe(true)
    } finally {
      await aws.close()
    }
  }, 120_000)

  it("mixes emulators and MiniStack behind one proxy", async () => {
    const s3 = s3Service({ seed: { buckets: [{ name: "danwo-app" }] } })
    const services = await startServices(
      [stripeService(), s3, await awsService({ docker: true })],
      { unmatched: "block" },
    )

    try {
      const out = await runApp(services.proxy)

      /*
       * S3 is answered by the in-process emulator (the more specific `*.s3.us-east-1.amazonaws.com`
       * route wins over `*.amazonaws.com`), SQS by MiniStack.
       */
      expect(out).toEqual({ object: "hello", keys: ["reports/a.txt"], message: "job-1" })
      expect(services.fixtures).toHaveProperty("stripe")
      expect(services.fixtures).toHaveProperty("aws")
      expect(
        s3Objects(s3.emulator)
          .list("danwo-app")
          .map((o) => o.key),
      ).toEqual(["reports/a.txt"])
      expect(services.webhooks).toBeDefined() // Stripe's, the only dispatcher
    } finally {
      await services.close()
    }
  }, 120_000)
})
