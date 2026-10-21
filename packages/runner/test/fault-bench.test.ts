import { describe, expect, it } from "vitest"

import { parseFault } from "../src/runner/fault-bench.ts"

describe("reading a fault's label", () => {
  it("reads the declined card the matrix plans on the hosted Checkout page's Pay button", () => {
    expect(
      parseFault("card_declined on POST checkout.stripe.com/checkout/:id/complete"),
    ).toMatchObject({
      fault: { kind: "emulate", behaviour: "card_declined" },
      nth: 1,
    })
  })

  it("still reads a model failure, and refuses a behaviour no emulator has", () => {
    expect(parseFault("refusal on POST api.openai.com/v1/chat/completions")).toMatchObject({
      fault: { kind: "emulate", behaviour: "refusal" },
    })
    expect(() =>
      parseFault("card_exploded on POST checkout.stripe.com/checkout/:id/complete"),
    ).toThrow(/cannot read the fault/)
  })
})
