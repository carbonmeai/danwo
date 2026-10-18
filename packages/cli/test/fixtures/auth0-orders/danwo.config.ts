import { fileURLToPath } from "node:url"

import { auth0Environment, defineConfig } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const auth0 = await auth0Environment({
      seed: {
        tenants: [
          {
            domain: "acme.us.auth0.com",
            friendly_name: "Acme",
            clients: [
              {
                client_id: "orders-web",
                client_secret: "orders-web-secret",
                name: "Acme Orders",
                callbacks: [`http://127.0.0.1:${port}/callback`],
              },
            ],
            apis: [{ identifier: "https://api.orders.test", scopes: ["read:orders"] }],
            users: [
              {
                email: "ada@orders.test",
                password: "Analytical-1",
                name: "Ada",
                email_verified: true,
              },
            ],
          },
        ],
      },
    })
    const env = () => ({
      ...auth0.proxy.env(),
      ...(process.env.AUTH0_BUG && { AUTH0_BUG: process.env.AUTH0_BUG }),
    })
    let app = await launchApp(APP, port, env())

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: auth0.proxy,
      fixtures: auth0.fixtures,
      async reset() {
        app.kill()
        await auth0.reset()
        app = await launchApp(APP, port, env())
      },
      async close() {
        app.kill()
        await auth0.close()
      },
    }
  },
})
