import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { glob } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

/** Orders trial labels as text, so a plan and a run compare regardless of order. */
const byText = (a: string | undefined, b: string | undefined) => (a ?? "").localeCompare(b ?? "")

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const STACK = workCopy(fileURLToPath(new URL("./fixtures/stack", import.meta.url)))

afterAll(removeWorkCopies)

/** Runs `danwo <args>` in the stack fixture; resolves to its exit code and output. */
function danwo(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: STACK, env: { ...process.env, NO_COLOR: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const Record = z.object({
  exchanges: z.array(
    z.object({
      disposition: z.string(),
      method: z.string(),
      host: z.string(),
      path: z.string(),
      stream: z.boolean().optional(),
      asset: z.boolean().optional(),
    }),
  ),
  sockets: z.array(z.object({ host: z.string(), path: z.string(), status: z.number().nullable() })),
  processLogs: z.record(z.string(), z.array(z.string())),
  notes: z.array(z.string()),
  state: z.object({
    inngest: z.object({ runs: z.array(z.object({ functionId: z.string(), status: z.string() })) }),
  }),
})

/** The newest record of the test whose slug includes `slug`, as it was written. */
async function newestRecordJson(slug: string): Promise<unknown> {
  const paths: string[] = []

  for await (const path of glob(`.danwo/runs/*/*${slug}*/attempt-1/record.json`, { cwd: STACK }))
    paths.push(path)

  const newest = paths.toSorted().at(-1)

  if (newest === undefined) throw new Error(`no record for ${slug}`)

  return JSON.parse(await readFile(`${STACK}/${newest}`, "utf8"))
}

/** The newest record of the test whose slug includes `slug`. */
async function newestRecord(slug: string): Promise<z.infer<typeof Record>> {
  return Record.parse(await newestRecordJson(slug))
}

describe("a stack of apps behind one proxy", () => {
  it("runs a frontend, an API and a worker with Inngest, a stream and a socket", async () => {
    const { code, out } = await danwo(["test", "tests/stack.danwo.ts"])

    expect(out).toContain("1 passed")
    expect(out).not.toContain("runs without danwo's preload")
    /* The page's stream and socket are dropped when the test ends; that is not worth a line. */
    expect(out).not.toContain("Response error")
    expect(code).toBe(0)

    const record = await newestRecord("adds-a-task")
    const calls = record.exchanges.map((e) => `${e.disposition} ${e.method} ${e.host}${e.path}`)

    /* The API's Stripe client has its own agent, and its start script replaced NODE_OPTIONS. */
    expect(calls).toContain("routed POST api.stripe.com/v1/customers")
    expect(calls).toContain("routed POST inngest.danwo.test/e/dev")
    expect(record.exchanges.find((e) => e.path === "/events")?.stream).toBe(true)
    expect(record.exchanges.find((e) => e.path.startsWith("/src/main.ts"))?.asset).toBe(true)
    expect(record.sockets).toMatchObject([{ host: "127.0.0.1", path: "/live", status: 101 }])
    expect(record.processLogs.api?.join("\n")).toMatch(/task Write the report saved for cus_/)
    expect(record.state.inngest.runs).toMatchObject([
      { functionId: "provision-task", status: "completed" },
    ])
  }, 180_000)

  it("warns about a process that started without danwo's preload", async () => {
    const { code, out } = await danwo(["test", "tests/boot.danwo.ts"], { STACK_NO_SHIM: "1" })

    expect(out).toMatch(/danwo: api: process \d+ \(.*node.*\) runs without danwo's preload/)
    expect(out).toContain("1 passed")
    expect(code).toBe(0)
  }, 180_000)

  it("passes an outside image under block, refuses the page's fetch() and says so", async () => {
    const { code, out } = await danwo(["test", "tests/media.danwo.ts"])
    const warning =
      "Blocked hosts the pages tried to load: images.unrouted.test (1 request). Add the ones the app needs to `allow`"

    expect(out).toContain("1 passed")
    expect(out.split(warning)).toHaveLength(2)
    expect(code).toBe(0)

    const record = Record.pick({ exchanges: true, notes: true }).parse(
      await newestRecordJson("outside-image"),
    )
    const calls = record.exchanges
      .filter((e) => e.host === "images.unrouted.test")
      .map((e) => `${e.disposition} ${e.method} ${e.path} ${e.asset === true}`)

    expect(calls).toEqual(["passthrough GET /logo.png true", "blocked GET /data.json false"])
    expect(record.notes.join("\n")).toContain(warning)
  }, 180_000)

  it("plans socket and event faults from the clean run", async () => {
    const { out } = await danwo(["matrix", "tests/stack.danwo.ts", "--faults", "WS |inngest"])

    expect(out).toContain(
      "clean run passed; 5 faults planned from the 9 possible, narrowed to /WS |inngest/",
    )
    expect(out).toContain("upgrade refused on WS 127.0.0.1/live")
    expect(out).toContain("connection dropped on WS 127.0.0.1/live")
    expect(out).toContain("status 500 on POST inngest.danwo.test/e/dev")
  }, 300_000)

  it("plans faults on the body only, with a saved session's setup left out", async () => {
    const { code, out } = await danwo(["matrix", "tests/session.danwo.ts", "--plan"])
    const planned = Number(/clean run passed; (\d+) faults planned/.exec(out)?.[1] ?? NaN)
    const trials = out.split("\n").filter((line) => line.startsWith("  "))

    expect(code).toBe(0)
    expect(planned).toBeGreaterThan(0)
    expect(planned).toBeLessThan(40)
    expect(trials).toHaveLength(planned)
    /* The setup added a task first, yet the body's own Stripe call is its first occurrence. */
    expect(out).toContain("status 500 on POST api.stripe.com/v1/customers\n")
    expect(out).not.toMatch(/on POST api\.stripe\.com\/v1\/customers #2/)
    expect(out).toMatch(/\d+ of \d+ possible faults left out: \d+ on setup/)
    expect(out).toMatch(/about \d+(–\d+)? (s|min) for \d+ trials on \d+ workers/)
    expect(out).not.toContain("faulted runs stop")
  }, 300_000)

  it("runs the trials it planned, each landing on the body's own work", async () => {
    const preview = await danwo(["matrix", "tests/session.danwo.ts", "--plan"])
    const planned = preview.out
      .split("\n")
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim())
    const { out } = await danwo(["matrix", "tests/session.danwo.ts"])
    const runs = [...out.matchAll(/^(PASS|FAIL|INVALID|NOT JUDGED|ENV) {1,2}(.+)$/gm)]
      .map(([, status, label]) => ({ status, label }))
      .filter(({ label }) => label !== "clean run")

    expect(runs.map(({ label }) => label).toSorted(byText)).toEqual(planned.toSorted(byText))
    /* A fault the setup's leftovers would have drawn never fires in a trial: none was planned. */
    expect(runs.filter(({ status }) => status === "INVALID")).toEqual([])
  }, 600_000)
})
