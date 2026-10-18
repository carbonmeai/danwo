import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { compareShapes } from "../src/compare.ts"
import { applyKnown, compareRun } from "../src/golden.ts"
import {
  FIDELITY_PROVIDERS,
  fidelityPassed,
  formatFidelity,
  runFidelity,
  shapeOf,
} from "../src/index.ts"
import { LiveCredentialRefused } from "../src/provider.ts"
import { formBody } from "../src/target.ts"

const root = fileURLToPath(new URL("../../..", import.meta.url))

describe("shapes", () => {
  it("keeps structure, drops values, and keeps only literal paths' values", () => {
    const shape = shapeOf(
      {
        id: "cus_1",
        object: "customer",
        metadata: { a: "1" },
        items: [{ n: 1 }, { n: 2, x: null }],
        error: { code: "x" },
      },
      { literals: ["error.code"] },
    )

    expect(shape).toEqual({
      t: "object",
      keys: {
        id: { t: "string" },
        object: { t: "literal", v: "customer" },
        metadata: { t: "object", keys: {}, open: true },
        items: {
          t: "array",
          of: { t: "object", keys: { n: { t: "number" }, x: { t: "null" } }, optional: ["x"] },
        },
        error: { t: "object", keys: { code: { t: "literal", v: "x" } } },
      },
    })
  })
})

describe("comparing", () => {
  const expected = shapeOf(
    { a: "x", b: 1, error: { code: "resource_missing" } },
    { literals: ["error.code"] },
  )

  it("names missing and extra fields, type mismatches and error codes", () => {
    const actual = shapeOf(
      { a: 1, c: true, error: { code: "other" } },
      { literals: ["error.code"] },
    )

    expect(compareShapes(expected, actual).map((d) => `${d.kind} ${d.path}`)).toEqual([
      "type-mismatch a",
      "missing-field b",
      "error-code-mismatch error.code",
      "extra-field c",
    ])
  })

  it("matches an expanded object against the object alternative of a union", () => {
    const union = {
      t: "union" as const,
      of: [{ t: "string" as const }, shapeOf({ id: "x", amount: 1 })],
    }

    expect(compareShapes(union, shapeOf("ch_1"))).toEqual([])
    expect(compareShapes(union, shapeOf({ id: "ch_1" })).map((d) => d.kind)).toEqual([
      "missing-field",
    ])
  })

  it("compares steps by name and status, and facts by value, and accepts known differences", () => {
    const golden = {
      steps: [
        { step: "create", status: 200, shape: shapeOf({ a: "x" }) },
        { step: "read", status: 200, shape: shapeOf({}) },
      ],
      facts: [{ name: "newest first", value: true, kind: "ordering" as const }],
    }
    const actual = {
      steps: [{ step: "create", status: 400, shape: shapeOf({}) }],
      facts: [{ name: "newest first", value: false }],
    }
    const differences = compareRun(golden, actual, "s")

    expect(differences.map((d) => d.kind)).toEqual(["status-mismatch", "missing-step", "ordering"])

    const { counted, accepted } = applyKnown("p", differences, [
      { provider: "p", step: "read", kind: "missing-step", reason: "x" },
    ])

    expect(accepted).toHaveLength(1)
    expect(counted).toHaveLength(2)
  })
})

describe("credentials", () => {
  it("refuses live Stripe keys and runs without credentials offline", () => {
    const stripe = FIDELITY_PROVIDERS.find((provider) => provider.name === "stripe")

    expect(() => stripe?.live({ DANWO_FIDELITY_STRIPE_KEY: "sk_live_abc" })).toThrow(
      LiveCredentialRefused,
    )
    expect(stripe?.live({})).toBeUndefined()
    expect(stripe?.live({ DANWO_FIDELITY_STRIPE_KEY: "sk_test_abc" })?.kind).toBe("live")
  })

  it.each([
    ["paystack", "DANWO_FIDELITY_PAYSTACK_KEY", "sk_live_abc", "sk_test_abc"],
    ["flutterwave", "DANWO_FIDELITY_FLUTTERWAVE_KEY", "REDACTED-TEST-VALUE", "REDACTED-TEST-VALUE"],
    ["bachs", "DANWO_FIDELITY_BACHS_KEY", "sk_live_abc", "sk_sandbox_abc"],
  ])("refuses a live %s key and accepts a test one", (name, variable, live, test) => {
    const provider = FIDELITY_PROVIDERS.find((candidate) => candidate.name === name)

    expect(() => provider?.live({ [variable]: live })).toThrow(LiveCredentialRefused)
    expect(provider?.live({ [variable]: test })?.kind).toBe("live")
  })

  it("calls public endpoints only when opted in", () => {
    const google = FIDELITY_PROVIDERS.find((provider) => provider.name === "google")

    expect(google?.live({})).toBeUndefined()
    expect(google?.live({ DANWO_FIDELITY_PUBLIC: "1" })?.kind).toBe("live")
  })

  it("encodes nested form values the way Stripe reads them", () => {
    expect(decodeURIComponent(formBody({ a: [{ b: 1 }], c: { d: "e" }, f: undefined }))).toBe(
      "a[0][b]=1&c[d]=e",
    )
  })
})

describe("the emulators against the committed goldens", () => {
  it("match every scenario a golden covers", async () => {
    const reports = await runFidelity({
      root,
      providers: FIDELITY_PROVIDERS,
      env: {},
      offline: true,
    })

    expect(formatFidelity(reports).join("\n")).not.toContain("✗")
    expect(fidelityPassed(reports)).toBe(true)
  }, 60_000)
})
