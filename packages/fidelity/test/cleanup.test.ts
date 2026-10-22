import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { CleanupLedger, type Created } from "../src/ledger.ts"
import type { FidelityProvider } from "../src/provider.ts"
import { clerkFidelity } from "../src/providers/clerk.ts"
import { stripeFidelity } from "../src/providers/stripe.ts"
import { fidelityPassed, formatFidelity, runFidelity } from "../src/run.ts"
import { runScenario, type Scenario, type Target } from "../src/scenario.ts"
import { asJsonObject, type Json, readJson } from "../src/shape.ts"
import { formatSweep, sweepFidelity } from "../src/sweep.ts"
import { formBody } from "../src/target.ts"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const STRIPE = "https://api.stripe.com"
const CLERK = "https://api.clerk.com/v1"

/** An undo that answers `statuses` in turn, recording each call under `name` in `calls`. */
function undoing(name: string, calls: string[], ...statuses: number[]): Created["undo"] {
  let call = 0

  return () => {
    calls.push(name)

    const status = statuses[Math.min(call++, statuses.length - 1)] ?? 200

    return Promise.resolve(new Response(`{"status":${status}}`, { status }))
  }
}

/** A target that answers every request with 200 and an empty object. */
const quiet: Target = {
  kind: "live",
  credentials: {},
  send: () => Promise.resolve(Response.json({})),
}

/** A field of a JSON answer, or undefined. */
function fieldOf(body: Json, name: string): Json | undefined {
  return asJsonObject(body)?.[name]
}

/** An answer's `id`, which the test expects to be there. */
async function idOf(answer: Response): Promise<string> {
  const id = fieldOf(await readJson(answer), "id")

  if (typeof id !== "string") throw new Error("the answer has no id")

  return id
}

/** A provider whose one scenario makes a widget whose undo answers `undoStatus`. */
function leaky(undoStatus: number): FidelityProvider {
  return {
    name: "leaky",
    credentials: [],
    scenarios: [
      {
        name: "makes one",
        run(context) {
          context.created({
            kind: "widget",
            id: "w_1",
            undo: () => Promise.resolve(new Response("nope", { status: undoStatus })),
          })

          return Promise.resolve()
        },
      },
    ],
    emulator: () => Promise.resolve({ ...quiet, kind: "emulator", close: async () => {} }),
    live: () => quiet,
  }
}

/** A provider like `real` whose sandbox is the given emulator target. */
function onEmulator(real: FidelityProvider, target: Target): FidelityProvider {
  return { ...real, live: () => target }
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id)
}

/** Sends to an emulator target with its own key, as Stripe or Clerk would be called. */
function caller(target: Target, base: string, form: boolean) {
  const headers = {
    authorization: `Bearer ${target.credentials["key"] ?? ""}`,
    "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
  }

  return {
    post: async (path: string, values: Record<string, unknown>): Promise<string> =>
      idOf(
        await target.send(
          new Request(`${base}${path}`, {
            method: "POST",
            headers,
            body: form ? formBody(values) : JSON.stringify(values),
          }),
        ),
      ),
    get: async (path: string): Promise<{ status: number; body: Json }> => {
      const answer = await target.send(new Request(`${base}${path}`, { headers }))

      return { status: answer.status, body: await readJson(answer) }
    },
    remove: (path: string): Request => new Request(`${base}${path}`, { method: "DELETE", headers }),
  }
}

describe("the cleanup ledger", () => {
  it("undoes newest first", async () => {
    const calls: string[] = []
    const ledger = new CleanupLedger()

    for (const name of ["customer", "product", "price"])
      ledger.add({ kind: name, id: name, undo: undoing(name, calls, 200) })

    expect(await ledger.drain()).toEqual([])
    expect(calls).toEqual(["price", "product", "customer"])
    expect(ledger.undone).toBe(3)
  })

  it("counts a 404 as already gone, retries a failure once, and reports what still stands", async () => {
    const calls: string[] = []
    const ledger = new CleanupLedger()

    ledger.add({ kind: "gone", id: "1", undo: undoing("gone", calls, 404) })
    ledger.add({ kind: "flaky", id: "2", undo: undoing("flaky", calls, 500, 200) })
    ledger.add({ kind: "stuck", id: "3", undo: undoing("stuck", calls, 500, 503) })
    ledger.add({
      kind: "final",
      id: "4",
      undo: undoing("final", calls, 400),
      settled: (status, body) => status === 400 && body.includes("400"),
    })

    const left = await ledger.drain()

    expect(left).toEqual([{ kind: "stuck", id: "3", reason: '503 {"status":503}' }])
    expect(calls).toEqual(["final", "stuck", "stuck", "flaky", "flaky", "gone"])
  })

  it("drops an undo whose create was refused, leaving nothing behind", async () => {
    const calls: string[] = []
    const refused: Target = {
      kind: "live",
      credentials: {},
      send: () =>
        Promise.resolve(Response.json({ error: { code: "BadRequest" } }, { status: 400 })),
    }
    const scenario: Scenario = {
      name: "a refused create",
      async run(context) {
        const created = await context.step("create an event", new Request("https://example.test"))
        const id = fieldOf(created.body, "id")

        context.created({
          kind: "event",
          id: typeof id === "string" ? id : "",
          undo: undoing("event", calls, 400),
        })
      },
    }
    const run = await runScenario(scenario, refused)

    expect(calls).toEqual([])
    expect(run.leftBehind).toBeUndefined()
    expect(run.undone).toBeUndefined()
  })

  it("keeps everything when asked, undoing nothing", () => {
    const calls: string[] = []
    const ledger = new CleanupLedger()

    ledger.add({ kind: "customer", id: "cus_1", undo: undoing("customer", calls, 200) })

    expect(ledger.keep()).toEqual([{ kind: "customer", id: "cus_1", reason: "kept" }])
    expect(calls).toEqual([])
  })
})

describe("a scenario's cleanup", () => {
  it("runs when the scenario throws, and tags what it makes", async () => {
    const calls: string[] = []
    let tag = ""
    const scenario: Scenario = {
      name: "throws midway",
      run(context) {
        tag = context.tag
        context.created({ kind: "first", id: "1", undo: undoing("first", calls, 200) })
        context.created({ kind: "second", id: "2", undo: undoing("second", calls, 200) })

        return Promise.reject(new Error("the provider answered something unexpected"))
      },
    }
    const run = await runScenario(scenario, quiet)

    expect(run.error).toBe("the provider answered something unexpected")
    expect(calls).toEqual(["second", "first"])
    expect(run.leftBehind).toBeUndefined()
    expect(run.undone).toBe(2)
    expect(tag).toMatch(/^danwo-fidelity-[0-9a-z]+$/)
  })

  it("leaves everything in place with keep, reported as kept", async () => {
    const calls: string[] = []
    const scenario: Scenario = {
      name: "makes one",
      run(context) {
        context.created({ kind: "customer", id: "cus_1", undo: undoing("customer", calls, 200) })

        return Promise.resolve()
      },
    }
    const run = await runScenario(scenario, quiet, { keep: true })

    expect(calls).toEqual([])
    expect(run.leftBehind).toEqual([{ kind: "customer", id: "cus_1", reason: "kept" }])
  })

  it("deletes a customer on the Stripe emulator although the scenario then throws", async () => {
    const target = await stripeFidelity.emulator()
    const stripe = caller(target, STRIPE, true)
    let id = ""
    const scenario: Scenario = {
      name: "creates, then fails",
      async run(context) {
        id = await stripe.post("/v1/customers", { email: `${context.tag}@example.com` })
        context.created({
          kind: "customer",
          id,
          undo: () => context.target.send(stripe.remove(`/v1/customers/${id}`)),
        })
        throw new Error("a later step failed")
      },
    }

    try {
      const run = await runScenario(scenario, target)
      const after = await stripe.get(`/v1/customers/${id}`)

      expect(run.error).toBe("a later step failed")
      expect(run.leftBehind).toBeUndefined()
      expect(fieldOf(after.body, "deleted")).toBe(true)
    } finally {
      await target.close()
    }
  })
})

describe("a live run that leaves something behind", () => {
  it("fails, and lists it under left behind", async () => {
    const reports = await runFidelity({ root, providers: [leaky(500)], env: {} })
    const lines = formatFidelity(reports)

    expect(fidelityPassed(reports)).toBe(false)
    expect(lines).toContain("  left behind (could not be undone):")
    expect(lines).toContain("    widget w_1: 500 nope")
    expect(lines.at(-1)).toMatch(/^left behind: 1 object\(s\)/)
  })

  it("passes with keep, listing it as kept", async () => {
    const reports = await runFidelity({ root, providers: [leaky(500)], env: {}, keep: true })

    expect(fidelityPassed(reports)).toBe(true)
    expect(formatFidelity(reports)).toContain("    widget w_1: kept")
  })

  it("says what it cleaned up when everything was undone", async () => {
    const reports = await runFidelity({ root, providers: [leaky(200)], env: {} })

    expect(fidelityPassed(reports)).toBe(true)
    expect(formatFidelity(reports).at(-1)).toBe(
      "cleaned up: 1 object(s) undone, nothing left behind",
    )
  })
})

describe("the sweep", () => {
  it("finds tagged Stripe leftovers, lists untagged look-alikes, and removes only the tagged", async () => {
    const target = await stripeFidelity.emulator()
    const stripe = caller(target, STRIPE, true)

    try {
      const tagged = await stripe.post("/v1/customers", { email: "danwo-fidelity-abc@example.com" })
      const old = await stripe.post("/v1/customers", { email: "fidelity+abc@example.com" })
      const someone = await stripe.post("/v1/customers", { email: "ada@example.com" })
      const product = await stripe.post("/v1/products", { name: "danwo-fidelity-abc plan" })
      const providers = [onEmulator(stripeFidelity, target)]
      const listed = await sweepFidelity({ providers, env: {} })
      const found = (listed[0]?.found ?? []).map(({ kind, id, tagged: t }) => ({
        kind,
        id,
        tagged: t,
      }))

      expect(found.toSorted(byId)).toEqual(
        [
          { kind: "customer", id: tagged, tagged: true },
          { kind: "customer", id: old, tagged: false },
          { kind: "product", id: product, tagged: true },
        ].toSorted(byId),
      )
      expect(formatSweep(listed, false).at(-1)).toBe(
        "run again with --yes to remove the tagged leftovers",
      )

      const swept = await sweepFidelity({ providers, env: {}, yes: true })

      expect(swept[0]?.failed).toEqual([])
      expect(fieldOf((await stripe.get(`/v1/customers/${tagged}`)).body, "deleted")).toBe(true)
      expect(fieldOf((await stripe.get(`/v1/customers/${old}`)).body, "deleted")).toBeUndefined()
      expect(
        fieldOf((await stripe.get(`/v1/customers/${someone}`)).body, "deleted"),
      ).toBeUndefined()
      expect(fieldOf((await stripe.get(`/v1/products/${product}`)).body, "active")).toBe(false)
    } finally {
      await target.close()
    }
  })

  it("finds tagged Clerk users and organizations, and leaves untagged ones alone", async () => {
    const target = await clerkFidelity.emulator()
    const clerk = caller(target, CLERK, false)

    try {
      const tagged = await clerk.post("/users", {
        email_address: ["danwo-fidelity-userabc+clerk_test@example.com"],
      })
      const old = await clerk.post("/users", { email_address: ["userabc+clerk_test@example.com"] })
      const org = await clerk.post("/organizations", {
        name: "danwo-fidelity-abc",
        created_by: tagged,
      })
      const providers = [onEmulator(clerkFidelity, target)]
      const swept = await sweepFidelity({ providers, env: {}, yes: true })
      const found = swept[0]?.found ?? []

      expect(found.filter((item) => item.tagged).map((item) => item.id)).toEqual([org, tagged])
      expect(found.filter((item) => !item.tagged).map((item) => item.id)).toEqual([old])
      expect((await clerk.get(`/users/${tagged}`)).status).toBe(404)
      expect((await clerk.get(`/organizations/${org}`)).status).toBe(404)
      expect((await clerk.get(`/users/${old}`)).status).toBe(200)
    } finally {
      await target.close()
    }
  })

  it("says why a provider with nothing to find is not swept", async () => {
    const reports = await sweepFidelity({
      providers: [{ ...leaky(200), name: "nothing", leaves: "nothing: the suite only reads" }],
      env: {},
    })

    expect(formatSweep(reports, false)[0]).toBe(
      "nothing: not swept (nothing: the suite only reads)",
    )
  })
})
