import { type LlmFixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<LlmFixtures>()

const State = z.object({ refunds: z.number(), lastAnswer: z.string() })

/** Words that only show up when an API error reached the customer. */
const RAW_ERROR = /\b[45]\d\d\b|error|exception|rate limit|json|unexpected|overloaded|context/i

test("refunds an order through the assistant", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByLabel("Question").fill("Please refund order 42")
  await screen.getByRole("button", { name: "Ask" }).click()
  await expect(screen.getByRole("region", { name: "Answer" })).toHaveText(
    "Done! Order 42 has been refunded.",
  )
  await expect(screen.getByRole("status")).toHaveText("Refunds issued: 1")
}).invariant(async ({ app, expect }) => {
  /*
   * Whichever way the model calls went, the order is refunded at most once, and the customer never
   * reads the API's own error text.
   */
  const state = State.parse(await (await fetch(`${app.baseUrl}/__test/state`)).json())

  expect(state.refunds).toBeLessThanOrEqual(1)
  expect(state.lastAnswer).not.toMatch(RAW_ERROR)
})
