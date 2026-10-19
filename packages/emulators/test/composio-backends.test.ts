import type { Composio } from "@composio/core"
import { afterEach, describe, expect, it } from "vitest"

import { composioProject, connectComposioBackends } from "../src/composio/index.ts"
import { createEmulator, type Emulator } from "../src/define.ts"
import { github, githubRepo } from "../src/github/index.ts"
import { GITHUB_HOSTS } from "../src/github/index.ts"
import { seedGithub } from "../src/github/seed.ts"
import {
  GOOGLE_HOSTS,
  gmailMailbox,
  google,
  revokeGoogleAccess,
  seedGoogle,
} from "../src/google/index.ts"
import {
  MICROSOFT_HOSTS,
  microsoft,
  outlookMailbox,
  seedMicrosoft,
} from "../src/microsoft/index.ts"
import { seedSlack, SLACK_HOSTS, slack, slackWorkspace } from "../src/slack/index.ts"
import {
  composioWith,
  follow,
  type Router,
  router,
  schemaWarnings,
  sdk,
} from "./composio-client.ts"

const APP_CALLBACK = "https://app.danwo.test/composio/callback"

/** Every backend's hosts and Composio's, each answered by its emulator. */
function routes(
  emulators: Readonly<Record<string, readonly [Emulator, readonly string[]]>>,
): Router {
  return router(
    Object.fromEntries(
      Object.values(emulators).flatMap(([emulator, hosts]) =>
        hosts.map((host) => [host, emulator]),
      ),
    ),
  )
}

/** Picks `email`'s account on a backend's account chooser and posts the choice. */
function choose(email: string) {
  return (page: string) => {
    const action = /<form method="post" action="([^"]+)"/.exec(page)?.[1]
    const request = /name="request" value="([^"]+)"/.exec(page)?.[1]
    const account = page.split("<li>").find((item) => item.includes(email))
    const user = account && /name="user" value="([^"]+)"/.exec(account)?.[1]

    return action && request && user
      ? { action: action.replaceAll("&amp;", "&"), form: { request, user } }
      : undefined
  }
}

let restore = () => undefined as void

afterEach(() => restore())

/** Connects `userId` to `toolkit` on Composio, signing in as `email` on the backend's chooser. */
async function connect(
  client: Composio,
  route: Router,
  toolkit: string,
  email: string,
): Promise<string> {
  const config = await client.authConfigs.create(toolkit, { type: "use_composio_managed_auth" })
  const request = await client.connectedAccounts.link("ada", config.id, {
    callbackUrl: APP_CALLBACK,
  })
  const back = new URL(await follow(route, request.redirectUrl ?? "", choose(email)))

  expect(back.searchParams.get("status")).toBe("success")
  expect((await request.waitForConnection(2_000)).status).toBe("ACTIVE")

  return request.id
}

function start(backends: Readonly<Record<string, readonly [Emulator, readonly string[]]>>) {
  const composio = composioWith()
  const route = routes({
    ...backends,
    composio: [composio, ["backend.composio.dev", "connect.composio.dev"]],
  })
  const warnings: string[] = []
  const started = sdk(route, warnings)

  restore = () => started.restore()
  connectComposioBackends(
    composio,
    Object.fromEntries(Object.entries(backends).map(([name, [emulator]]) => [name, emulator])),
  )

  return { composio, route, client: started.client, warnings }
}

describe("Composio on the Google emulator", () => {
  it("signs in on Google's chooser, and GMAIL_SEND_EMAIL lands in the user's Gmail", async () => {
    const gmail = createEmulator(google)

    seedGoogle(gmail.store, { users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }] })

    const { composio, route, client, warnings } = start({ google: [gmail, GOOGLE_HOSTS] })

    await connect(client, route, "gmail", "ada@danwo.test")

    const sent = await client.tools.execute("GMAIL_SEND_EMAIL", {
      userId: "ada",
      arguments: { recipient_email: "bob@danwo.test", subject: "Lunch", body: "Noon?" },
      dangerouslySkipVersionCheck: true,
    })

    expect(sent).toMatchObject({
      successful: true,
      data: { labelIds: expect.arrayContaining(["SENT"]) },
    })
    expect(gmailMailbox(gmail, "ada@danwo.test").sent()).toMatchObject([
      { subject: "Lunch", to: "bob@danwo.test" },
    ])
    expect(composioProject(composio).accounts()).toMatchObject([{ label: "ada@danwo.test" }])
    expect(composioProject(composio).executions()).toMatchObject([{ source: "backend" }])

    const fetched = await client.tools.execute("GMAIL_FETCH_EMAILS", {
      userId: "ada",
      arguments: { max_results: 5 },
      dangerouslySkipVersionCheck: true,
    })

    expect(fetched.data).toMatchObject({ messages: [{ subject: "Lunch", messageText: "Noon?" }] })
    expect(schemaWarnings(warnings)).toEqual([])
  })

  it("expires the account when Google revokes the grant, and sends the expiry webhook", async () => {
    const gmail = createEmulator(google)

    seedGoogle(gmail.store, { users: [{ email: "ada@danwo.test", name: "Ada Lovelace" }] })

    const { composio, route, client } = start({ google: [gmail, GOOGLE_HOSTS] })
    const accountId = await connect(client, route, "gmail", "ada@danwo.test")

    revokeGoogleAccess(gmail, "ada@danwo.test")

    const failed = await client.tools.execute("GMAIL_SEND_EMAIL", {
      userId: "ada",
      arguments: { recipient_email: "bob@danwo.test", subject: "Lunch", body: "Noon?" },
      dangerouslySkipVersionCheck: true,
    })

    expect(failed).toMatchObject({ successful: false, error: expect.stringContaining("401") })
    expect((await client.connectedAccounts.get(accountId)).status).toBe("EXPIRED")
    expect(composio.outbox.all().map((message) => message.topic)).toEqual([
      "composio.connected_account.expired",
    ])
  })
})

describe("Composio on the Slack, GitHub and Microsoft emulators", () => {
  it("posts SLACK_SEND_MESSAGE into the Slack workspace", async () => {
    const workspace = createEmulator(slack)

    seedSlack(workspace.store, {
      team: { name: "Danwo" },
      users: [{ name: "ada", email: "ada@danwo.test" }],
    })

    const { route, client } = start({ slack: [workspace, SLACK_HOSTS] })

    await connect(client, route, "slack", "ada@danwo.test")

    const posted = await client.tools.execute("SLACK_SEND_MESSAGE", {
      userId: "ada",
      arguments: { channel: "general", text: "Deploy done" },
      dangerouslySkipVersionCheck: true,
    })

    expect(posted).toMatchObject({ successful: true, data: { ok: true } })
    expect(slackWorkspace(workspace).messages("general")).toMatchObject([{ text: "Deploy done" }])
  })

  it("opens GITHUB_CREATE_AN_ISSUE in the GitHub repository", async () => {
    const hub = createEmulator(github)

    seedGithub(hub.store, {
      users: [{ login: "ada", emails: ["ada@danwo.test"], name: "Ada Lovelace" }],
      repos: [{ repo: "ada/app" }],
    })

    const { route, client } = start({ github: [hub, GITHUB_HOSTS] })

    await connect(client, route, "github", "ada")

    const opened = await client.tools.execute("GITHUB_CREATE_AN_ISSUE", {
      userId: "ada",
      arguments: { owner: "ada", repo: "app", title: "Broken build" },
      dangerouslySkipVersionCheck: true,
    })

    expect(opened).toMatchObject({
      successful: true,
      data: { title: "Broken build", state: "open" },
    })
    expect(githubRepo(hub, "ada/app").issues()).toMatchObject([
      { title: "Broken build", author: "ada" },
    ])
  })

  it("sends OUTLOOK_SEND_EMAIL from the Outlook mailbox", async () => {
    const graph = createEmulator(microsoft)

    seedMicrosoft(graph, { users: [{ email: "ada@contoso.test", name: "Ada Lovelace" }] })

    const { route, client } = start({ microsoft: [graph, MICROSOFT_HOSTS] })

    await connect(client, route, "outlook", "ada@contoso.test")

    const sent = await client.tools.execute("OUTLOOK_SEND_EMAIL", {
      userId: "ada",
      arguments: { to_email: "bob@contoso.test", subject: "Notes", body: "Attached" },
      dangerouslySkipVersionCheck: true,
    })

    expect(sent).toMatchObject({ successful: true })
    expect(outlookMailbox(graph, "ada@contoso.test").messages("sentitems")).toMatchObject([
      { subject: "Notes", to: ["bob@contoso.test"] },
    ])
  })
})
