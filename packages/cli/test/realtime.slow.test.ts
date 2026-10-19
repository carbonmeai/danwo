import { execFile } from "node:child_process"
import { glob, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const APP = workCopy(fileURLToPath(new URL("./fixtures/realtime", import.meta.url)))

afterAll(removeWorkCopies)

/** Runs `danwo <args>` in the realtime fixture; resolves to its exit code and output. */
function danwo(args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: APP, env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const Record = z.object({
  exchanges: z.array(
    z.object({ disposition: z.string(), method: z.string(), host: z.string(), path: z.string() }),
  ),
  sockets: z.array(
    z.object({ disposition: z.string(), host: z.string(), status: z.number().nullable() }),
  ),
})

async function record(): Promise<z.infer<typeof Record>> {
  const paths: string[] = []

  for await (const path of glob(".danwo/runs/*/*places-an-order*/attempt-1/record.json", {
    cwd: APP,
  }))
    paths.push(path)

  const newest = paths.toSorted().at(-1)

  if (newest === undefined) throw new Error("no record")

  return Record.parse(JSON.parse(await readFile(`${APP}/${newest}`, "utf8")))
}

describe("an app on Pusher, Novu and Tiptap, all emulated", () => {
  it("publishes, notifies and syncs a note through the proxy, with the browser's sockets", async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("1 passed")
    expect(code).toBe(0)

    const run = await record()
    const calls = run.exchanges.map(
      (e) => `${e.disposition} ${e.method} ${e.host}${e.path.split("?")[0]}`,
    )

    expect(calls).toContain("routed POST api-mt1.pusher.com/apps/1000001/events")
    expect(calls).toContain("routed POST api.novu.co/v1/events/trigger")
    expect(run.sockets.map((s) => `${s.disposition} ${s.host} ${s.status}`)).toEqual(
      expect.arrayContaining([
        "routed ws-mt1.pusher.com 101",
        "routed orders.collab.tiptap.cloud 101",
      ]),
    )
  }, 180_000)

  it("plans socket faults on Pusher and Tiptap and trigger faults on Novu, and judges each", async () => {
    const { out } = await danwo(["matrix", "tests/orders.danwo.ts", "--faults", "WS |novu"])

    expect(out).toContain("clean run passed")
    expect(out).toMatch(/connection dropped on WS ws-mt1\.pusher\.com/)
    expect(out).toMatch(/upgrade refused on WS orders\.collab\.tiptap\.cloud/)
    expect(out).toMatch(/PASS  reset-after on POST api\.novu\.co\/v1\/events\/trigger/)
    expect(out).toMatch(/PASS  connection dropped on WS orders\.collab\.tiptap\.cloud/)
    /* Each planned trial ends judged: held, broke, not judged or invalid. */
    expect(out).toMatch(/\d+ runs in/)
  }, 300_000)
})
