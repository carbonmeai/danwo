/**
 * Two people in one test: the test's own browser posts to a team board and a teammate's browser,
 * opened with `users.open`, sees the post arrive over the board's WebSocket. The flight record
 * keeps the teammate's steps, calls, socket and video under their name, and `danwo matrix` faults
 * the teammate's socket apart from the poster's.
 */
import { execFile } from "node:child_process"
import { glob, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const BOARD = workCopy(fileURLToPath(new URL("./fixtures/teammates", import.meta.url)))

afterAll(removeWorkCopies)

/** Runs `danwo <args>` in the board fixture; resolves to its exit code and output. */
function danwo(
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: BOARD, env: { ...process.env, NO_COLOR: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const Record = z.object({
  steps: z.array(z.object({ api: z.string(), user: z.string().optional() })),
  exchanges: z.array(
    z.object({ method: z.string(), path: z.string(), user: z.string().optional() }),
  ),
  sockets: z.array(
    z.object({ path: z.string(), status: z.number().nullable(), user: z.string().optional() }),
  ),
  videos: z.array(
    z.object({
      file: z.string(),
      user: z.string().optional(),
      marks: z.array(z.object({ kind: z.string(), label: z.string() })),
    }),
  ),
})

/** The record of the newest run's attempt. */
async function newestRecord(): Promise<z.infer<typeof Record>> {
  const paths: string[] = []

  for await (const path of glob(".danwo/runs/*/*/attempt-1/record.json", { cwd: BOARD }))
    paths.push(path)

  const newest = paths.toSorted().at(-1)

  if (newest === undefined) throw new Error("no record")

  return Record.parse(JSON.parse(await readFile(`${BOARD}/${newest}`, "utf8")))
}

describe("two people in one test", () => {
  it("records the teammate's steps, calls, socket and video under their name", async () => {
    const { code, out } = await danwo(["test", "--video", "on"])

    expect(out).toContain("1 passed")
    expect(out).not.toContain("Response error")
    expect(code).toBe(0)

    const record = await newestRecord()
    const steps = (user?: string) =>
      record.steps.filter((step) => step.user === user).map((step) => step.api)

    expect(steps("bob")).toEqual(["app.open", "expect.toHaveText", "expect.toBeVisible"])
    expect(steps()).toEqual(["app.open", "locator.fill", "locator.click", "expect.toBeVisible"])
    expect(record.sockets.map((socket) => [socket.user, socket.status])).toEqual([
      ["bob", 101],
      [undefined, 101],
    ])
    expect(record.exchanges.find((call) => call.method === "POST")?.user).toBeUndefined()
    expect(
      record.exchanges.filter((call) => call.user === "bob").map((call) => call.path),
    ).toContain("/posts")

    const bobs = record.videos.find((video) => video.user === "bob")
    const own = record.videos.find((video) => video.user === undefined)

    expect(bobs?.file).toBe("video/bob-tab-1.webm")
    expect(own?.file).toBe("video/tab-1.webm")
    /* Each video carries its own person's steps and calls; the post is the poster's, not Bob's. */
    expect(bobs?.marks.some((mark) => mark.label.includes("toHaveText"))).toBe(true)
    expect(bobs?.marks.some((mark) => mark.label === "POST 127.0.0.1/posts")).toBe(false)
    expect(own?.marks.some((mark) => mark.label === "POST 127.0.0.1/posts")).toBe(true)
  }, 180_000)

  it("plans the teammate's socket faults apart from the poster's, and the board holds", async () => {
    const { code, out } = await danwo(["matrix", "tests/teammates.danwo.ts"])

    expect(out).toContain("PASS  upgrade refused on WS 127.0.0.1/live for bob")
    expect(out).toContain("PASS  connection dropped on WS 127.0.0.1/live for bob")
    expect(out).toContain("PASS  connection dropped on WS 127.0.0.1/live\n")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a board that leaves a teammate's dropped socket down", async () => {
    const { code, out } = await danwo(
      ["matrix", "tests/teammates.danwo.ts", "--faults", "for bob"],
      {
        TEAM_BUG: "no-reconnect",
      },
    )

    expect(out).toContain("FAIL  upgrade refused on WS 127.0.0.1/live for bob")
    expect(out).toContain("FAIL  connection dropped on WS 127.0.0.1/live for bob")
    /* The fault hit Bob's socket alone: his own check failed, the poster went on posting. */
    expect(out).toContain('expect(getByRole("status", name: "Connection")).toHaveText("live")')
    expect(code).toBe(1)
  }, 300_000)
})
