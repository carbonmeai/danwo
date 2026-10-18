# Invariants and the fault matrix

An invariant says what must be true however a run went; `danwo matrix` breaks one provider call
or webhook at a time and checks the invariant held.

## Writing the invariant

```ts
test("buys 500 credits", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy 500 credits" }).click()
  await screen.getByTestId("checkout-pay").click()
  await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")
}).invariant(async ({ app, stripe, expect }) => {
  expect(await creditsGranted(app.baseUrl)).toBe(await creditsPaid(stripe))
})
```

The invariant runs after the body, once background work has settled, with the same fixtures.
Read state from both sides: the app (its API or database) and the emulators (`stripe`,
`resendInbox(resend)`, `slackWorkspace(slack)`…). Good invariants compare the two: credits
granted equal payments captured; one confirmation email per order; one reply per mention.

## Running the matrix

`danwo matrix tests/buy-credits.danwo.ts` runs the test clean, then plans one trial per fault:
each provider call the clean run made × that provider's faults (errors, rate limits, dropped
connections, slow answers), and each webhook delivery × duplicate, late, forged and stale. Every
trial starts from a reset environment and replays the clean run's recorded steps without the
model.

- PASS: the invariant held under the fault (the body may stop early; that is fine).
- FAIL: the invariant broke; the report shows where the body stopped and why.
- INVALID: the fault never fired (the app took another path); rerun with `matrix.rerunInvalid`.
- NOT JUDGED: the trial was blocked, inconclusive or hit an infrastructure failure.

`--faults "^duplicate"` runs only the faults whose labels match; `danwo spec --topic faults` lists
the labels each provider gets. Without an invariant the body itself must pass under every fault.

The matrix needs the environment to provide `proxy`, `reset()`, and `webhooks` for webhook faults.
