import { resendInbox } from "@danwo/sdk"

import {
  expectDigestsDelivered,
  OWNER,
  scheduleAndArrive,
  subscriberRow,
  TEAM,
  test,
  writeDigest,
} from "./digests.ts"

test("sends a scheduled digest to every subscriber once", async ({ app, screen, expect, time }) => {
  await writeDigest({ app, screen, expect }, { title: "Friday notes", subscribers: TEAM })
  await scheduleAndArrive({ screen, expect, time })

  await expect(screen.getByTestId("digest-status")).toHaveText("Sent")
  for (const person of TEAM) await expect(subscriberRow(screen, person.email)).toContainText("Sent")
  await expect(screen.getByTestId("charge")).toHaveText(/Batch 1: 3 emails, \$0\.06/)
}).invariant(expectDigestsDelivered)

test("retries a send whose answer was lost, and still sends one email", async ({
  app,
  screen,
  expect,
  time,
  proxy,
}) => {
  /* Resend takes the first email, but the step never hears back, so Inngest runs it again. */
  proxy.failNext((call) => call.host === "api.resend.com" && call.path === "/emails", {
    kind: "reset-after",
  })

  await writeDigest({ app, screen, expect }, { title: "Release notes", subscribers: TEAM })
  await scheduleAndArrive({ screen, expect, time })

  await expect(screen.getByTestId("digest-status")).toHaveText("Sent")
  await expect(screen.getByRole("row", { name: /Retried/ })).toContainText("Send one")
  await expect(screen.getByRole("row", { name: /Sent to .* 2 Completed/ })).toBeVisible()
}).invariant(expectDigestsDelivered)

test("bills a batch once when Stripe's answer is lost", async ({
  app,
  screen,
  expect,
  time,
  proxy,
}) => {
  /* Stripe makes the invoice item, but the step never hears back, so Inngest runs it again. */
  proxy.failNext((call) => call.host === "api.stripe.com" && call.path === "/v1/invoiceitems", {
    kind: "reset-after",
  })

  await writeDigest({ app, screen, expect }, { title: "Usage report", subscribers: TEAM })
  await scheduleAndArrive({ screen, expect, time })

  await expect(screen.getByTestId("charge")).toHaveCount(1)
  await expect(screen.getByTestId("charge")).toHaveText(/Batch 1: 3 emails, \$0\.06/)
}).invariant(expectDigestsDelivered)

test("a send that fails for good marks the copy failed and tells the owner", async ({
  app,
  screen,
  expect,
  time,
  resend,
}) => {
  /* The browser takes an address with no dot in its domain; Resend does not. */
  const typo = { name: "Kim", email: "kim@northwind" }

  await writeDigest(
    { app, screen, expect },
    { title: "Team update", subscribers: [...TEAM.slice(0, 1), typo] },
  )
  await scheduleAndArrive({ screen, expect, time })

  await expect(screen.getByTestId("digest-status")).toHaveText("Sent with failures")
  await expect(subscriberRow(screen, typo.email)).toContainText("Failed")
  await expect(screen.getByRole("row", { name: /Send one: on failure/ })).toContainText(
    `Told ${OWNER}`,
  )

  const [notice] = resendInbox(resend).list(OWNER)

  expect(notice?.subject).toBe('Couldn\'t deliver "Team update" to kim@northwind')
  expect(notice?.text).toContain("Invalid `to` field")
}).invariant(expectDigestsDelivered)

test("the digests page shows how each send went", async ({ app, screen, expect, time }) => {
  await writeDigest(
    { app, screen, expect },
    { title: "Monday plan", subscribers: TEAM.slice(0, 2) },
  )
  await scheduleAndArrive({ screen, expect, time })
  await writeDigest({ app, screen, expect }, { title: "Next week", subscribers: TEAM.slice(2) })
  await screen.getByRole("button", { name: "Schedule" }).click()
  await expect(screen.getByRole("status")).toContainText("Scheduled for")

  await app.open("/")
  await expect(screen.getByRole("row", { name: /Monday plan/ })).toContainText("Sent")
  await expect(screen.getByRole("row", { name: /Next week/ })).toContainText("Scheduled")
}).invariant(expectDigestsDelivered)
