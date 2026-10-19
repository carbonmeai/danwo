import { createHmac } from "node:crypto"
import { fileURLToPath } from "node:url"

import {
  defineConfig,
  novuService,
  PUSHER_DEFAULTS,
  pusherService,
  stackEnvironment,
  tiptapService,
} from "@danwo/sdk"

import { freePort } from "../app-process.ts"

const COLLAB_SECRET = "collab-secret"
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** The collaboration token the app's server would mint for the editor. */
function collabToken(): string {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ allowedDocumentNames: ["order-*"] })}`

  return `${body}.${createHmac("sha256", COLLAB_SECRET).update(body).digest("base64url")}`
}

/**
 * An orders app on Pusher, Novu and Tiptap Cloud, all three emulated behind one proxy with every
 * other outside host blocked: the app's server calls Pusher's and Novu's APIs, and the browser
 * keeps Pusher's and Tiptap's sockets open, with no change to the app.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    const port = await freePort()
    const { app } = PUSHER_DEFAULTS

    return stackEnvironment({
      unmatched: "block",
      services: [
        pusherService(),
        novuService({
          seed: {
            apiKey: "novu-secret",
            workflows: [
              {
                workflowId: "order-placed",
                steps: [
                  { stepId: "bell", type: "in_app", body: "Order {{payload.id}} is on its way" },
                ],
              },
            ],
          },
        }),
        tiptapService({ seed: { apps: [{ id: "orders", secret: COLLAB_SECRET }] } }),
      ],
      apps: [
        {
          name: "orders",
          command: `node "${fileURLToPath(new URL("./app.ts", import.meta.url))}"`,
          url: `http://127.0.0.1:${port}`,
          env: {
            PUSHER_APP_ID: app.id,
            PUSHER_KEY: app.key,
            PUSHER_SECRET: app.secret,
            PUSHER_CLUSTER: app.cluster,
            NOVU_API_KEY: "novu-secret",
            TIPTAP_APP_ID: "orders",
            TIPTAP_TOKEN: collabToken(),
          },
        },
      ],
    })
  },
})
