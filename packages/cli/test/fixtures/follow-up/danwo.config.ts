import { fileURLToPath } from "node:url"

import {
  defineConfig,
  nangoService,
  nylasService,
  stackEnvironment,
  unipileService,
} from "@danwo/sdk"

import { freePort } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const GRANT = "11111111-1111-4111-8111-111111111111"

/**
 * The follow-up app with Nylas, Nango and Unipile emulated behind one proxy and every other
 * outside host blocked; the app's SDKs reach the emulators with no change to its code.
 */
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()

    return stackEnvironment({
      unmatched: "block",
      services: [
        nylasService({
          seed: {
            apiKeys: ["REDACTED-TEST-VALUE"],
            grants: [
              {
                id: GRANT,
                email: "rep@sales.test",
                messages: [{ from: "lead@prospect.test", subject: "Pricing?", body: "How much?" }],
              },
            ],
          },
        }),
        nangoService({
          seed: {
            secretKeys: ["follow-up-nango-secret"],
            integrations: [{ key: "hubspot", provider: "hubspot" }],
            connections: [{ integration: "hubspot", connectionId: "rep-1" }],
            proxy: [
              {
                integration: "hubspot",
                method: "POST",
                path: "/crm/v3/objects/notes",
                body: { id: "note-1" },
              },
            ],
          },
        }),
        unipileService({
          seed: {
            tokens: ["follow-up-unipile-token"],
            accounts: [{ id: "acc_rep", type: "LINKEDIN", name: "Rep", username: "rep" }],
          },
        }),
      ],
      apps: [
        {
          name: "app",
          command: `node "${APP}"`,
          url: `http://127.0.0.1:${port}`,
          env: {
            PORT: String(port),
            NYLAS_API_KEY: "REDACTED-TEST-VALUE",
            NYLAS_GRANT_ID: GRANT,
            NANGO_SECRET_KEY: "follow-up-nango-secret",
            UNIPILE_DSN: "api8.unipile.com:13851",
            UNIPILE_ACCESS_TOKEN: "follow-up-unipile-token",
            UNIPILE_ACCOUNT_ID: "acc_rep",
            ...(process.env.FOLLOW_UP_BUG && { FOLLOW_UP_BUG: process.env.FOLLOW_UP_BUG }),
          },
        },
      ],
    })
  },
})
