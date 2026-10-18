import { fileURLToPath } from "node:url"

import { defineConfig, flutterwaveEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const SECRET_KEY = "REDACTED-TEST-VALUE"
const SECRET_HASH = "flutterwave-shop-hash"

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const flutterwave = await flutterwaveEnvironment({
      seed: { webhook: { url: `http://127.0.0.1:${port}/webhook`, secretHash: SECRET_HASH } },
    })

    const start = () =>
      launchApp(APP, port, {
        ...flutterwave.proxy.env(),
        FLW_SECRET_KEY: SECRET_KEY,
        FLW_SECRET_HASH: SECRET_HASH,
        ...(process.env.FLW_BUG && { FLW_BUG: process.env.FLW_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: flutterwave.proxy,
      webhooks: flutterwave.webhooks,
      fixtures: flutterwave.fixtures,
      settle: flutterwave.settle,
      async reset() {
        app.kill()
        await flutterwave.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await flutterwave.close()
      },
    }
  },
})
