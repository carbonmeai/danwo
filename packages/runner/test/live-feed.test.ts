import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange, Proxy } from "@danwo/proxy"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { StepRecord } from "../src/record/index.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"
import {
  liveCall,
  liveDir,
  type LiveEvent,
  liveStep,
  LiveTap,
  newRunId,
  openLiveFeed,
  type WorkerLiveEvent,
} from "../src/runner/live.ts"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-live-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function lines(id: string): Promise<LiveEvent[]> {
  const text = await readFile(join(liveDir(root), `${id}.jsonl`), "utf8")

  return text
    .trim()
    .split("\n")
    .map((line) => {
      const event: LiveEvent = JSON.parse(line)

      return event
    })
}

function exchange(over: Partial<Exchange>): Exchange {
  return {
    disposition: "routed",
    method: "POST",
    host: "api.stripe.com",
    path: "/v1/charges",
    startedAt: "2026-10-19T00:00:00.000Z",
    id: "x1",
    client: "server",
    fault: null,
    status: 200,
    durationMs: 12,
    aborted: false,
    ...over,
  }
}

const step = (over: Partial<StepRecord> = {}): StepRecord => ({
  id: "s",
  index: 0,
  kind: "agent",
  api: "agent.act",
  label: "buy credits",
  status: "passed",
  startedAt: "2026-10-19T00:00:00.000Z",
  durationMs: 40,
  events: [
    { kind: "action", at: "2026-10-19T00:00:00.000Z", label: "click Buy" },
    { kind: "action", at: "2026-10-19T00:00:00.000Z", label: "type 500" },
  ],
  ...over,
})

describe("live feed", () => {
  it("opens with the run, keeps every event in order and closes with the exit code", async () => {
    const id = newRunId()
    const feed = await openLiveFeed(root, { id, kind: "test", title: "2 tests", planned: 2 })

    feed.write({ type: "test", at: "t", test: "a", status: "passed", durationMs: 5 })
    feed.write({ type: "test", at: "t", test: "b", status: "failed", durationMs: 7 })
    await feed.finish(1, 20)

    const events = await lines(id)

    expect(events.map((event) => event.type)).toEqual(["run", "test", "test", "end"])
    expect(events[0]).toMatchObject({ id, kind: "test", pid: process.pid, planned: 2 })
    expect(events.at(-1)).toMatchObject({ exitCode: 1, durationMs: 20 })
  })

  it("keeps only the newest feeds", async () => {
    const first = await openLiveFeed(root, {
      id: "00000000-000000-0000",
      kind: "test",
      title: "",
      planned: 0,
    })

    await first.finish(0, 0)

    for (let n = 1; n <= 20; n++) {
      const name = `00000000-0000${String(n).padStart(2, "0")}-0000`

      await writeFile(join(liveDir(root), `${name}.jsonl`), "{}\n")
    }

    const latest = await openLiveFeed(root, {
      id: "99999999-999999-9999",
      kind: "test",
      title: "",
      planned: 0,
    })

    await latest.finish(0, 0)

    const kept = await readdir(liveDir(root))

    expect(kept).toHaveLength(20)
    expect(kept).not.toContain("00000000-000000-0000.jsonl")
    expect(kept).toContain("99999999-999999-9999.jsonl")
  })

  it("shows a step's actions, cache and error on one line", () => {
    expect(
      liveStep(
        step({
          status: "failed",
          error: { code: "ASSERTION_FAILED", message: "no receipt\nmore detail" },
          cache: { mode: "replayed" },
        }),
      ),
    ).toEqual({
      index: 0,
      kind: "agent",
      api: "agent.act",
      label: "buy credits",
      status: "failed",
      durationMs: 40,
      actions: ["click Buy", "type 500"],
      error: "ASSERTION_FAILED: no receipt",
      cache: "replayed",
      usd: 0,
    })
  })

  it("drops a call's query string, where keys and tokens ride", () => {
    expect(liveCall(exchange({ path: "/v1/charges?api_key=sk_test_abc123" })).path).toBe(
      "/v1/charges",
    )
  })
})

describe("live tap", () => {
  it("sends each finished call once, then the attempt's end", () => {
    const calls: Exchange[] = [exchange({ id: "a" }), exchange({ id: "b", status: null })]
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tap reads only exchanges()
    const env = { proxy: { exchanges: () => calls } as unknown as Proxy } as WorkerEnvironment
    const sent: WorkerLiveEvent[] = []
    const tap = new LiveTap(
      { test: "t", attempt: "attempt-1" },
      env,
      { exchanges: 0, deliveries: 0 },
      (event) => sent.push(event),
    )

    tap.step(step({ status: "running" }))
    calls[1] = exchange({ id: "b", status: 503, fault: "503" })
    tap.end("passed", 50)

    expect(sent.map((event) => event.type)).toEqual([
      "attempt",
      "step",
      "call",
      "call",
      "attempt-end",
    ])
    expect(sent.filter((event) => event.type === "call").map((event) => event.call.id)).toEqual([
      "a",
      "b",
    ])
  })
})
