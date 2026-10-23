/**
 * A journey of agent steps recorded once and replayed: creating a task, assigning it through a
 * member picker that opens in a portal after a delay, a claim about the result, and a count read
 * off the page. The replay must make no model call at all, and a page that really changed must
 * still go back to the model, saying why.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV4 } from "ai/test"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import type { StepRecord } from "../src/record/index.ts"
import { openWebSession, type WebSession } from "../src/session.ts"
import { startMembersBoard, type MembersBoard } from "./fixtures/members-board.ts"
import { call, text } from "./fixtures/scripted.ts"

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

const TITLE = "Review Q3 plan"

function answer(value: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  }
}

/** The ref of the first line of the view that has `role` and holds `name`, or undefined. */
function refOf(view: string, role: string, name: string): string | undefined {
  const line = view.split("\n").find((entry) => entry.includes(`- ${role}`) && entry.includes(name))

  return line === undefined ? undefined : /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]
}

/** The tools called so far in the conversation, in order. */
function toolsCalled(options: LanguageModelV4CallOptions): string[] {
  return options.prompt.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) => ("toolName" in part ? [part.toolName] : []))
      : [],
  )
}

/** The latest page the conversation shows. */
function latest(conversation: string): string {
  return conversation.slice(conversation.lastIndexOf("The page now:"))
}

function create(view: string, done: readonly string[]): LanguageModelV4GenerateResult {
  if (done.length === 0) return call("click", { ref: refOf(view, "button", "Add task") })
  if (done.length === 1)
    return call("fill", {
      ref: refOf(view, "textbox", "Task title"),
      text: TITLE,
    })
  if (done.length === 2) return call("click", { ref: refOf(view, "button", "Create") })

  return call("done", { status: "passed", summary: `created ${TITLE}` })
}

/** Opens the task's members and picks the Babbage among them, waiting for the options to load. */
function assign(view: string, done: readonly string[]): LanguageModelV4GenerateResult {
  if (
    done.filter((tool) => tool === "click").length >= 2 ||
    /Assigned: [A-Za-z]+ Babbage/.test(view)
  )
    return call("done", {
      status: "passed",
      summary: `assigned ${TITLE} to Bob`,
    })

  const bob = refOf(view, "option", "Babbage")

  if (bob !== undefined) return call("click", { ref: bob })
  if (done.includes("click")) return call("wait_for", { text: "Babbage" })

  return call("click", { ref: refOf(view, "button", `Members of ${TITLE}`) })
}

/** The judge: the claim holds while the page says who is assigned, and names that line. */
function verdict(view: string): LanguageModelV4GenerateResult {
  const shown = /Assigned: [A-Za-z]+ Babbage/.exec(view)?.[0]

  return shown === undefined
    ? answer({ verdict: "fails", reason: "the task is unassigned" })
    : answer({ verdict: "holds", reason: "Bob is shown", evidence: shown })
}

/** Reads the count line when the page has one, else counts the task rows. */
function count(view: string): LanguageModelV4GenerateResult {
  const line = refOf(view, "paragraph", "task")

  return call("read", {
    fields: [
      line === undefined
        ? { path: "", ref: refOf(view, "listitem", ""), as: "count" }
        : { path: "", ref: line, as: "number" },
    ],
  })
}

/**
 * One model for every agent step: it tells the steps apart by the instruction in the conversation
 * and acts, judges or reads accordingly.
 */
function boardModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "board",
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const conversation = text(options.prompt.filter((message) => message.role !== "system"))
      const system = text(options.prompt.filter((message) => message.role === "system"))
      const view = latest(conversation)
      const done = toolsCalled(options)

      if (/verdict/i.test(system)) return verdict(view)
      if (conversation.includes("Extract: how many tasks"))
        return call("read", {
          fields: [{ path: "", ref: refOf(view, "listitem", ""), as: "count" }],
        })
      if (conversation.includes("Extract: the number of tasks")) return count(view)
      if (conversation.includes("create a task called")) return create(view, done)

      return assign(view, done)
    },
  })
}

let board: MembersBoard
let dir: string

beforeAll(async () => {
  board = await startMembersBoard()
})

afterAll(async () => {
  await board.close()
})

beforeEach(async () => {
  board.reset()
  dir = await mkdtemp(join(tmpdir(), "danwo-board-"))

  return () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The agent steps' cache notes, by label. */
function notes(steps: readonly StepRecord[]): Record<string, StepRecord["cache"]> {
  return Object.fromEntries(
    steps.filter((step) => step.kind === "agent").map((step) => [step.label, step.cache]),
  )
}

function outcomes(steps: readonly StepRecord[]): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(notes(steps)).map(([label, note]) => [label, note?.mode]),
  )
}

/** How long a check waits; on the slower Windows runner, 2 s once missed an assignment that landed. */
const ASSERTION_MS = process.platform === "win32" ? 8_000 : 2_000

/** Runs `journey` in a session on a fresh board that keeps its recordings in the test's folder. */
async function run<T>(
  model: MockLanguageModelV4,
  steps: (session: WebSession) => Promise<T>,
  options: { readonly relocation?: "exact" } = {},
): Promise<{ result: T; steps: readonly StepRecord[] }> {
  const cache = {
    dir,
    mode: "read-write" as const,
    journey: "assign",
    appIdentity: "board",
  }
  const session = await openWebSession({
    baseUrl: board.url,
    model,
    cache,
    assertionTimeout: ASSERTION_MS,
    ...options,
  })

  try {
    await session.app.open("/")

    return { result: await steps(session), steps: session.flight.steps() }
  } finally {
    await session.close()
  }
}

async function journey(session: WebSession): Promise<number> {
  await session.agent.act(`create a task called ${TITLE}`)
  await session.agent.act(`assign ${TITLE} to Bob`)
  await session.agent.assert(`Bob is assigned to ${TITLE}`)

  return session.agent.extract("the number of tasks", z.number())
}

async function counting(session: WebSession): Promise<number> {
  return session.agent.extract("how many tasks the board lists", z.number())
}

async function reading(session: WebSession): Promise<number> {
  return session.agent.extract("the number of tasks", z.number())
}

/** Records the journey once, on a fresh board. */
async function record(): Promise<void> {
  const first = boardModel()
  const { result } = await run(first, journey)

  expect(result).toBe(1)
  expect(board.tasks()[0]?.assignee).toBe("Bob Babbage")
  expect(first.doGenerateCalls.length).toBeGreaterThan(0)
  board.reset()
}

describe("a recorded journey replays", () => {
  it("with no model calls: act through a portal popover, assert and extract", async () => {
    await record()

    const second = boardModel()
    const { result, steps } = await run(second, journey)

    expect(result).toBe(1)
    expect(board.tasks()[0]?.assignee).toBe("Bob Babbage")
    expect(outcomes(steps)).toEqual({
      [`create a task called ${TITLE}`]: "replayed",
      [`assign ${TITLE} to Bob`]: "replayed",
      [`Bob is assigned to ${TITLE}`]: "replayed",
      "the number of tasks": "replayed",
    })
    expect(second.doGenerateCalls.length).toBe(0)
  }, 120_000)

  it("counts what the page lists when no text says how many, and counts again on replay", async () => {
    board.add(TITLE)

    const first = boardModel()
    const recorded = await run(first, counting)

    expect(recorded.result).toBe(1)
    expect(notes(recorded.steps)["how many tasks the board lists"]).toEqual({
      mode: "missed",
      saved: true,
    })

    board.add("Plan Q4")

    const second = boardModel()
    const replayed = await run(second, counting)

    expect(replayed.result).toBe(2)
    expect(outcomes(replayed.steps)).toEqual({
      "how many tasks the board lists": "replayed",
    })
    expect(second.doGenerateCalls.length).toBe(0)
  }, 60_000)
})

describe("a replay of a page that really changed", () => {
  it("goes back to the model for each step that no longer matches, and says why", async () => {
    await record()
    board.look({ members: ["Ada Lovelace", "Robert Babbage"] })

    const second = boardModel()
    const { result, steps } = await run(second, journey)
    const seen = notes(steps)

    expect(result).toBe(1)
    expect(board.tasks()[0]?.assignee).toBe("Robert Babbage")
    expect(outcomes(steps)).toEqual({
      [`create a task called ${TITLE}`]: "replayed",
      [`assign ${TITLE} to Bob`]: "relocated",
      [`Bob is assigned to ${TITLE}`]: "handed-off",
      "the number of tasks": "replayed",
    })
    expect(seen[`Bob is assigned to ${TITLE}`]).toEqual({
      mode: "handed-off",
      reason: `"Assigned: Bob Babbage" was not shown within ${ASSERTION_MS} ms`,
      saved: true,
    })
    expect(second.doGenerateCalls.length).toBeGreaterThan(0)
  }, 120_000)

  it("keeps what the replay did before the model took over in the new recording", async () => {
    const exact = { relocation: "exact" } as const

    await run(boardModel(), journey, exact)
    board.reset()
    board.look({ members: ["Ada Lovelace", "Robert Babbage"] })

    const second = await run(boardModel(), journey, exact)

    expect(notes(second.steps)[`assign ${TITLE} to Bob`]).toMatchObject({
      mode: "handed-off",
      reason: expect.stringMatching(
        /^action 3 \(click\): getByRole\("option", name: "Bob Babbage"\)/,
      ),
    })
    expect(board.tasks()[0]?.assignee).toBe("Robert Babbage")
    board.reset()
    board.look({ members: ["Ada Lovelace", "Robert Babbage"] })

    const third = boardModel()
    const { result, steps } = await run(third, journey, exact)

    expect(result).toBe(1)
    expect(board.tasks()[0]?.assignee).toBe("Robert Babbage")
    expect(outcomes(steps)[`assign ${TITLE} to Bob`]).toBe("replayed")
    expect(third.doGenerateCalls.length).toBe(0)
  }, 180_000)

  it("reads a value again through the model when the element it was read from is gone", async () => {
    board.add(TITLE)
    await run(boardModel(), reading)
    board.look({ count: false })

    const second = boardModel()
    const { result, steps } = await run(second, reading)

    expect(result).toBe(1)
    expect(notes(steps)["the number of tasks"]).toEqual({
      mode: "handed-off",
      reason: 'getByText("1 task") is no longer shown',
      saved: true,
    })
    expect(second.doGenerateCalls.length).toBe(1)
  }, 60_000)

  it("fails a claim whose recorded evidence is gone, asking the judge again", async () => {
    await record()

    const second = boardModel()
    const failed = await run(second, async (session) => {
      await session.agent.act(`create a task called ${TITLE}`)

      return session.agent.assert(`Bob is assigned to ${TITLE}`).catch((error: unknown) => error)
    })

    expect(failed.result).toMatchObject({ code: "CLAIM_FAILED" })
    expect(notes(failed.steps)[`Bob is assigned to ${TITLE}`]).toMatchObject({
      mode: "handed-off",
      reason: expect.stringMatching(/was not shown/),
    })
    expect(second.doGenerateCalls.length).toBe(1)
  }, 120_000)
})
