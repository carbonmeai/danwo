/**
 * Finding what earlier GitHub runs left in the sandbox repository: open issues and pull requests
 * whose title carries the fidelity tag (closed, since an App cannot delete them), branches named
 * with it (deleted) and labels named with it (deleted). Nothing untagged is ever touched.
 */
import { FIDELITY_TAG } from "../ledger.ts"
import type { Target } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json, readJson, stringField } from "../shape.ts"
import { isTagged, type Leftover, SweepUnavailable } from "../sweep.ts"
import { APP_MISSING, githubRequest, mintToken, targetApp } from "./github-app.ts"

/** How many pages of 100 each list is read to: enough for a sandbox's leftovers. */
const PAGES = 10

/** Every item of a paged GitHub list. */
async function listAll(target: Target, request: (page: number) => Request): Promise<Json[]> {
  const items: Json[] = []

  for (let page = 1; page <= PAGES; page++) {
    const response = await target.send(request(page))

    if (!response.ok) throw new Error(`listing the sandbox answered ${response.status}`)

    const body = await readJson(response)
    const found = isJsonArray(body) ? body : []

    items.push(...found)
    if (found.length < 100) break
  }

  return items
}

/** The sweep for GitHub: tagged issues, pull requests, branches and labels in the sandbox. */
export async function githubSweep(target: Target): Promise<Leftover[]> {
  const app = targetApp(target)

  if (app === undefined) throw new SweepUnavailable(APP_MISSING)

  const token = await mintToken(target, app)
  const call = (method: string, path: string, body?: unknown) =>
    githubRequest(method, `/repos/${app.repo}${path}`, { auth: token, body })
  const open = await listAll(target, (page) =>
    call("GET", `/issues?state=open&per_page=100&page=${page}`),
  )
  const issues = open.flatMap((item): Leftover[] => {
    const title = stringField(item, "title")
    const number = asJsonObject(item)?.["number"]

    if (!isTagged(title) || typeof number !== "number") return []

    return [
      {
        kind: asJsonObject(item)?.["pull_request"] === undefined ? "issue" : "pull request",
        id: String(number),
        label: title,
        tagged: true,
        remove: () => target.send(call("PATCH", `/issues/${number}`, { state: "closed" })),
      },
    ]
  })
  const refs = await sendList(target, call("GET", `/git/matching-refs/heads/${FIDELITY_TAG}`))
  const branches = refs.flatMap((item): Leftover[] => {
    const name = stringField(item, "ref").replace(/^refs\/heads\//, "")

    return isTagged(name)
      ? [
          {
            kind: "branch",
            id: name,
            label: name,
            tagged: true,
            remove: () => target.send(call("DELETE", `/git/refs/heads/${name}`)),
          },
        ]
      : []
  })
  const labels = (
    await listAll(target, (page) => call("GET", `/labels?per_page=100&page=${page}`))
  ).flatMap((item): Leftover[] => {
    const name = stringField(item, "name")

    return isTagged(name)
      ? [
          {
            kind: "label",
            id: name,
            label: name,
            tagged: true,
            remove: () => target.send(call("DELETE", `/labels/${encodeURIComponent(name)}`)),
          },
        ]
      : []
  })

  return [...issues, ...branches, ...labels]
}

/** A list answer's items; a refusal fails the sweep. */
async function sendList(target: Target, request: Request): Promise<readonly Json[]> {
  const response = await target.send(request)

  if (!response.ok) throw new Error(`listing the sandbox answered ${response.status}`)

  const body = await readJson(response)

  return isJsonArray(body) ? body : []
}
