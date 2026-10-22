import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listeningPort } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startServices } from "../src/runner/services.ts"
import { stripeService } from "../src/runner/stripe.ts"
import { openWebSession } from "../src/session.ts"
import { describeSpan, spanMs, timeMachineOf } from "../src/time/index.ts"
import { scripted } from "./fixtures/scripted.ts"

const DAY = 86_400_000

/** A page that prints its own clock. */
let site: Server
let siteUrl: string

beforeAll(async () => {
  site = createServer((request, response) => {
    response.setHeader("content-type", "text/html")

    if (request.url === "/cookies") {
      /* Sets a cookie for a year, or deletes it the usual way, with a date a day before "now". */
      response.end(
        `<!doctype html><title>Cookies</title><output></output>` +
          `<button onclick="document.cookie = 'kept=1; path=/; expires=' + new Date(Date.now() + 365 * 864e5).toUTCString(); show()">Set</button>` +
          `<button onclick="document.cookie = 'kept=; path=/; expires=' + new Date(Date.now() - 864e5).toUTCString(); show()">Delete</button>` +
          `<script>function show() { document.querySelector("output").textContent = document.cookie || "none" } show()</script>`,
      )

      return
    }

    response.end(
      `<!doctype html><title>Clock</title><h1 id="now"></h1>` +
        `<script>setInterval(() => { document.getElementById("now").textContent = String(Date.now()) }, 20)</script>`,
    )
  })
  site.listen(0, "127.0.0.1")
  await once(site, "listening")
  siteUrl = `http://127.0.0.1:${listeningPort(site)}`
})

afterAll(() => {
  site.close()
})

describe("spans", () => {
  it("adds up days, hours, minutes and seconds, and names them", () => {
    expect(spanMs({ days: 1, hours: 2, minutes: 3, seconds: 4, ms: 5 })).toBe(
      DAY + 2 * 3_600_000 + 3 * 60_000 + 4_000 + 5,
    )
    expect(describeSpan(15 * DAY + 2 * 3_600_000)).toBe("15d 2h")
    expect(describeSpan(0)).toBe("0ms")
  })
})

describe("travelling services", () => {
  it("moves the apps' clock offset and every emulator's clock, running due work in order", async () => {
    const stripe = stripeService()
    const services = await startServices([stripe])

    try {
      const ran: string[] = []
      const start = stripe.clock.clock().getTime()

      stripe.clock.timer.setTimeout(() => ran.push("renewal at 14d"), 14 * DAY)
      stripe.clock.timer.setTimeout(() => ran.push("retry at 17d"), 17 * DAY)
      stripe.clock.timer.setTimeout(() => ran.push("not yet at 60d"), 60 * DAY)

      await services.travel(30 * DAY)

      expect(ran).toEqual(["renewal at 14d", "retry at 17d"])
      expect(stripe.clock.clock().getTime() - start).toBe(30 * DAY)
      expect(services.proxy.clock.offset()).toBe(30 * DAY)

      await services.settle()

      expect(ran).toEqual(["renewal at 14d", "retry at 17d"])

      await services.reset()

      expect(services.proxy.clock.offset()).toBe(0)
      expect(Math.abs(stripe.clock.clock().getTime() - Date.now())).toBeLessThan(5_000)
    } finally {
      await services.close()
    }
  })

  it("settles deliveries but leaves a background event minutes away for time travel", async () => {
    const stripe = stripeService()
    const services = await startServices([stripe])

    try {
      const ran: string[] = []
      const { timer } = stripe.clock

      timer.setTimeout(() => ran.push("trial ends at 5m"), 5 * 60_000, { background: true })
      timer.setTimeout(() => ran.push("retry at 1h"), 3_600_000)

      await services.settle()

      expect(ran).toEqual(["retry at 1h"])

      await services.travel(DAY)

      expect(ran).toEqual(["retry at 1h", "trial ends at 5m"])
    } finally {
      await services.close()
    }
  })
})

describe("a session's time", () => {
  it("shifts the page's clock with the app's, records the jump, and keeps page timers running", async () => {
    const services = await startServices([stripeService()])
    const session = await openWebSession({ baseUrl: siteUrl, time: timeMachineOf(services) })

    try {
      await session.app.open("/")
      await session.time.travel({ days: 2 })

      const shown = Number(await session.screen.getByRole("heading").innerText())

      expect(shown - Date.now()).toBeGreaterThan(2 * DAY - 5_000)
      expect(services.proxy.clock.offset()).toBe(2 * DAY)
      expect(session.time.now().getTime() - Date.now()).toBeGreaterThan(2 * DAY - 1_000)

      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(Number(await session.screen.getByRole("heading").innerText())).toBeGreaterThan(shown)
      expect(session.flight.steps().map((step) => `${step.api} ${step.label}`)).toContain(
        "time.travel 2d",
      )
      await expect(session.time.set(Date.now())).rejects.toThrow(/only moves forward/)
    } finally {
      await session.close()
      await services.close()
    }
  }, 60_000)

  it("lets a travelled page delete a cookie by giving it a date in its past", async () => {
    const session = await openWebSession({ baseUrl: siteUrl })

    try {
      await session.app.open("/cookies")
      await session.screen.getByRole("button", { name: "Set" }).click()
      await session.time.travel({ days: 8 })
      await session.app.open("/cookies")

      const shown = session.screen.getByRole("status")

      await session.expect(shown).toHaveText("kept=1")
      await session.screen.getByRole("button", { name: "Delete" }).click()
      await session.expect(shown).toHaveText("none")
      await session.app.open("/cookies")
      expect(await shown.innerText()).toBe("none")
    } finally {
      await session.close()
    }
  }, 60_000)

  it("travels the page's clock alone when nothing stands behind the app", async () => {
    const session = await openWebSession({ baseUrl: siteUrl })

    try {
      await session.app.open("/")
      await session.time.travel({ hours: 5 })

      const shown = Number(await session.screen.getByRole("heading").innerText())

      expect(shown - Date.now()).toBeGreaterThan(5 * 3_600_000 - 5_000)
    } finally {
      await session.close()
    }
  }, 60_000)
})

describe("the agent's travel_time", () => {
  it("moves time when the step allows it, and a replay travels the same way with no model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-time-"))
    const cache = { dir, mode: "read-write", journey: "time" } as const
    const wait = scripted([() => ["travel_time", { days: 3 }]])

    try {
      for (const model of [wait, scripted([])]) {
        const services = await startServices([stripeService()])
        const session = await openWebSession({
          baseUrl: siteUrl,
          time: timeMachineOf(services),
          model,
          cache,
        })

        try {
          await session.app.open("/")

          const result = await session.agent.act("wait until three days have passed", {
            time: true,
          })

          await session.expect(session.screen.getByRole("heading")).toHaveText(/\d+/)

          expect(services.proxy.clock.offset()).toBe(3 * DAY)
          expect(result.modelCalls).toBe(model === wait ? 2 : 0)
        } finally {
          await session.close()
          await services.close()
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 120_000)
})
