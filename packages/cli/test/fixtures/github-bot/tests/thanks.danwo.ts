import { githubRepo, type GithubFixtures, test as base } from "@danwo/sdk"

const test = base.extend<GithubFixtures & { readonly adaToken: string }>()

test("thanks the author of a new issue", async ({
  app,
  screen,
  github,
  adaToken,
  settle,
  expect,
}) => {
  const opened = await github.fetch(
    new Request("https://api.github.com/repos/ada/widgets/issues", {
      method: "POST",
      headers: { authorization: `token ${adaToken}` },
      body: JSON.stringify({ title: "The widget spins backwards" }),
    }),
  )

  expect(opened.status).toBe(201)
  await settle()

  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Comments: 1", { timeout: 3_000 })
}).invariant(async ({ github, expect }) => {
  /*
   * Whichever way the run went, the bot thanks each issue at most once: a webhook GitHub
   * delivers twice must not make it comment twice.
   */
  const repo = githubRepo(github, "ada/widgets")

  for (const issue of repo.issues()) {
    const thanks = repo.comments(issue.number).filter((comment) => comment.author === "thanks-bot")

    expect(thanks.length).toBeLessThanOrEqual(1)
  }
})
