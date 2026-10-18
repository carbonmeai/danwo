import { fileURLToPath } from "node:url"

import { defineConfig, stripeEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

/** The lamp shop, behind a proxy so `danwo matrix` can run it; it calls no provider. */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const services = await stripeEnvironment()
    const start = () => launchApp(APP, port, { ...process.env, ...services.proxy.env() })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: services.proxy,
      async reset() {
        app.kill()
        app = await start()
      },
      async close() {
        app.kill()
        await services.close()
      },
    }
  },
})
