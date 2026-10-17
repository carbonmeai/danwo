import { describe, expect, it } from "vitest"

import { githubRepo } from "../src/github/index.ts"
import {
  ADA_TOKEN,
  base64 as content,
  BOB_TOKEN,
  capturing,
  delivered,
  githubWith,
  octokitFor,
  payloadOf,
  refusal,
} from "./github-api.ts"

const widgets = { owner: "acme", repo: "widgets" }

/** Ada branches `feature` off main and commits a change to it. */
async function featureBranch(ada: ReturnType<typeof octokitFor>) {
  const main = (await ada.rest.repos.getBranch({ ...widgets, branch: "main" })).data.commit.sha

  await ada.rest.git.createRef({ ...widgets, ref: "refs/heads/feature", sha: main })

  const readme = await ada.rest.repos.getContent({ ...widgets, path: "README.md", ref: "feature" })
  const sha = Array.isArray(readme.data) ? "" : readme.data.sha

  await ada.rest.repos.createOrUpdateFileContents({
    ...widgets,
    path: "README.md",
    branch: "feature",
    message: "Explain widgets",
    content: content("# widgets\n\nThey spin.\n"),
    sha,
  })

  return main
}

describe("GitHub pull requests", () => {
  it("opens a pull request, shows its files and commits, and refuses a duplicate", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)

    await featureBranch(ada)

    const { data: pull } = await ada.rest.pulls.create({
      ...widgets,
      title: "Explain widgets",
      head: "feature",
      base: "main",
    })

    expect(pull).toMatchObject({
      number: 1,
      state: "open",
      merged: false,
      head: { ref: "feature" },
      base: { ref: "main" },
      commits: 1,
      changed_files: 1,
    })
    expect(
      (await ada.rest.pulls.listFiles({ ...widgets, pull_number: 1 })).data.map(
        (f) => `${f.status} ${f.filename}`,
      ),
    ).toEqual(["modified README.md"])
    expect(
      (await ada.rest.pulls.listCommits({ ...widgets, pull_number: 1 })).data.map(
        (c) => c.commit.message,
      ),
    ).toEqual(["Explain widgets"])
    expect(
      (await ada.rest.issues.get({ ...widgets, issue_number: 1 })).data.pull_request?.url,
    ).toContain("/pulls/1")
    expect(
      await refusal(
        ada.rest.pulls.create({ ...widgets, title: "Again", head: "feature", base: "main" }),
      ),
    ).toMatchObject({ status: 422 })
    expect(
      await refusal(
        ada.rest.pulls.create({ ...widgets, title: "Nowhere", head: "missing", base: "main" }),
      ),
    ).toMatchObject({ status: 422 })
  })

  it("refuses approving one's own pull request, and records others' reviews", async () => {
    const emulator = githubWith({ orgs: [] })
    const ada = octokitFor(emulator, ADA_TOKEN)

    await featureBranch(ada)
    await ada.rest.pulls.create({ ...widgets, title: "Review me", head: "feature", base: "main" })
    expect(
      await refusal(ada.rest.pulls.createReview({ ...widgets, pull_number: 1, event: "APPROVE" })),
    ).toMatchObject({ status: 422 })

    const bob = octokitFor(emulator, BOB_TOKEN)
    const { data: review } = await bob.rest.pulls.createReview({
      ...widgets,
      pull_number: 1,
      event: "REQUEST_CHANGES",
      body: "Add tests",
    })

    expect(review).toMatchObject({ state: "CHANGES_REQUESTED", user: { login: "bob" } })
    expect(
      await refusal(bob.rest.pulls.createReview({ ...widgets, pull_number: 1, event: "COMMENT" })),
    ).toMatchObject({ status: 422 })
  })

  it("merges, moving the base branch and closing the pull request; a stale head sha is a 409", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)
    const ada = octokitFor(emulator, ADA_TOKEN)

    await featureBranch(ada)

    const { data: pull } = await ada.rest.pulls.create({
      ...widgets,
      title: "Ship it",
      head: "feature",
      base: "main",
    })

    expect(
      await refusal(ada.rest.pulls.merge({ ...widgets, pull_number: 1, sha: "0".repeat(40) })),
    ).toEqual({ status: 409, message: "Head branch was modified. Review and try the merge again." })

    const { data: merge } = await ada.rest.pulls.merge({
      ...widgets,
      pull_number: 1,
      sha: pull.head.sha,
    })

    expect(merge).toMatchObject({ merged: true, message: "Pull Request successfully merged" })
    expect(githubRepo(emulator, "acme/widgets").file("README.md")).toBe("# widgets\n\nThey spin.\n")
    expect((await ada.rest.pulls.get({ ...widgets, pull_number: 1 })).data).toMatchObject({
      state: "closed",
      merged: true,
      merge_commit_sha: merge.sha,
    })
    expect(await refusal(ada.rest.pulls.merge({ ...widgets, pull_number: 1 }))).toMatchObject({
      status: 405,
    })
    await delivered(emulator, 2)

    const actions = deliveries
      .filter((d) => d.headers["x-github-event"] === "pull_request")
      .map((d) => payloadOf(d))

    expect(actions.map((a) => a.action)).toEqual(["opened", "closed"])
    expect(actions[1]).toMatchObject({ pull_request: { merged: true } })
  })

  it("merges the head's changes onto a base that moved on", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)

    await featureBranch(ada)
    await ada.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "CHANGELOG.md",
      message: "Changelog",
      content: content("v1\n"),
    })
    await ada.rest.pulls.create({ ...widgets, title: "Late", head: "feature", base: "main" })
    await ada.rest.pulls.merge({ ...widgets, pull_number: 1, merge_method: "squash" })

    const repo = githubRepo(emulator, "acme/widgets")

    expect(repo.file("CHANGELOG.md")).toBe("v1\n")
    expect(repo.file("README.md")).toBe("# widgets\n\nThey spin.\n")
  })

  it("sends synchronize when the head branch gets a new commit", async () => {
    const { deliveries, options } = capturing()
    const emulator = githubWith({}, options)
    const ada = octokitFor(emulator, ADA_TOKEN)

    await featureBranch(ada)
    await ada.rest.pulls.create({ ...widgets, title: "Moving", head: "feature", base: "main" })
    await ada.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "more.txt",
      branch: "feature",
      message: "More",
      content: content("more\n"),
    })
    await delivered(emulator, 2)

    expect(deliveries.map((d) => payloadOf(d).action)).toEqual(["opened", "synchronize"])
  })
})
