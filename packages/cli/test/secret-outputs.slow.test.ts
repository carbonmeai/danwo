/**
 * A secret danwo knows stays out of everything a run writes, not only its flight records: the
 * terminal, the results file, JUnit, the HTML report, the environment record, the run history and
 * GitHub's job summary (the text of the pull request comment).
 */
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url))
const SECRET = "planted-Secret-4729-value"
const made: string[] = []

afterAll(async () => {
  await Promise.all(
    made.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  )
})

/** An app that prints the secret as it starts, then answers on `PORT`. */
const APP = `import { createServer } from "node:http"

console.log("booting with password ${SECRET}")
createServer((_, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1")
`

const CONFIG = `import { appEnvironment } from "@danwo/sdk"

export default {
  testDir: "tests",
  secrets: { password: "${SECRET}" },
  environment: () =>
    appEnvironment({
      app: { command: \`"\${process.execPath}" app.ts\`, url: "http://127.0.0.1:4793" },
    }),
}
`

/** A test that fails with the secret in its error, as an assertion on a field's value would. */
const TEST = `import { test } from "@danwo/sdk"

test("signs in", async () => {
  throw new Error("expected the field to hold ${SECRET}, but it was empty")
})
`

/** Every file under `dir`, with its text. */
async function filesUnder(dir: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue

    const path = join(entry.parentPath, entry.name)

    found.set(path, await readFile(path, "utf8").catch(() => ""))
  }

  return found
}

describe("a secret danwo knows", () => {
  it("is in none of the run's outputs", async () => {
    const root = await mkdtemp(join(FIXTURES, ".secrets-"))

    made.push(root)

    for (const [file, text] of Object.entries({
      "package.json": JSON.stringify({ name: "secrets", type: "module" }),
      "danwo.config.ts": CONFIG,
      "app.ts": APP,
      "tests/sign-in.danwo.ts": TEST,
    })) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), text)
    }

    const summary = join(root, "step-summary.md")
    const run = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        process.execPath,
        [BIN, "test", "--reporter", "list", "--reporter", "junit", "--reporter", "github"],
        {
          cwd: root,
          env: {
            ...process.env,
            NO_COLOR: "1",
            CI: "",
            GITHUB_ACTIONS: "true",
            GITHUB_REPOSITORY: "danwo/secrets",
            GITHUB_SHA: "0000000000000000000000000000000000000000",
            GITHUB_STEP_SUMMARY: summary,
            GITHUB_TOKEN: "",
          },
        },
        (error, stdout, stderr) =>
          resolve({ code: typeof error?.code === "number" ? error.code : 0, out: stdout + stderr }),
      )
    })
    const written = await filesUnder(join(root, ".danwo"))

    expect(run.code, run.out).toBe(1)
    expect(run.out).toContain("[secret password]")
    expect(run.out).not.toContain(SECRET)
    expect(await readFile(summary, "utf8")).not.toContain(SECRET)
    expect([...written.keys()].map((path) => path.slice(root.length + 1))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\.danwo\/results\/last-run\.json$/),
        expect.stringMatching(/^\.danwo\/junit\.xml$/),
        expect.stringMatching(/^\.danwo\/runs\/[^/]+\/report\.html$/),
        expect.stringMatching(/^\.danwo\/runs\/[^/]+\/environment-0\.json$/),
        expect.stringMatching(/record\.json$/),
      ]),
    )
    for (const [path, text] of written) expect(text, path).not.toContain(SECRET)
  })
})
