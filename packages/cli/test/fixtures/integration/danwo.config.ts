import { fileURLToPath } from "node:url"

import { defineConfig, type Emulator, googleEnvironment, z } from "@danwo/sdk"

import { freePort, launchApp } from "../app-process.ts"

const APP = fileURLToPath(new URL("./app.ts", import.meta.url))
const REDIRECT = "https://app.danwo.test/oauth/callback"
const CLIENT = {
  client_id: "123-integration.apps.googleusercontent.com",
  client_secret: "GOCSPX-integration-fixture",
  name: "Inbox Sync",
  redirect_uris: [REDIRECT],
}
const TOPIC = "projects/inbox-sync/topics/gmail"

/** Ada picking her account on Google's chooser for the app; the code it redirects back with. */
async function chooseAda(google: Emulator): Promise<string> {
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth")

  authorize.search = new URLSearchParams({
    client_id: CLIENT.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.modify",
  }).toString()

  const chooser = await (await google.fetch(new Request(authorize))).text()
  // The chooser's hidden request id, then the first account's button: Ada is the only one.
  const fields = [...chooser.matchAll(/name="(request|user)" value="([^"]+)"/g)].map((m) => [
    String(m[1]),
    String(m[2]),
  ])
  const back = await google.fetch(
    new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  )

  return String(new URL(String(back.headers.get("location"))).searchParams.get("code"))
}

/** Ada consenting to the app reading and sending her mail, as the app's OAuth flow would. */
async function grantGmail(google: Emulator): Promise<string> {
  const token = await google.fetch(
    new Request("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: await chooseAda(google),
        redirect_uri: REDIRECT,
        client_id: CLIENT.client_id,
        client_secret: CLIENT.client_secret,
      }),
    }),
  )
  const { access_token: accessToken } = z
    .object({ access_token: z.string() })
    .parse(await token.json())

  return accessToken
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const port = await freePort()
    const google = await googleEnvironment({
      seed: {
        users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }],
        oauth_clients: [CLIENT],
        pubsub: [
          {
            subscription: "projects/inbox-sync/subscriptions/gmail-push",
            topic: TOPIC,
            endpoint: `http://127.0.0.1:${port}/push`,
          },
        ],
      },
    })

    const start = async () =>
      launchApp(APP, port, {
        ...google.proxy.env(),
        PUSH_TOPIC: TOPIC,
        ACCESS_TOKEN: await grantGmail(google.emulator),
        ...(process.env.INTEGRATION_BUG && { INTEGRATION_BUG: process.env.INTEGRATION_BUG }),
      })

    let app = await start()

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      proxy: google.proxy,
      webhooks: google.webhooks,
      fixtures: google.fixtures,
      settle: google.settle,
      async reset() {
        app.kill()
        await google.reset()
        app = await start()
      },
      async close() {
        app.kill()
        await google.close()
      },
    }
  },
})
