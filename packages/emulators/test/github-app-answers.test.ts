import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import { describe, expect, it } from "vitest"

import { githubAppKey } from "../src/github/index.ts"
import {
  base64,
  BOT,
  githubWith,
  INSTALLATION_ID,
  octokitFor,
  refusal,
  SILENT,
} from "./github-api.ts"
import { fetchVia } from "./google-api.ts"

/**
 * What GitHub answers to an App acting on a repository it is installed on, as a live run against
 * the real API recorded it: repositories shown in full, in lists and nested; comments with the App
 * they were made through; signed commits from the contents API; issues closed by someone; pull
 * requests before and after GitHub has worked out whether they merge.
 */

const WRITER = { id: 515_151, slug: "danwo-writer", installation: 616_161 }
const widgets = { owner: "acme", repo: "widgets" }

/** An emulator where a second App may write contents on acme/widgets. */
function withWriter() {
  return githubWith({
    apps: [
      {
        id: WRITER.id,
        slug: WRITER.slug,
        name: "Danwo Writer",
        description: "Writes files",
        owner: "acme",
        clientId: "Iv23liDanwoWriter0001",
        clientSecret: "writer-secret-0123456789",
        permissions: { contents: "write", issues: "write", pull_requests: "write" },
      },
    ],
    installations: [
      { id: WRITER.installation, app: WRITER.slug, account: "acme", repositories: ["widgets"] },
    ],
  })
}

/** Octokit as an App itself, signing its JWTs with the App's key. */
function asApp(
  emulator: ReturnType<typeof githubWith>,
  app: { readonly id: number; readonly slug: string },
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: app.id, privateKey: githubAppKey(emulator, app.slug) },
    request: { fetch: fetchVia(emulator) },
    log: SILENT,
  })
}

/** Octokit as an App's installation. */
function installation(
  emulator: ReturnType<typeof githubWith>,
  app: { readonly id: number; readonly slug: string },
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: app.id, privateKey: githubAppKey(emulator, app.slug), installationId },
    request: { fetch: fetchVia(emulator) },
    log: SILENT,
  })
}

describe("an App's answers", () => {
  it("shows a repository in full with its organisation and merge settings, and less in lists and tokens", async () => {
    const emulator = withWriter()
    const writer = installation(emulator, WRITER, WRITER.installation)
    const { data: full } = await writer.rest.repos.get(widgets)
    const { data: listed } = await writer.rest.apps.listReposAccessibleToInstallation()
    const { data: anonymous } = await octokitFor(emulator).rest.repos.get(widgets)

    expect(full).toMatchObject({
      organization: { login: "acme" },
      custom_properties: {},
      temp_clone_token: expect.any(String),
      allow_squash_merge: true,
      network_count: 0,
    })
    expect(listed.repositories[0]).toHaveProperty("permissions")
    expect(listed.repositories[0]).not.toHaveProperty("network_count")
    expect(listed.repositories[0]).not.toHaveProperty("organization")
    expect(anonymous).not.toHaveProperty("permissions")
    expect(anonymous).not.toHaveProperty("allow_squash_merge")

    const { data: token } = await asApp(emulator, WRITER).rest.apps.createInstallationAccessToken({
      installation_id: WRITER.installation,
      repositories: ["widgets"],
    })

    expect(token.repositories?.[0]).not.toHaveProperty("permissions")
    expect(token.repositories?.[0]).not.toHaveProperty("custom_properties")
  })

  it("shows the App a comment was made through, and who closed an issue", async () => {
    const emulator = githubWith()
    const bot = installation(emulator, BOT, INSTALLATION_ID)
    const { data: issue } = await bot.rest.issues.create({ ...widgets, title: "Bot issue" })
    const { data: created } = await bot.rest.issues.createComment({
      ...widgets,
      issue_number: issue.number,
      body: "hello",
    })
    const { data: edited } = await bot.rest.issues.updateComment({
      ...widgets,
      comment_id: created.id,
      body: "edited",
    })
    const { data: closed } = await bot.rest.issues.update({
      ...widgets,
      issue_number: issue.number,
      state: "closed",
    })

    expect(created.performed_via_github_app).toMatchObject({ slug: BOT.slug })
    expect(created.performed_via_github_app).not.toHaveProperty("client_id")
    expect(edited.performed_via_github_app).toMatchObject({ client_id: BOT.clientId })
    expect(edited.performed_via_github_app).not.toHaveProperty("installations_count")
    expect(edited).toMatchObject({ pin: null, minimized: null })
    expect(issue.performed_via_github_app).toBeNull()
    expect(closed.closed_by).toMatchObject({ login: `${BOT.slug}[bot]`, type: "Bot" })
    expect(issue.closed_by).toBeNull()
  })

  it("refuses an issue without a title after the token's permissions, and before the repository", async () => {
    const emulator = githubWith()
    const bot = installation(emulator, BOT, INSTALLATION_ID)
    const untitled = (owner: string, repo: string) =>
      refusal(bot.request({ method: "POST", url: "/repos/{owner}/{repo}/issues", owner, repo }))

    expect(await untitled("ada", "notes")).toEqual({
      status: 422,
      message: 'Invalid request.\n\n"title" wasn\'t supplied.',
    })

    const { data: token } = await asApp(emulator, BOT).rest.apps.createInstallationAccessToken({
      installation_id: INSTALLATION_ID,
      permissions: { metadata: "read" },
    })

    expect(
      await refusal(
        octokitFor(emulator, token.token).request({
          method: "POST",
          url: "/repos/{owner}/{repo}/issues",
          ...widgets,
        }),
      ),
    ).toEqual({ status: 403, message: "Resource not accessible by integration" })
  })

  it("signs a contents API commit as GitHub, with the App's bot as its author", async () => {
    const emulator = withWriter()
    const writer = installation(emulator, WRITER, WRITER.installation)
    const { data: put } = await writer.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "notes/a.md",
      message: "Add a note",
      content: base64("# a\n"),
    })
    const { data: branch } = await writer.rest.repos.getBranch({ ...widgets, branch: "main" })

    expect(put.commit.verification).toMatchObject({ verified: true, reason: "valid" })
    expect(put.content).not.toHaveProperty("content")
    expect(put.commit).not.toHaveProperty("comment_count")
    expect(branch.commit.author).toMatchObject({ login: `${WRITER.slug}[bot]`, type: "Bot" })
    expect(branch.commit.committer).toMatchObject({ login: "web-flow" })
    expect(branch.commit.commit.verification?.signature).toEqual(expect.any(String))
  })

  it("opens a pull request before its mergeability is known, and has a test merge commit after", async () => {
    const emulator = withWriter()
    const writer = installation(emulator, WRITER, WRITER.installation)
    const { data: main } = await writer.rest.git.getRef({ ...widgets, ref: "heads/main" })

    await writer.rest.git.createRef({ ...widgets, ref: "refs/heads/topic", sha: main.object.sha })
    await writer.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "topic.md",
      message: "Topic",
      content: base64("topic\n"),
      branch: "topic",
    })

    const { data: opened } = await writer.rest.pulls.create({
      ...widgets,
      title: "Topic",
      head: "topic",
      base: "main",
    })
    const { data: read } = await writer.rest.pulls.get({ ...widgets, pull_number: opened.number })

    expect(opened).toMatchObject({ mergeable: null, rebaseable: null, merge_commit_sha: null })
    expect(opened.head.repo).not.toHaveProperty("permissions")
    expect(read).toMatchObject({ mergeable: true, merge_commit_sha: expect.any(String) })
  })

  it("shows an installation's client id and single-file fields", async () => {
    const emulator = githubWith()
    const app = asApp(emulator, BOT)
    const { data } = await app.rest.apps.getInstallation({ installation_id: INSTALLATION_ID })

    expect(data).toMatchObject({
      client_id: BOT.clientId,
      has_multiple_single_files: false,
      single_file_paths: [],
    })
  })
})
