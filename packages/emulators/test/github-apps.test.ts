import { createSign } from "node:crypto"

import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import { describe, expect, it } from "vitest"

import {
  githubAppKey,
  githubOutboundFaults,
  githubRepo,
  installGithubApp,
  seedGithub,
  uninstallGithubApp,
} from "../src/github/index.ts"
import { ManualClock } from "../src/time.ts"
import {
  ADA_TOKEN,
  BOT,
  capturing,
  delivered,
  githubWith,
  INSTALLATION_ID,
  octokitFor,
  payloadOf,
  refusal,
  SILENT,
} from "./github-api.ts"
import { fetchVia } from "./google-api.ts"

const widgets = { owner: "acme", repo: "widgets" }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** One failing annotation on `src/index.ts`. */
const annotation = (line: number) => ({
  path: "src/index.ts",
  start_line: line,
  end_line: line,
  annotation_level: "failure" as const,
  message: `line ${line}`,
})

/** The faults the matrix would plan for one call, as `kind status` labels. */
const kinds = (method: string, path: string) =>
  githubOutboundFaults({ method, path }).map((f) =>
    "status" in f ? `${f.kind} ${f.status}` : f.kind,
  )

/** Octokit authenticated as the bot app, or as one of its installations. */
function asBot(emulator: ReturnType<typeof githubWith>, installationId?: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: BOT.id,
      privateKey: githubAppKey(emulator, BOT.slug),
      ...(installationId && { installationId }),
    },
    request: { fetch: fetchVia(emulator) },
    log: SILENT,
  })
}

/** An app JWT with chosen claims, signed with the bot's key. */
function jwt(emulator: ReturnType<typeof githubWith>, claims: Record<string, unknown>): string {
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(githubAppKey(emulator, BOT.slug), "base64url")

  return `${unsigned}.${signature}`
}

describe("GitHub Apps", () => {
  it("authenticates as the app with a JWT and lists its installations", async () => {
    const emulator = githubWith()
    const bot = asBot(emulator)
    const { data: app } = await bot.rest.apps.getAuthenticated()

    expect(app).toMatchObject({ id: BOT.id, slug: BOT.slug, installations_count: 1 })
    expect((await bot.rest.apps.listInstallations()).data.map((i) => i.id)).toEqual([
      INSTALLATION_ID,
    ])
    expect((await bot.rest.apps.getRepoInstallation(widgets)).data.id).toBe(INSTALLATION_ID)
    expect(
      await refusal(bot.rest.apps.getRepoInstallation({ owner: "ada", repo: "notes" })),
    ).toMatchObject({ status: 404 })
  })

  it("checks the JWT: the issuer, the signature and its times", async () => {
    const emulator = githubWith()
    const now = Math.floor(Date.now() / 1000)
    const call = (token: string) =>
      refusal(octokitFor(emulator, token).rest.apps.getAuthenticated())

    expect(await call(jwt(emulator, { iss: 1, iat: now - 60, exp: now + 300 }))).toEqual({
      status: 401,
      message: "Integration not found",
    })
    expect((await call(jwt(emulator, { iss: BOT.id, iat: now - 60, exp: now - 1 }))).status).toBe(
      401,
    )
    expect(
      (await call(jwt(emulator, { iss: BOT.id, iat: now, exp: now + 3600 }))).message,
    ).toContain("too far in the future")
    expect(
      (
        await octokitFor(
          emulator,
          jwt(emulator, { iss: BOT.clientId, iat: now - 60, exp: now + 540 }),
        ).rest.apps.getAuthenticated()
      ).data?.slug,
    ).toBe(BOT.slug)
  })

  it("acts through an installation token only on the installation's repositories, with its permissions", async () => {
    const emulator = githubWith()
    const bot = asBot(emulator, INSTALLATION_ID)
    const { data: comment } = await bot.rest.issues.create({
      ...widgets,
      title: "Filed by the bot",
    })

    expect(comment.user?.login).toBe("danwo-bot[bot]")
    expect(comment.user?.type).toBe("Bot")
    expect(
      (await bot.rest.apps.listReposAccessibleToInstallation()).data.repositories.map(
        (r) => r.full_name,
      ),
    ).toEqual(["acme/widgets"])
    expect(
      await refusal(bot.rest.issues.create({ owner: "ada", repo: "notes", title: "x" })),
    ).toMatchObject({ status: 404 })
    expect(
      await refusal(
        bot.rest.repos.createOrUpdateFileContents({
          ...widgets,
          path: "x",
          message: "x",
          content: "eA==",
        }),
      ),
    ).toEqual({ status: 403, message: "Resource not accessible by integration" })
  })

  it("issues tokens limited to fewer repositories or permissions, and refuses more than granted", async () => {
    const emulator = githubWith()
    const bot = asBot(emulator)
    const { data: token } = await bot.rest.apps.createInstallationAccessToken({
      installation_id: INSTALLATION_ID,
      permissions: { issues: "read" },
    })

    expect(token.token).toMatch(/^ghs_/)
    expect(token.permissions).toEqual({ issues: "read" })
    expect(
      await refusal(
        octokitFor(emulator, token.token).rest.issues.create({ ...widgets, title: "x" }),
      ),
    ).toMatchObject({ status: 403 })
    expect(
      await refusal(
        bot.rest.apps.createInstallationAccessToken({
          installation_id: INSTALLATION_ID,
          permissions: { administration: "write" },
        }),
      ),
    ).toMatchObject({ status: 422 })
    expect(
      await refusal(
        bot.rest.apps.createInstallationAccessToken({
          installation_id: INSTALLATION_ID,
          repositories: ["notes"],
        }),
      ),
    ).toMatchObject({ status: 422 })
  })

  it("lets an installation token expire after an hour", async () => {
    const clock = new ManualClock(new Date())
    const emulator = githubWith({}, { clock: clock.clock })
    const { data: token } = await asBot(emulator).rest.apps.createInstallationAccessToken({
      installation_id: INSTALLATION_ID,
    })

    clock.advance(3601 * 1000)
    expect(
      await refusal(octokitFor(emulator, token.token).rest.issues.listForRepo(widgets)),
    ).toEqual({ status: 401, message: "Bad credentials" })
  })

  it("creates check runs with annotations, at most 50 per request, and completes them", async () => {
    const emulator = githubWith()
    const bot = asBot(emulator, INSTALLATION_ID)
    const head = (await bot.rest.repos.getBranch({ ...widgets, branch: "main" })).data.commit.sha
    const { data: run } = await bot.rest.checks.create({
      ...widgets,
      name: "danwo",
      head_sha: head,
      status: "in_progress",
      output: {
        title: "Running",
        summary: "…",
        annotations: Array.from({ length: 50 }, (_, n) => annotation(n + 1)),
      },
    })

    expect(
      await refusal(
        bot.rest.checks.update({
          ...widgets,
          check_run_id: run.id,
          output: {
            title: "x",
            summary: "x",
            annotations: Array.from({ length: 51 }, (_, n) => annotation(n + 1)),
          },
        }),
      ),
    ).toMatchObject({ status: 422 })

    const { data: done } = await bot.rest.checks.update({
      ...widgets,
      check_run_id: run.id,
      conclusion: "failure",
      output: { title: "1 failed", summary: "See annotations", annotations: [annotation(99)] },
    })

    expect(done).toMatchObject({
      status: "completed",
      conclusion: "failure",
      output: { title: "1 failed", annotations_count: 51 },
    })
    expect((await bot.rest.checks.listForRef({ ...widgets, ref: "main" })).data.total_count).toBe(1)
    expect(githubRepo(emulator, "acme/widgets").checkRuns(head)[0]?.annotations).toHaveLength(51)
    expect(
      await refusal(
        octokitFor(emulator, ADA_TOKEN).rest.checks.create({
          ...widgets,
          name: "x",
          head_sha: head,
        }),
      ),
    ).toEqual({ status: 403, message: "You must authenticate via a GitHub App." })
  })

  it("sends installation webhooks when the app is installed and removed", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)

    seedGithub(emulator.store, { users: [{ login: "cy" }], repos: [{ repo: "cy/site" }] })

    const id = installGithubApp(emulator, { app: BOT.slug, account: "cy" })

    uninstallGithubApp(emulator, id)
    await delivered(emulator, 2)

    const bodies = deliveries.map((d) => payloadOf(d))

    expect(deliveries.map((d) => d.headers["x-github-event"])).toEqual([
      "installation",
      "installation",
    ])
    expect(bodies.map((b) => b.action)).toEqual(["created", "deleted"])
    expect(bodies[0]).toMatchObject({ repositories: [{ full_name: "cy/site" }] })
  })

  it("lists the faults an app's calls can meet", () => {
    expect(kinds("GET", "/repos/acme/widgets/issues")).toEqual([
      "status 403",
      "status 429",
      "status 502",
      "status 503",
      "delay",
      "reset",
    ])
    expect(kinds("PUT", "/repos/acme/widgets/contents/a.txt")).toContain("status 409")
    expect(kinds("POST", "/login/oauth/access_token")).toEqual([
      "status 200",
      "status 502",
      "delay",
      "reset",
      "reset-after",
    ])
    expect(kinds("GET", "/login/oauth/authorize")).toEqual([])
  })
})
