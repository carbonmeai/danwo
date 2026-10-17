import { describe, expect, it } from "vitest"

import { githubRepo } from "../src/github/index.ts"
import {
  ADA_PUBLIC_ONLY,
  ADA_TOKEN,
  base64 as content,
  BOB_TOKEN,
  githubWith,
  octokitFor,
  refusal,
} from "./github-api.ts"

const widgets = { owner: "acme", repo: "widgets" }

describe("GitHub repositories", () => {
  it("shows a repository, and hides a private one from people outside it", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const { data: repo } = await ada.rest.repos.get(widgets)

    expect(repo).toMatchObject({
      full_name: "acme/widgets",
      private: false,
      default_branch: "main",
    })
    expect(repo.owner.login).toBe("acme")
    expect(repo.html_url).toBe("https://github.com/acme/widgets")
    expect((await ada.rest.repos.get({ owner: "acme", repo: "secret" })).data.private).toBe(true)
    expect(
      await refusal(
        octokitFor(emulator, BOB_TOKEN).rest.repos.get({ owner: "acme", repo: "secret" }),
      ),
    ).toEqual({ status: 404, message: "Not Found" })
    expect(
      await refusal(
        octokitFor(emulator, ADA_PUBLIC_ONLY).rest.repos.get({ owner: "acme", repo: "secret" }),
      ),
    ).toMatchObject({ status: 404 })
    expect((await octokitFor(emulator).rest.repos.get(widgets)).data.name).toBe("widgets")
    expect(await refusal(octokitFor(emulator, "ghp_unknown").rest.repos.get(widgets))).toEqual({
      status: 401,
      message: "Bad credentials",
    })
  })

  it("lists a person's repositories with their organisations', and creates one with a README", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const listed = await ada.rest.repos.listForAuthenticatedUser()

    expect(listed.data.map((repo) => repo.full_name)).toEqual([
      "acme/secret",
      "acme/widgets",
      "ada/notes",
    ])

    const { data: created } = await ada.rest.repos.createForAuthenticatedUser({
      name: "fresh",
      description: "New",
      auto_init: true,
    })

    expect(created.full_name).toBe("ada/fresh")
    expect(githubRepo(emulator, "ada/fresh").file("README.md")).toBe("# fresh\n\nNew\n")
    expect(
      await refusal(ada.rest.repos.createForAuthenticatedUser({ name: "fresh" })),
    ).toMatchObject({ status: 422, message: "Repository creation failed." })
    expect(
      (await ada.rest.repos.createInOrg({ org: "acme", name: "gadgets", private: true })).data
        .private,
    ).toBe(true)
    expect(
      await refusal(
        octokitFor(emulator, BOB_TOKEN).rest.repos.createInOrg({ org: "acme", name: "nope" }),
      ),
    ).toMatchObject({ status: 403 })
  })

  it("reads, creates, updates and deletes files, refusing a stale sha", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const { data: readme } = await ada.rest.repos.getContent({ ...widgets, path: "README.md" })

    if (Array.isArray(readme) || readme.type !== "file") throw new Error("expected a file")
    expect(Buffer.from(readme.content, "base64").toString()).toBe("# widgets\n")

    const { data: root } = await ada.rest.repos.getContent({ ...widgets, path: "" })

    expect(Array.isArray(root) && root.map((entry) => `${entry.type} ${entry.path}`)).toEqual([
      "file README.md",
      "dir src",
    ])

    const created = await ada.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "docs/guide.md",
      message: "Add guide",
      content: content("Guide\n"),
    })

    expect(created.status).toBe(201)
    expect(created.data.commit.message).toBe("Add guide")
    expect(
      await refusal(
        ada.rest.repos.createOrUpdateFileContents({
          ...widgets,
          path: "docs/guide.md",
          message: "No sha",
          content: content("x"),
        }),
      ),
    ).toMatchObject({ status: 422 })
    expect(
      await refusal(
        ada.rest.repos.createOrUpdateFileContents({
          ...widgets,
          path: "docs/guide.md",
          message: "Stale",
          content: content("x"),
          sha: readme.sha,
        }),
      ),
    ).toEqual({ status: 409, message: `docs/guide.md does not match ${readme.sha}` })

    const updated = await ada.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "docs/guide.md",
      message: "Update guide",
      content: content("Guide v2\n"),
      sha: created.data.content?.sha ?? "",
    })

    expect(updated.status).toBe(200)
    expect(githubRepo(emulator, "acme/widgets").file("docs/guide.md")).toBe("Guide v2\n")

    await ada.rest.repos.deleteFile({
      ...widgets,
      path: "docs/guide.md",
      message: "Remove guide",
      sha: updated.data.content?.sha ?? "",
    })
    expect(githubRepo(emulator, "acme/widgets").file("docs/guide.md")).toBeUndefined()
    expect(githubRepo(emulator, "acme/widgets").commits()).toEqual([
      "Remove guide",
      "Update guide",
      "Add guide",
      "Initial commit",
    ])
    expect(
      await refusal(
        octokitFor(emulator, BOB_TOKEN).rest.repos.createOrUpdateFileContents({
          ...widgets,
          path: "x",
          message: "m",
          content: content("x"),
        }),
      ),
    ).toMatchObject({ status: 404 })
  })

  it("lists commits, branches and refs, and moves refs only forward without force", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)
    const main = (await ada.rest.repos.getBranch({ ...widgets, branch: "main" })).data

    await ada.rest.git.createRef({
      ...widgets,
      ref: "refs/heads/feature/one",
      sha: main.commit.sha,
    })
    expect((await ada.rest.repos.listBranches(widgets)).data.map((b) => b.name)).toEqual([
      "main",
      "feature/one",
    ])
    expect(
      (await ada.rest.git.getRef({ ...widgets, ref: "heads/feature/one" })).data.object.sha,
    ).toBe(main.commit.sha)

    const next = await ada.rest.repos.createOrUpdateFileContents({
      ...widgets,
      path: "a.txt",
      message: "On main",
      content: "YQ==",
    })
    const ahead = next.data.commit.sha ?? ""

    await ada.rest.git.updateRef({ ...widgets, ref: "heads/feature/one", sha: ahead })
    expect(
      await refusal(
        ada.rest.git.updateRef({ ...widgets, ref: "heads/feature/one", sha: main.commit.sha }),
      ),
    ).toEqual({ status: 422, message: "Update is not a fast forward" })
    await ada.rest.git.updateRef({
      ...widgets,
      ref: "heads/feature/one",
      sha: main.commit.sha,
      force: true,
    })

    const { data: commit } = await ada.rest.repos.getCommit({ ...widgets, ref: ahead })

    expect(commit.files?.map((file) => `${file.status} ${file.filename}`)).toEqual(["added a.txt"])
    expect(
      (await ada.rest.repos.listCommits({ ...widgets, path: "a.txt" })).data.map(
        (c) => c.commit.message,
      ),
    ).toEqual(["On main"])
    await ada.rest.git.deleteRef({ ...widgets, ref: "heads/feature/one" })
    expect(
      await refusal(ada.rest.git.getRef({ ...widgets, ref: "heads/feature/one" })),
    ).toMatchObject({ status: 404 })
  })

  it("pages lists with Link headers, answers If-None-Match with a free 304, and reports the rate limit", async () => {
    const emulator = githubWith()
    const ada = octokitFor(emulator, ADA_TOKEN)

    for (let n = 0; n < 35; n++)
      await ada.rest.issues.createLabel({ ...widgets, name: `label-${n}` })

    const first = await ada.rest.issues.listLabelsForRepo({ ...widgets, per_page: 10 })

    expect(first.headers.link).toContain('rel="next"')
    expect(first.headers.link).toContain("page=4")
    expect(
      await ada.paginate(ada.rest.issues.listLabelsForRepo, { ...widgets, per_page: 10 }),
    ).toHaveLength(35)

    const once = await emulator.fetch(
      new Request("https://api.github.com/repos/acme/widgets", {
        headers: { authorization: `token ${ADA_TOKEN}` },
      }),
    )
    const etag = once.headers.get("etag") ?? ""
    const again = await emulator.fetch(
      new Request("https://api.github.com/repos/acme/widgets", {
        headers: { authorization: `token ${ADA_TOKEN}`, "if-none-match": etag },
      }),
    )

    expect(once.headers.get("x-ratelimit-limit")).toBe("5000")
    expect(again.status).toBe(304)
    expect(again.headers.get("x-ratelimit-used")).toBe(once.headers.get("x-ratelimit-used"))
    expect(Number(once.headers.get("x-ratelimit-remaining"))).toBe(
      5000 - Number(once.headers.get("x-ratelimit-used")),
    )
  })

  it("refuses anonymous callers past 60 requests an hour", async () => {
    const emulator = githubWith()
    const call = () => emulator.fetch(new Request("https://api.github.com/repos/acme/widgets"))

    for (let n = 0; n < 60; n++) await call()

    const refused = await call()

    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({
      message: expect.stringContaining("API rate limit exceeded"),
    })
    expect(refused.headers.get("x-ratelimit-remaining")).toBe("0")
  })
})
