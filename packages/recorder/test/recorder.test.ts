import { describe, expect, it } from "vitest"

import { isVolatile, queriesFor, stablePath } from "../src/describe.ts"
import { resolveSteps } from "../src/finish.ts"
import {
  draftInvariant,
  type DraftFacts,
  recordedReport,
  renderTest,
  secretName,
} from "../src/index.ts"
import type { ResolvedStep, Step } from "../src/steps.ts"

const mark = (calls: number, deliveries = 0) => ({ calls, deliveries })

describe("choosing locators", () => {
  const facts = {
    role: "button",
    name: "Buy 500 credits",
    label: undefined,
    testId: "buy",
    text: "Buy 500 credits",
    tag: "button",
  }

  it("tries a role with its name first, then the label, the test id and the text", () => {
    expect(queriesFor(facts, []).map((query) => query.by)).toEqual([
      "role",
      "role",
      "testId",
      "text",
    ])
  })

  it("reads a text with numbers as its stable start", () => {
    const [query] = queriesFor(
      { ...facts, role: "paragraph", name: undefined, testId: undefined, text: "Credits: 500" },
      [],
    )

    expect(query).toEqual({ by: "text", value: /^Credits: / })
  })

  it("leaves out names that hold values that change between runs", () => {
    expect(isVolatile("Order ord_8f3kLm29xQ", [])).toBe(true)
    expect(isVolatile("Session cs_test_a1B2c3D4e5", [])).toBe(true)
    expect(isVolatile("Welcome, ada@danwo.test", ["ada@danwo.test"])).toBe(true)
    expect(isVolatile("Buy 500 credits", [])).toBe(false)
    expect(queriesFor({ ...facts, name: "Pay at 12:30", testId: undefined, text: "" }, [])).toEqual(
      [],
    )
  })

  it("keeps the query parameters of a page that stay the same", () => {
    expect(
      stablePath(
        new URL("http://app.test/done?user=u1&session=cs_test_M3EEZYDIvveszfVONMR3Gpa"),
        [],
      ),
    ).toBe("/done?user=u1")
  })
})

describe("secrets", () => {
  it("names a secret after its field's label", () => {
    expect(secretName("Password")).toBe("password")
    expect(secretName("Confirm password")).toBe("confirmPassword")
  })
})

describe("what each step caused", () => {
  const steps: Step[] = [
    { kind: "action", line: 'await app.open("/")', mark: mark(0) },
    { kind: "action", line: "await buy.click()", mark: mark(1) },
    { kind: "note", text: "pays next" },
    { kind: "action", line: "await pay.click()", mark: mark(3) },
  ]
  const activity = {
    calls: [
      "GET 127.0.0.1/",
      "POST api.stripe.com/v1/checkout/sessions",
      "GET checkout.stripe.com/checkout/:id",
      "POST checkout.stripe.com/checkout/:id/complete",
    ].map((signature) => ({ signature })),
    deliveries: [{ signature: "webhook checkout.session.completed" }],
  }

  it("gives each action the calls and deliveries until the next one, without the app's own pages", () => {
    const effects = resolveSteps(steps, activity, "127.0.0.1").map((step) => step.effects)

    expect(effects).toEqual([
      [],
      ["POST api.stripe.com/v1/checkout/sessions", "GET checkout.stripe.com/checkout/:id"],
      [],
      ["POST checkout.stripe.com/checkout/:id/complete", "webhook checkout.session.completed"],
    ])
  })
})

describe("drafting the invariant", () => {
  const credits: ResolvedStep = {
    step: {
      kind: "assert",
      line: 'await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 1000")',
      observed: {
        query: { by: "text", value: /^Credits: / },
        text: "Credits: 1000",
        path: "/done?user=u1",
      },
    },
    effects: [],
  }
  const paying: ResolvedStep = {
    step: { kind: "action", line: "await pay.click()", mark: mark(0) },
    effects: ["webhook checkout.session.completed"],
  }
  const base: DraftFacts = {
    steps: [paying, credits],
    fixtures: ["stripe", "proxy", "settle"],
    paidCheckouts: 2,
    calls: ["webhook checkout.session.completed"],
  }

  it("keeps a number the app showed in step with what Stripe was paid", () => {
    const plan = draftInvariant(base)

    expect(plan.preamble).toEqual(["const test = base.extend<StripeFixtures>()"])
    expect(plan.invariant?.fixtures).toEqual(["app", "screen", "stripe", "expect"])
    expect(plan.invariant?.body).toContain("expect(shown).toBe(500 * data.length)")
    expect(plan.invariant?.body).toContain('await app.open("/done?user=u1")')
  })

  it("lets a webhook's answer happen at most as often as recorded", () => {
    const plan = draftInvariant({
      steps: [],
      fixtures: ["slack", "proxy"],
      paidCheckouts: undefined,
      calls: ["webhook events:A0BOT", "POST slack.com/api/chat.postMessage"],
    })

    expect(plan.preamble).toEqual(["const test = base.extend<SlackFixtures>()"])
    expect(plan.invariant?.body.join("\n")).toContain(
      "expect(posted.length).toBeLessThanOrEqual(1)",
    )
  })

  it("lists what the recording saw when no rule fits", () => {
    const plan = draftInvariant({
      steps: [],
      fixtures: [],
      paidCheckouts: undefined,
      calls: ["POST api.resend.com/emails", "POST api.resend.com/emails"],
    })

    expect(plan.invariant).toBeUndefined()
    expect(plan.header).toContain("  POST api.resend.com/emails")
  })
})

describe("writing the file", () => {
  it("lays out imports, the test and its invariant", () => {
    const source = renderTest({
      header: ["Recorded."],
      imports: [{ from: "@danwo/sdk", names: ["test"] }],
      name: "buys",
      fixtures: ["app"],
      body: ['await app.open("/")', "", "// → POST api.stripe.com/v1/checkout/sessions"],
      invariant: { fixtures: [], body: ["expect(1).toBe(1)"] },
    })

    expect(source).toBe(
      [
        "/**",
        " * Recorded.",
        " */",
        'import { test } from "@danwo/sdk"',
        "",
        'test("buys", async ({ app }) => {',
        '  await app.open("/")',
        "",
        "  // → POST api.stripe.com/v1/checkout/sessions",
        "}).invariant(async () => {",
        "  expect(1).toBe(1)",
        "})",
        "",
      ].join("\n"),
    )
  })

  it("tells the person what to add to the config and what to run next", () => {
    const report = recordedReport({
      path: "/p/tests/a.danwo.ts",
      shown: "tests/a.danwo.ts",
      source: "",
      missingSecrets: [{ name: "adminPassword", purpose: "password" }],
      next: "danwo matrix tests/a.danwo.ts",
    })

    expect(report).toBe(
      [
        "wrote tests/a.danwo.ts",
        "Its secrets are filled by name; add them to danwo.config.ts:",
        '  secrets: { adminPassword: { value: process.env.ADMIN_PASSWORD, purpose: "password" } }',
        "next: danwo matrix tests/a.danwo.ts",
      ].join("\n"),
    )
  })
})
