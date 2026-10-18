import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import {
  createEmulator,
  type Emulator,
  FLUTTERWAVE_HOSTS,
  flutterwave,
  seedFlutterwave,
} from "@danwo/emulators"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { startProxy } from "../src/proxy.ts"

const APP = fileURLToPath(new URL("./fixtures/flutterwave-app.ts", import.meta.url))
const SECRET_KEY = "REDACTED-TEST-VALUE"
const SECRET_HASH = "app-secret-hash"

const Created = z.object({ status: z.string(), data: z.object({ link: z.string() }) })
const Report = z.object({ credits: z.number(), rejectedHooks: z.number() })

/** Starts the app and resolves with its port once it listens. */
async function startApp(env: NodeJS.ProcessEnv): Promise<{ port: number; stop(): void }> {
  const app = spawn(process.execPath, [APP], {
    env: { ...env, FLW_SECRET_KEY: SECRET_KEY, FLW_SECRET_HASH: SECRET_HASH },
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: ["ignore", "pipe", "inherit"],
  })
  const lines = createInterface({ input: app.stdout })

  for await (const line of lines) {
    const port = /^ready (\d+)$/.exec(line)?.[1]

    if (port !== undefined) return { port: Number(port), stop: () => app.kill() }
  }

  throw new Error("the app stopped before it listened")
}

/** A customer paying a hosted link with the PIN test card; resolves with where it sends them. */
async function payByCard(emulator: Emulator, link: string): Promise<string> {
  const steps: [string, Record<string, string>][] = [
    ["card", { card_number: "5531886652142950", expiry: "09/32", cvv: "564" }],
    ["pin", { pin: "3310" }],
    ["otp", { otp: "12345" }],
  ]
  let location = ""

  for (const [step, fields] of steps) {
    const response = await emulator.fetch(
      new Request(`${link}/${step}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
        redirect: "manual",
      }),
    )

    location = response.headers.get("location") ?? ""
  }

  return location
}

describe("an unmodified app on Flutterwave Standard", () => {
  it("creates a link, verifies the payment by id, and credits once despite a forged webhook", async () => {
    const emulator = createEmulator(flutterwave)
    const proxy = await startProxy({
      routes: [{ hosts: [...FLUTTERWAVE_HOSTS], handler: emulator.fetch }],
      unmatched: "block",
    })
    const app = await startApp(proxy.env())
    const base = `http://127.0.0.1:${app.port}`

    seedFlutterwave(emulator.store, {
      webhook: { url: `${base}/webhook`, secretHash: SECRET_HASH },
    })

    try {
      const created = Created.parse(await (await fetch(`${base}/buy`)).json())

      expect(created.status).toBe("success")
      expect(created.data.link).toMatch(/^https:\/\/checkout\.flutterwave\.com\/v3\/hosted\/pay\//)

      emulator.webhooks?.setFault(() => ({ kind: "forged" }))

      const redirect = await payByCard(emulator, created.data.link)

      expect(new URL(redirect).searchParams.get("status")).toBe("successful")
      expect(await (await fetch(redirect)).json()).toEqual({ credited: true, credits: 500 })

      await emulator.webhooks?.idle()

      const report = Report.parse(await (await fetch(`${base}/report`)).json())

      expect(report).toEqual({ credits: 500, rejectedHooks: 1 })
      expect(
        proxy
          .exchanges()
          .map(
            (exchange) =>
              `${exchange.method} ${exchange.host}${exchange.path.replace(/\/\d+\//g, "/:id/")}`,
          ),
      ).toEqual([
        "POST api.flutterwave.com/v3/payments",
        "GET api.flutterwave.com/v3/transactions/:id/verify",
        "GET api.flutterwave.com/v3/transactions/:id/verify",
      ])
      expect(proxy.exchanges().every((exchange) => exchange.disposition === "routed")).toBe(true)
    } finally {
      app.stop()
      await proxy.stop()
      await emulator.close()
    }
  })
})
