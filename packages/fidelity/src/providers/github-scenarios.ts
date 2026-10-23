/**
 * GitHub's scenarios as the App installed on the sandbox repository: the App's own authentication,
 * what an installation token reaches, issues with comments and labels, branches and files, a pull
 * request with the comment danwo's reporter posts and edits in place, a check run with more
 * annotations than one request takes, and the errors for a missing issue, a bad conclusion and a
 * token without access. Everything a scenario makes carries the run's tag and is undone when it
 * ends: issues and pull requests closed, labels and branches deleted, tokens revoked.
 */
import type { Answer, Scenario, ScenarioContext, StepOptions } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json, stringField } from "../shape.ts"
import {
  appJwt,
  deleteBranchLater,
  githubRequest,
  mintedToken,
  mintToken,
  openSession,
  type RepoSession,
  requireApp,
  required,
  revokeLater,
  scratchBranch,
  scratchFile,
  tokenRequestBody,
} from "./github-app.ts"

/** The check run's name, in the format danwo's reporter gives a named suite's check. */
const CHECK_NAME = "danwo · fidelity"

/** GitHub takes at most this many annotations in one request; the reporter sends more in turns. */
const ANNOTATIONS_PER_REQUEST = 50

/** What danwo's reporter marks its pull request comment with, so it can find and edit it. */
const MARKER = "<!-- danwo-report -->"

const ERROR_LITERALS = ["message", "status"]
const ISSUE_LITERALS = ["state", "state_reason", "locked", "user.type", "author_association"]
const LABEL_LITERALS = ["[].default"]

/** A repository's answer: its visibility and owner kind are part of the API, the rest is shape. */
const REPO_OPTIONS: StepOptions = {
  literals: ["private", "visibility", "owner.type"],
  maps: ["permissions", "license"],
}

/** The number of items in a list answer, or in one of its fields. */
function countOf(body: Json, field?: string): number {
  const list = field === undefined ? body : asJsonObject(body)?.[field]

  return list !== undefined && isJsonArray(list) ? list.length : -1
}

/** The bodies of a comment list, in order. */
function bodiesOf(answer: Answer): string[] {
  return isJsonArray(answer.body) ? answer.body.map((item) => stringField(item, "body")) : []
}

const app: Scenario = {
  name: "app: JWT, installation and installation token",
  documentedFacts: [
    { name: "the token expires in about an hour", value: true },
    { name: "the token covers only the sandbox repository", value: true },
  ],
  async run(context) {
    const credentials = requireApp(context)
    const jwt = appJwt(credentials)

    await context.step("read the app", githubRequest("GET", "/app", { auth: jwt }), {
      maps: ["permissions"],
    })
    await context.step(
      "read the installation",
      githubRequest("GET", `/app/installations/${credentials.installationId}`, { auth: jwt }),
      {
        literals: ["repository_selection", "target_type", "account.type"],
        maps: ["permissions"],
      },
    )

    const minted = await context.step(
      "create an installation token",
      githubRequest("POST", `/app/installations/${credentials.installationId}/access_tokens`, {
        auth: jwt,
        body: tokenRequestBody(credentials),
      }),
      {
        literals: ["repository_selection", "repositories[].private", "repositories[].visibility"],
        maps: ["permissions", "repositories[].permissions", "repositories[].license"],
      },
    )

    revokeLater(context, mintedToken(minted), "token")

    const minutes = (Date.parse(stringField(minted.body, "expires_at")) - Date.now()) / 60_000

    context.fact("the token expires in about an hour", minutes > 55 && minutes <= 61)
    context.fact(
      "the token covers only the sandbox repository",
      countOf(minted.body, "repositories") === 1,
    )
  },
}

const installation: Scenario = {
  name: "installation: its repositories and the sandbox repository",
  documentedFacts: [{ name: "repositories listed", value: 1 }],
  async run(context) {
    const session = await openSession(context)
    const listed = await context.step(
      "list the installation's repositories",
      githubRequest("GET", "/installation/repositories", { auth: session.token }),
      {
        literals: ["repository_selection", "repositories[].private", "repositories[].visibility"],
        maps: ["repositories[].permissions", "repositories[].license"],
      },
    )

    context.fact("repositories listed", countOf(listed.body, "repositories"))
    await context.step("read the sandbox repository", session.call("GET", ""), REPO_OPTIONS)
  },
}

/** Makes a label named after the run's tag, deleted when the scenario ends. */
async function tagLabel(context: ScenarioContext, session: RepoSession): Promise<string> {
  const name = context.tag
  const created = await context.step(
    "create a label",
    session.call("POST", "/labels", {
      name,
      color: "5319e7",
      description: "Made by a danwo fidelity run",
    }),
    { literals: ["default"] },
  )

  if (created.status === 201)
    context.created({
      kind: "label",
      id: name,
      undo: () => context.target.send(session.call("DELETE", `/labels/${name}`)),
    })

  return name
}

/** Opens an issue titled with the run's tag; closing it is its cleanup, as an App cannot delete one. */
async function tagIssue(context: ScenarioContext, session: RepoSession): Promise<number> {
  const opened = await context.step(
    "create an issue",
    session.call("POST", "/issues", {
      title: `${context.tag} issue`,
      body: "Opened by a danwo fidelity check; it closes itself when the check ends.",
    }),
    { literals: ISSUE_LITERALS },
  )
  const number = Number(required(opened.body, ["number"]))

  context.created({
    kind: "issue",
    id: String(number),
    undo: () =>
      context.target.send(session.call("PATCH", `/issues/${number}`, { state: "closed" })),
  })

  return number
}

const issues: Scenario = {
  name: "issues: comment, edit, label and close",
  documentedFacts: [
    { name: "comments listed", value: 1 },
    { name: "the listed comment is the edited one", value: true },
    { name: "labels after adding", value: 1 },
    { name: "labels after removing", value: 0 },
  ],
  async run(context) {
    const session = await openSession(context)
    const label = await tagLabel(context, session)
    const number = await tagIssue(context, session)
    const comment = await context.step(
      "comment on the issue",
      session.call("POST", `/issues/${number}/comments`, { body: "First take." }),
      { literals: ["author_association", "user.type"] },
    )
    const id = required(comment.body, ["id"])

    await context.step(
      "edit the comment",
      session.call("PATCH", `/issues/comments/${id}`, { body: "Edited take." }),
      { literals: ["author_association", "user.type"] },
    )

    const listed = await context.step(
      "list the issue's comments",
      session.call("GET", `/issues/${number}/comments`),
      { literals: ["[].author_association", "[].user.type"] },
    )

    context.fact("comments listed", countOf(listed.body))
    context.fact("the listed comment is the edited one", bodiesOf(listed)[0] === "Edited take.")

    const added = await context.step(
      "add the label",
      session.call("POST", `/issues/${number}/labels`, { labels: [label] }),
      { literals: LABEL_LITERALS },
    )

    context.fact("labels after adding", countOf(added.body))

    const removed = await context.step(
      "remove the label",
      session.call("DELETE", `/issues/${number}/labels/${label}`),
      { literals: LABEL_LITERALS },
    )

    context.fact("labels after removing", countOf(removed.body))
    await context.step(
      "close the issue",
      session.call("PATCH", `/issues/${number}`, { state: "closed", state_reason: "completed" }),
      { literals: ISSUE_LITERALS },
    )
  },
}

const contents: Scenario = {
  name: "contents: a branch, a file on it, read back",
  documentedFacts: [{ name: "the file reads back as written", value: true }],
  async run(context) {
    const session = await openSession(context)
    const main = await context.step("read main's ref", session.call("GET", "/git/ref/heads/main"), {
      literals: ["object.type"],
    })
    const branch = context.tag

    await context.step(
      "create a branch",
      session.call("POST", "/git/refs", {
        ref: `refs/heads/${branch}`,
        sha: required(main.body, ["object", "sha"]),
      }),
      { literals: ["object.type"] },
    )
    deleteBranchLater(context, session, branch)

    const file = scratchFile(context)

    await context.step(
      "put a file on the branch",
      session.call("PUT", `/contents/${file.path}`, {
        message: `Add ${file.path}`,
        content: Buffer.from(file.text).toString("base64"),
        branch,
      }),
      { literals: ["content.type", "commit.verification.verified", "commit.verification.reason"] },
    )

    const read = await context.step(
      "read the file back",
      session.call("GET", `/contents/${file.path}?ref=${branch}`),
      { literals: ["type", "encoding"] },
    )
    const text = Buffer.from(stringField(read.body, "content"), "base64").toString("utf8")

    context.fact("the file reads back as written", text === file.text)
    await context.step("read the branch", session.call("GET", `/branches/${branch}`), {
      literals: ["protected"],
      maps: ["protection"],
    })
    await context.step("delete the branch", session.call("DELETE", `/git/refs/heads/${branch}`))
  },
}

const PULL_LITERALS = ["state", "draft", "merged", "locked", "author_association", "user.type"]

const pull: Scenario = {
  name: "pull request: open, the report comment edited in place, close",
  documentedFacts: [
    { name: "comments listed", value: 1 },
    { name: "the marked comment holds the edit", value: true },
  ],
  async run(context) {
    const session = await openSession(context)
    const branch = await scratchBranch(context, session)
    const opened = await context.step(
      "open a pull request",
      session.call("POST", "/pulls", {
        title: `${context.tag} pull request`,
        head: branch.name,
        base: "main",
        body: "Opened by a danwo fidelity check; it closes itself when the check ends.",
      }),
      { literals: PULL_LITERALS },
    )
    const number = Number(required(opened.body, ["number"]))

    context.created({
      kind: "pull request",
      id: String(number),
      undo: () =>
        context.target.send(session.call("PATCH", `/pulls/${number}`, { state: "closed" })),
    })

    const posted = await context.step(
      "post the report comment",
      session.call("POST", `/issues/${number}/comments`, { body: `${MARKER}\nRunning…` }),
      { literals: ["author_association", "user.type"] },
    )

    await context.step(
      "edit the report comment in place",
      session.call("PATCH", `/issues/comments/${required(posted.body, ["id"])}`, {
        body: `${MARKER}\nAll passed.`,
      }),
      { literals: ["author_association", "user.type"] },
    )

    const listed = await context.step(
      "list the pull request's comments",
      session.call("GET", `/issues/${number}/comments?per_page=100&page=1`),
      { literals: ["[].author_association", "[].user.type"] },
    )

    context.fact("comments listed", countOf(listed.body))
    context.fact(
      "the marked comment holds the edit",
      bodiesOf(listed).find((body) => body.includes(MARKER)) === `${MARKER}\nAll passed.`,
    )
    await context.step(
      "close the pull request",
      session.call("PATCH", `/pulls/${number}`, { state: "closed" }),
      { literals: PULL_LITERALS },
    )
  },
}

/** `count` annotations on the branch's file, numbered from `from`, in each level in turn. */
function annotations(file: string, from: number, count: number) {
  const levels = ["failure", "warning", "notice"] as const

  return Array.from({ length: count }, (_, index) => ({
    path: file,
    start_line: 1,
    end_line: 1,
    annotation_level: levels[(from + index) % levels.length],
    title: `Check ${from + index}`,
    message: `Annotation ${from + index} from a danwo fidelity check.`,
  }))
}

const CHECK_LITERALS = ["status", "conclusion", "name"]
const CHECK_MAPS = ["app.permissions"]

const checks: Scenario = {
  name: "check runs: in progress, more than 50 annotations, completed",
  documentedFacts: [
    { name: "annotations counted", value: 60 },
    { name: "annotations listed", value: 60 },
    { name: "check runs on the commit", value: 1 },
  ],
  async run(context) {
    const session = await openSession(context)
    const branch = await scratchBranch(context, session)
    const created = await context.step(
      "create a check run in progress",
      session.call("POST", "/check-runs", {
        name: CHECK_NAME,
        head_sha: branch.head,
        details_url: "https://danwo.dev/docs/fidelity",
        external_id: context.tag,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }),
      { literals: CHECK_LITERALS, maps: CHECK_MAPS },
    )
    const id = required(created.body, ["id"])
    const output = { title: "1 failed", summary: "A danwo fidelity check.", text: "Details." }

    await context.step(
      "add the first 50 annotations",
      session.call("PATCH", `/check-runs/${id}`, {
        output: { ...output, annotations: annotations(branch.file, 1, ANNOTATIONS_PER_REQUEST) },
      }),
      { literals: CHECK_LITERALS, maps: CHECK_MAPS },
    )

    const completed = await context.step(
      "complete it with the rest",
      session.call("PATCH", `/check-runs/${id}`, {
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output: {
          ...output,
          annotations: annotations(branch.file, ANNOTATIONS_PER_REQUEST + 1, 10),
        },
      }),
      { literals: CHECK_LITERALS, maps: CHECK_MAPS },
    )

    context.fact(
      "annotations counted",
      Number(required(completed.body, ["output", "annotations_count"])),
    )

    const listed = await context.step(
      "list the annotations",
      session.call("GET", `/check-runs/${id}/annotations?per_page=100`),
      { literals: ["[].annotation_level"] },
    )

    context.fact("annotations listed", countOf(listed.body))

    const runs = await context.step(
      "list the commit's check runs",
      session.call("GET", `/commits/${branch.head}/check-runs`),
      {
        literals: CHECK_LITERALS.map((path) => `check_runs[].${path}`),
        maps: CHECK_MAPS.map((path) => `check_runs[].${path}`),
      },
    )

    context.fact("check runs on the commit", countOf(runs.body, "check_runs"))
  },
}

/** A public repository the App is not installed on. */
const ELSEWHERE = "octocat/Hello-World"

const errors: Scenario = {
  name: "errors: missing issue, bad conclusion, a token without access",
  async run(context) {
    const session = await openSession(context)
    const branch = await scratchBranch(context, session)

    await context.step(
      "read an issue that does not exist",
      session.call("GET", "/issues/999999999"),
      { literals: ERROR_LITERALS },
    )
    await context.step(
      "create a check run with a conclusion GitHub does not know",
      session.call("POST", "/check-runs", {
        name: CHECK_NAME,
        head_sha: branch.head,
        conclusion: "danwo-unknown",
      }),
      { literals: ["status"] },
    )

    const readOnly = await mintToken(context.target, session.app, { metadata: "read" })

    revokeLater(context, readOnly, "read-only")
    /* An empty body would be a 422 to a token allowed to write, so a refusal is about access. */
    await context.step(
      "create an issue with a token that may only read metadata",
      githubRequest("POST", `/repos/${session.app.repo}/issues`, { auth: readOnly, body: {} }),
      { literals: ERROR_LITERALS },
    )
    await context.step(
      "read a public repository the App is not installed on",
      githubRequest("GET", `/repos/${ELSEWHERE}`, { auth: session.token }),
      REPO_OPTIONS,
    )
    await context.step(
      "create an issue on a repository the App is not installed on",
      githubRequest("POST", `/repos/${ELSEWHERE}/issues`, { auth: session.token, body: {} }),
      { literals: ERROR_LITERALS },
    )
  },
}

export const GITHUB_APP_SCENARIOS: readonly Scenario[] = [
  app,
  installation,
  issues,
  contents,
  pull,
  checks,
  errors,
]
