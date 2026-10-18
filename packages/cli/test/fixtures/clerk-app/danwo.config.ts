import { fileURLToPath } from "node:url"

import { clerkEnvironment, clerkInstance, clerkMail, defineConfig } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const clerk = await clerkEnvironment({
      seed: {
        // CLERK_SIGN_IN=code signs in by emailed code instead of a password.
        instance: { password: process.env.CLERK_SIGN_IN !== "code" },
        users: [{ email: "ada@danwo.test", password: "s3cret-pass", firstName: "Ada" }],
      },
    })
    const { publishableKey, secretKey } = clerkInstance(clerk.emulator).instance

    const start = () =>
      launchApp(APP, port, {
        ...clerk.proxy.env(),
        CLERK_PUBLISHABLE_KEY: publishableKey,
        CLERK_SECRET_KEY: secretKey,
        ...(process.env.CLERK_BUG && { CLERK_BUG: process.env.CLERK_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: clerk.proxy,
      mail: [clerkMail(clerk.emulator)],
      webhooks: clerk.webhooks,
      fixtures: clerk.fixtures,
      settle: clerk.settle,
      async reset() {
        app.kill()
        await clerk.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await clerk.close()
      },
    }
  },
})
