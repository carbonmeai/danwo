import { Webhooks } from "@octokit/webhooks"
import { describe, expect, it } from "vitest"

import { githubRepo, seedGithub } from "../src/github/index.ts"
import {
  ADA_TOKEN,
  BOB_TOKEN,
  capturing,
  delivered,
  githubWith,
  octokitFor,
  payloadOf,
  refusal,
} from "./github-api.ts"

const widgets = { owner: "acme", repo: "widgets" }
const HOOK_SECRET = "hook-secret"

describe("GitHub issues, comments and labels", () => {
  it("opens, edits, labels and closes issues, and lists them with filters", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const { data: issue } = await ada.rest.issues.create({
      ...widgets,
      title: "Broken build",
      body: "It fails",
      labels: ["bug"],
    })

    expect(issue).toMatchObject({
      number: 1,
      state: "open",
      title: "Broken build",
      user: { login: "ada" },
    })
    expect(issue.labels.map((label) => (typeof label === "string" ? label : label.name))).toEqual([
      "bug",
    ])

    await ada.rest.issues.create({ ...widgets, title: "Second" })
    await ada.rest.issues.addLabels({ ...widgets, issue_number: 1, labels: ["urgent"] })
    await ada.rest.issues.removeLabel({ ...widgets, issue_number: 1, name: "bug" })

    const { data: closed } = await ada.rest.issues.update({
      ...widgets,
      issue_number: 1,
      state: "closed",
      state_reason: "not_planned",
    })

    expect(closed).toMatchObject({ state: "closed", state_reason: "not_planned" })
    expect(closed.closed_at).toMatch(/Z$/)
    expect((await ada.rest.issues.listForRepo(widgets)).data.map((i) => i.number)).toEqual([2])
    expect(
      (await ada.rest.issues.listForRepo({ ...widgets, state: "all", labels: "urgent" })).data.map(
        (i) => i.number,
      ),
    ).toEqual([1])
    expect(await refusal(ada.rest.issues.create({ ...widgets, title: "" }))).toMatchObject({
      status: 422,
    })
    expect(await refusal(ada.rest.issues.get({ ...widgets, issue_number: 99 }))).toMatchObject({
      status: 404,
    })
  })

  it("lets anyone comment on a public repository's issues, and counts the comments", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const bob = octokitFor(emulator, BOB_TOKEN)

    await ada.rest.issues.create({ ...widgets, title: "Question" })

    const { data: comment } = await bob.rest.issues.createComment({
      ...widgets,
      issue_number: 1,
      body: "Me too",
    })

    expect(comment).toMatchObject({
      body: "Me too",
      user: { login: "bob" },
      author_association: "NONE",
    })
    await bob.rest.issues.updateComment({
      ...widgets,
      comment_id: comment.id,
      body: "Me too, on Linux",
    })
    await ada.rest.issues.createComment({ ...widgets, issue_number: 1, body: "Looking" })
    expect((await ada.rest.issues.get({ ...widgets, issue_number: 1 })).data.comments).toBe(2)
    await ada.rest.issues.deleteComment({ ...widgets, comment_id: comment.id })
    expect(githubRepo(emulator, "acme/widgets").comments(1)).toEqual([
      { id: expect.any(Number), issue: 1, body: "Looking", author: "ada" },
    ])
    expect(
      await refusal(
        bob.rest.issues.createComment({
          owner: "acme",
          repo: "secret",
          issue_number: 1,
          body: "x",
        }),
      ),
    ).toMatchObject({ status: 404 })
  })

  it("manages repository labels and keeps issues in step when one is renamed", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)

    await ada.rest.issues.createLabel({
      ...widgets,
      name: "bug",
      color: "#D73A4A",
      description: "Something broke",
    })
    expect(await refusal(ada.rest.issues.createLabel({ ...widgets, name: "Bug" }))).toMatchObject({
      status: 422,
    })
    expect(
      await refusal(ada.rest.issues.createLabel({ ...widgets, name: "odd", color: "purple" })),
    ).toMatchObject({ status: 422 })
    await ada.rest.issues.create({ ...widgets, title: "Crash", labels: ["bug"] })
    await ada.rest.issues.updateLabel({ ...widgets, name: "bug", new_name: "defect" })

    const { data: labels } = await ada.rest.issues.listLabelsOnIssue({
      ...widgets,
      issue_number: 1,
    })

    expect(labels.map((label) => `${label.name} ${label.color}`)).toEqual(["defect d73a4a"])
  })

  it("delivers signed issue and comment webhooks to repository hooks, and pings a new hook", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)
    const ada = octokitFor(emulator, ADA_TOKEN)
    const verifier = new Webhooks({ secret: HOOK_SECRET })

    await ada.rest.repos.createWebhook({
      ...widgets,
      config: { url: "https://ci.danwo.test/hook", secret: HOOK_SECRET, content_type: "json" },
      events: ["issues", "issue_comment"],
    })
    await ada.rest.issues.create({ ...widgets, title: "Hooked" })
    await ada.rest.issues.createComment({ ...widgets, issue_number: 1, body: "Hi" })
    await delivered(emulator, 3)

    const hookCalls = deliveries.filter((d) => d.url === "https://ci.danwo.test/hook")

    expect(hookCalls.map((d) => d.headers["x-github-event"])).toEqual([
      "ping",
      "issues",
      "issue_comment",
    ])

    for (const delivery of hookCalls)
      expect(
        await verifier.verify(delivery.body, delivery.headers["x-hub-signature-256"] ?? ""),
      ).toBe(true)

    const opened = payloadOf(hookCalls[1])

    expect(opened).toMatchObject({ action: "opened", issue: { title: "Hooked" } })
    expect(opened.installation).toBeUndefined()
    expect(hookCalls[1]?.headers["x-github-delivery"]).toMatch(/^[0-9a-f-]{36}$/)
    expect(hookCalls[1]?.headers["x-github-hook-installation-target-type"]).toBe("repository")
  })

  it("delivers a webhook to an installed app with its installation, and a forged copy fails verification", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)
    const verifier = new Webhooks({ secret: "bot-webhook-secret" })

    emulator.webhooks?.setFault(() => ({ kind: "forged" }))
    await octokitFor(emulator, ADA_TOKEN).rest.issues.create({ ...widgets, title: "For the bot" })
    await delivered(emulator, 2)

    const [forged, real] = deliveries

    expect(real?.headers["x-github-event"]).toBe("issues")
    expect(payloadOf(real)).toMatchObject({ installation: { id: 777_001 } })
    expect(
      await verifier.verify(real?.body ?? "", real?.headers["x-hub-signature-256"] ?? ""),
    ).toBe(true)
    expect(
      await verifier.verify(forged?.body ?? "", forged?.headers["x-hub-signature-256"] ?? ""),
    ).toBe(false)
  })

  it("sends nothing for a repository the app is not installed on", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)

    seedGithub(emulator.store, { repos: [{ repo: "acme/other" }] })
    await octokitFor(emulator, ADA_TOKEN).rest.issues.create({
      owner: "acme",
      repo: "other",
      title: "Quiet",
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(deliveries).toEqual([])
  })
})
