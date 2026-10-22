import { existsSync, readdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "../../cli/test/work-copy.ts"
import { connect, PANTRY, resultOf, textOf } from "./client.ts"
import { PANTRY_SECRET } from "./fixtures/pantry/site.ts"

const SHOP = workCopy(fileURLToPath(new URL("../../../examples/shop", import.meta.url)))
const LONG = { timeout: 120_000 }

/** Calls a tool and answers with its text; fails the test when the tool reports an error. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = resultOf(
    await client.callTool({ name, arguments: args }, CallToolResultSchema, LONG),
  )
  const text = textOf(result)

  if (result.isError === true) throw new Error(`${name} failed: ${text}`)

  return text
}

/** Calls a tool that should fail, and answers with its error text. */
async function refused(client: Client, name: string, args: Record<string, unknown>) {
  const result = resultOf(
    await client.callTool({ name, arguments: args }, CallToolResultSchema, LONG),
  )

  expect(result.isError).toBe(true)

  return textOf(result)
}

function sessionOf(opened: string): string {
  return /session (s\d+) is open/.exec(opened)?.[1] ?? ""
}

// Every run writes into the fixture's copy; the copies go when the file is done.
afterAll(removeWorkCopies)

describe("a live session on the shop", () => {
  let client: Client
  let session: string

  beforeAll(async () => {
    client = await connect(SHOP)
    session = sessionOf(await call(client, "open_session", {}))
  }, 120_000)

  afterAll(async () => {
    await call(client, "close_session", { session }).catch(() => undefined)
    await client.close()
  })

  it("opens on the app with refs to act on", async () => {
    expect(session).toBe("s1")
    expect(await call(client, "snapshot", { session })).toMatch(
      /button "Buy 500 credits" \[ref=(?:f\d+)?e\d+\]/,
    )
  })

  it("checks locators: one match, none, several", async () => {
    const one = await call(client, "check_locator", {
      session,
      locator: 'getByRole("button", { name: "Buy 500 credits" })',
    })
    const none = await call(client, "check_locator", {
      session,
      locator: 'screen.getByRole("button", { name: "Buy 50 credit" , exact: true })',
    })

    expect(one).toContain("matches exactly 1 element")
    expect(one).toContain('use in a test: screen.getByRole("button", { name: "Buy 500 credits" })')
    expect(none).toContain("matches no element")
    expect(none).toContain('screen.getByRole("button", { name: "Buy 500 credits" })')
    expect(
      await call(client, "check_locator", { session, locator: "getByText(/credit/i)" }),
    ).toMatch(/matches \d+ elements\. A test that clicks or fills with it would fail/)
  })

  it("buys credits, sees the Stripe call, delivers the webhook and sees the credits", async () => {
    const clicked = await call(client, "click", {
      session,
      target: 'getByRole("button", { name: "Buy 500 credits" })',
    })

    expect(clicked).toContain('clicked screen.getByRole("button", { name: "Buy 500 credits" })')
    expect(clicked).toMatch(/url: https:\/\/checkout\.stripe\.com\/.* \(was http/)
    expect(await call(client, "exchanges", { session })).toMatch(
      /POST api\.stripe\.com\/v1\/checkout\/sessions → 200/,
    )

    const paid = await call(client, "click", { session, target: 'getByTestId("checkout-pay")' })

    expect(paid).toContain("Thank you for your purchase")
    expect(await call(client, "deliver_webhooks", { session })).toMatch(
      /checkout\.session\.completed attempt 1 → 200/,
    )
    expect(await call(client, "navigate", { session, to: "reload" })).toContain("Credits: 500")
    expect(await call(client, "emulator_state", { session, emulator: "stripe" })).toMatch(
      /checkout_sessions 1/,
    )
  })

  it("injects faults the matrix would, and shows them fire", async () => {
    const armed = await call(client, "inject_fault", {
      session,
      fault: "duplicate on webhook checkout.session.completed",
    })

    expect(armed).toContain("armed: duplicate on webhook checkout.session.completed")
    await call(client, "navigate", { session, to: "/" })
    await call(client, "click", {
      session,
      target: 'getByRole("button", { name: "Buy 500 credits" })',
    })
    await call(client, "click", { session, target: 'getByTestId("checkout-pay")' })

    const delivered = await call(client, "deliver_webhooks", { session })

    expect(delivered).toContain("[fault: duplicate]")
    /* The shop handles the duplicated event once: two purchases make 1000 credits, not 1500. */
    expect(await call(client, "navigate", { session, to: "reload" })).toContain("Credits: 1000")

    await call(client, "inject_fault", {
      session,
      fault: "status 500 on POST api.stripe.com/v1/checkout/sessions",
    })
    await call(client, "navigate", { session, to: "/" })
    await call(client, "click", {
      session,
      target: 'getByRole("button", { name: "Buy 500 credits" })',
    })
    expect(await call(client, "exchanges", { session })).toMatch(
      /POST api\.stripe\.com\/v1\/checkout\/sessions → 500 .*\[fault: status 500\]/,
    )
    expect(await call(client, "clear_faults", { session })).toBe("no faults were armed")
    expect(
      await refused(client, "inject_fault", { session, fault: "explode on POST x" }),
    ).toContain("cannot read the fault")
  })
})

describe("live sessions on the pantry", () => {
  let client: Client

  beforeAll(async () => {
    await rm(join(PANTRY, ".danwo", "sessions"), { recursive: true, force: true })
    client = await connect(PANTRY, { sessions: { max: 2 } })
  })

  afterAll(async () => {
    await client.close()
  })

  it("fills a secret by name and never shows its value", async () => {
    const session = sessionOf(await call(client, "open_session", { path: "/unlock" }))
    const answers = [
      await call(client, "fill_secret", {
        session,
        target: 'getByLabel("Pantry key")',
        secret: "pantryKey",
      }),
      await call(client, "screenshot", { session }),
      await call(client, "click", { session, target: 'getByRole("button", { name: "Unlock" })' }),
      await call(client, "navigate", { session, to: "/" }),
      await call(client, "snapshot", { session }),
      await refused(client, "start_recording", { session, video: true }),
    ]
    const shot = resultOf(
      await client.callTool({ name: "screenshot", arguments: { session } }, CallToolResultSchema),
    )

    expect(answers[0]).toContain('filled secret "pantryKey" into screen.getByLabel("Pantry key")')
    expect(answers[4]).toContain("Signed with [secret pantryKey]")
    expect(answers[5]).toContain("a video cannot mask it")
    expect(shot.content.some((part) => part.type === "image")).toBe(true)
    for (const text of answers) expect(text).not.toContain(PANTRY_SECRET)

    await call(client, "close_session", { session })
  })

  it("runs two sessions side by side, up to the limit", async () => {
    const [first, second] = await Promise.all([
      call(client, "open_session", {}),
      call(client, "open_session", { path: "/basket" }),
    ])
    const a = sessionOf(first)
    const b = sessionOf(second)

    expect(new Set([a, b]).size).toBe(2)
    expect(await refused(client, "open_session", {})).toContain("2 sessions are open, the limit")
    expect(
      await call(client, "click", {
        session: a,
        target: 'getByRole("link", { name: "Add oats" })',
      }),
    ).toContain('heading "Basket"')
    expect(await call(client, "snapshot", { session: b })).toContain("1 item: Oats")

    await Promise.all([a, b].map((session) => call(client, "close_session", { session })))
    expect(await refused(client, "snapshot", { session: a })).toContain(`session ${a} is closed`)
  })

  it("refuses a device session on a project whose environment has no device", async () => {
    expect(await refused(client, "open_session", { device: true })).toContain(
      "the project's environment has no device",
    )
  })

  it("records screenshots of a session", async () => {
    const session = sessionOf(await call(client, "open_session", {}))

    expect(await call(client, "start_recording", { session })).toContain(
      `recording into .danwo/sessions/${session}/`,
    )
    await call(client, "click", { session, target: 'getByRole("link", { name: "Add oats" })' })
    expect(await call(client, "stop_recording", { session })).toContain("recorded 3 screenshots")
    expect(readdirSync(join(PANTRY, ".danwo", "sessions", session))).toEqual([
      "001-start.png",
      "002-click.png",
      "003-stop.png",
    ])
    await call(client, "close_session", { session })
  })

  it("records a video, and refuses a secret while it does", async () => {
    const session = sessionOf(await call(client, "open_session", { path: "/unlock" }))

    expect(await call(client, "start_recording", { session, video: true })).toContain("and a video")
    expect(
      await refused(client, "fill_secret", {
        session,
        target: 'getByLabel("Pantry key")',
        secret: "pantryKey",
      }),
    ).toContain("cannot mask a secret")

    const stopped = await call(client, "stop_recording", { session })
    const video = /video: (\S+\.webm)/.exec(stopped)?.[1] ?? ""

    expect(existsSync(video)).toBe(true)
    await call(client, "close_session", { session })
  })
})

describe("an idle session", () => {
  it("closes by itself", async () => {
    const client = await connect(PANTRY, { sessions: { idleMs: 1_500 } })
    const session = sessionOf(await call(client, "open_session", {}))

    await new Promise((resolve) => setTimeout(resolve, 4_000))
    expect(await refused(client, "snapshot", { session })).toContain("no calls for 1500 ms")
    await client.close()
  }, 60_000)
})
