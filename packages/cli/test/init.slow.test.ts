/**
 * `danwo init` on a fresh project, end to end: it writes the config and example test, and
 * `danwo test` then starts the app through the proxy and passes, with the app's calls to Stripe
 * answered by the emulator.
 */
import { execFile } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { freePort } from "./fixtures/app-process.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url))

/** A test the project adds after init: the app charges a card, and Stripe's emulator answers. */
const CHARGE_TEST = `import { test } from "@danwo/sdk"

test("charges through Stripe", async ({ app, expect }) => {
  const response = await fetch(new URL("/charge", app.baseUrl), { method: "POST" })

  expect(response.status).toBe(200)
})
`

let root: string
let port: number

/** The flags both runs of init take. */
const initArgs = () => [
  "init",
  "--yes",
  "--skip-install",
  "--model-source",
  "none",
  "--skills",
  "claude",
  "--app-url",
  `http://127.0.0.1:${port}`,
]

/** Runs `danwo <args>` in the project; resolves to its exit code and output. */
function danwo(args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: root, env: { ...process.env, NO_COLOR: "1", CI: "" } },
      (error, stdout, stderr) => {
        resolve({ code: typeof error?.code === "number" ? error.code : 0, out: stdout + stderr })
      },
    )
  })
}

beforeAll(async () => {
  /* Inside the repository, so the project resolves @danwo/sdk as an installed one would. */
  root = await mkdtemp(join(FIXTURES, ".init-"))
  await copyFile(join(FIXTURES, "init-app", "app.ts"), join(root, "app.ts"))
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "init-app", scripts: { dev: "node app.ts" }, dependencies: { stripe: "17.0.0" } }, null, 2)}\n`,
  )
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("danwo init on a fresh project", () => {
  it("writes a config whose example test passes, with Stripe emulated", async () => {
    port = await freePort()

    const init = await danwo(initArgs())

    expect(init.code).toBe(0)
    expect(init.out).toContain("created   danwo.config.ts")
    expect(init.out).toContain("with Stripe emulated")
    expect(await readFile(join(root, "danwo.config.ts"), "utf8")).toContain("stripeService()")

    await mkdir(join(root, "tests"), { recursive: true })
    await writeFile(join(root, "tests", "charge.danwo.ts"), CHARGE_TEST)

    const run = await danwo(["test"])

    expect(run.out).toMatch(/2 passed/)
    expect(run.code).toBe(0)
  })

  it("changes nothing when run again", async () => {
    const again = await danwo(initArgs())

    expect(again.code).toBe(0)
    expect(again.out).not.toMatch(/^\s+(created|updated|kept)\s/m)
    expect(again.out).toContain("unchanged danwo.config.ts")
  })
})
