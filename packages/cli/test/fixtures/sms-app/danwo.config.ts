import { fileURLToPath } from "node:url"

import { defineConfig, twilioEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const ACCOUNT = "REDACTED-TEST-VALUE"
const TOKEN = "7e57ab1e7e57ab1e7e57ab1e7e57ab1e"
const SERVICE = "REDACTED-TEST-VALUE"
const FROM = "+15005550006"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const twilio = await twilioEnvironment({
      seed: {
        accounts: [{ sid: ACCOUNT, authToken: TOKEN }],
        numbers: [{ number: FROM }],
        verifyServices: [{ sid: SERVICE, friendlyName: "Sms App" }],
      },
    })

    const start = () =>
      launchApp(APP, port, {
        ...twilio.proxy.env(),
        TWILIO_ACCOUNT_SID: ACCOUNT,
        TWILIO_AUTH_TOKEN: TOKEN,
        VERIFY_SERVICE: SERVICE,
        FROM_NUMBER: FROM,
        ...(process.env.SMS_BUG && { SMS_BUG: process.env.SMS_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: twilio.proxy,
      webhooks: twilio.webhooks,
      fixtures: twilio.fixtures,
      settle: twilio.settle,
      async reset() {
        app.kill()
        await twilio.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await twilio.close()
      },
    }
  },
})
