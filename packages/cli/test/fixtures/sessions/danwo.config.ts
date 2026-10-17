import { fileURLToPath } from "node:url"

import { defineConfig, s3Environment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  secrets: { password: { value: "pw-ada-fixture", purpose: "password" } },
  sessions: {
    /** Ada, signed in through the form once per worker. */
    ada: {
      async setup({ app, screen, expect, secret }) {
        await app.open("/login")
        await screen.getByLabel("Email").fill("ada@danwo.test")
        await screen.getByLabel("Password").fill(secret("password"))
        await screen.getByRole("button", { name: "Sign in" }).click()
        await expect(
          screen.getByRole("heading", { name: "Notes for ada@danwo.test" }),
        ).toBeVisible()
      },
      /** A kept sign-in still works when the notes page opens without bouncing to the form. */
      async check({ app, screen, expect }) {
        await app.open("/notes")
        await expect(screen.getByRole("heading", { name: /^Notes for/ })).toBeVisible({
          timeout: 2_000,
        })
      },
    },
  },
  async environment() {
    const port = await freePort()
    const s3 = await s3Environment({ seed: { buckets: [{ name: "danwo-notes" }] } })
    let app = await launchApp(APP, port, s3.proxy.env())

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: s3.proxy,
      fixtures: s3.fixtures,
      async reset() {
        app.kill()
        await s3.reset()
        app = await launchApp(APP, port, s3.proxy.env())
      },
      async close() {
        app.kill()
        await s3.close()
      },
    }
  },
})
