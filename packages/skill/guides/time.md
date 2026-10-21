# Time travel

Jump days ahead in a test: trials end, subscriptions renew, retries run and tokens expire, in seconds.

```ts
test("a trial turns into a paid plan", async ({ app, screen, expect, time, settle }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Start 14-day trial" }).click()
  // …pay on the provider's page…

  await time.travel({ days: 15 })
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: active")
})
```

`time.travel(span)` moves three clocks together:

- **The app's clock.** Every Node or Bun process started with `proxy.env()` runs its `Date` ahead
  of real time by the travelled offset. Nothing in the app changes.
- **Every emulator's clock.** What falls due on the way runs in order (renewals, retries, expiries,
  scheduled messages), and each step's webhooks land before the next.
- **The page's clock.** The browser's `Date` jumps too.

Other calls:

- `time.set(date)` travels to a moment.
- `time.now()` says where everything is.

Time only moves forward. Each jump is a step in the flight record. Afterwards, `settle()` delivers
anything still pending.

## Why an offset, not frozen time

Only `Date` jumps. Timers, `performance.now()` and anything else that measures how long something
took keep running on real time. Sockets, HTTP retries, database pools, animations and framework
timers all rely on real durations, and freezing them breaks apps in ways real users never see. An
offset changes what time it is, never how fast it passes.

The browser keeps cookies by its real clock, so a cookie the page writes with an `expires` date
from its travelled clock is stored with that date moved back by the offset. A page that deletes a
cookie by dating it in the past (as Clerk's sign-out does) still deletes it after a jump.

## Faults after travelling

`danwo matrix` plans faults on the webhooks that fall due after a jump, just like any other. A
duplicated `invoice.paid` after the trial ends, or a renewal webhook arriving late, is judged by the
test's invariant.

To make a renewal fail, change the provider's state from the test before travelling, e.g.
`bachsLedger(bachs).failCard(subscriptionId, "declined")`.

## The agent

`agent.act("wait until the trial has ended", { time: true })` offers the agent a `travel_time`
tool. Each jump it takes is recorded, so a replay travels the same way with no model.

## What moves, and what does not

- **Node apps:** through the preload in `NODE_OPTIONS`.
- **Bun apps:** through `BUN_OPTIONS`.
- **Inngest:** with `inngestService`, each cron function that falls due on the way runs once at
  the new time, and events sent after the jump run at once. A run already asleep in `step.sleep`
  or `step.sleepUntil` still wakes at real time.
- **Apps in other languages** see the page's clock and the emulators move, but not their own
  `Date`. Tools such as libfaketime can shift a process's clock.
- **Environments without `travel`.** The service environments (`stripeEnvironment`,
  `startServices`, `bachsEnvironment`…) all provide it. An environment you assemble yourself
  passes it on, e.g. `travel: bachs.travel`. Without it, only the apps' and the page's clocks move.
- **Within a worker.** Time stays where a test left it. `danwo matrix` restores every trial, so
  each one starts at real time.
