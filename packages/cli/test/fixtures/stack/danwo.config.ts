import { fileURLToPath } from "node:url"

import { defineConfig, inngestService, stackEnvironment, stripeService } from "@danwo/sdk"

import { freePort } from "../app-process.ts"

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))
const local = (port: number) => `http://127.0.0.1:${port}`

/**
 * A frontend, an API and a background worker with an Inngest dev server between them, all behind
 * one proxy with Stripe emulated and every other outside host blocked. The API's start command
 * sets NODE_OPTIONS itself; `STACK_NO_SHIM=1` turns danwo's node shim off to show what that loses.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    const [web, api, worker, dev] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ])
    const inngest = await inngestService({ url: local(dev) })

    return stackEnvironment({
      unmatched: "block",
      nodeShim: process.env.STACK_NO_SHIM !== "1",
      services: [stripeService(), inngest],
      apps: [
        {
          name: "web",
          command: `node "${here("./web.ts")}"`,
          url: local(web),
          dependsOn: ["api"],
          env: (urls) => ({ VITE_API_URL: urls.api ?? "" }),
        },
        {
          name: "api",
          command: `NODE_OPTIONS=--max-old-space-size=256 node "${here("./api.ts")}"`,
          url: local(api),
          dependsOn: ["inngest"],
          env: { ...inngest.env, STRIPE_SECRET_KEY: "REDACTED-TEST-VALUE" },
        },
        {
          name: "worker",
          command: `node "${here("./worker.ts")}"`,
          url: local(worker),
          ready: { log: "worker ready" },
        },
        {
          name: "inngest",
          command: `node "${here("./inngest-dev.ts")}"`,
          url: local(dev),
          dependsOn: ["worker"],
          env: (urls) => ({ WORKER_URL: urls.worker ?? "" }),
        },
      ],
    })
  },
})
