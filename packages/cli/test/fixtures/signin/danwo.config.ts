import { fileURLToPath } from "node:url"

import { defineConfig, googleEnvironment } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.mjs", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const google = await googleEnvironment({
      seed: {
        users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
        oauth_clients: [
          {
            client_id: "123-danwo.apps.googleusercontent.com",
            client_secret: "GOCSPX-danwo-fixture",
            name: "Danwo Fixture",
            redirect_uris: [`http://127.0.0.1:${port}/auth/google/callback`],
          },
        ],
      },
    })
    let app = await launchApp(APP, port, google.proxy.env())

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: google.proxy,
      fixtures: google.fixtures,
      async reset() {
        app.kill()
        await google.reset()
        app = await launchApp(APP, port, google.proxy.env())
      },
      async close() {
        app.kill()
        await google.close()
      },
    }
  },
})
