import { llmCalls, llmScripts, resendInbox } from "@danwo/sdk"

import { BUSY } from "../lib/errors.ts"
import { ticketSubject } from "../lib/mail.ts"
import {
  BROKEN_MUG,
  ORDER_ANSWER,
  ORDER_QUESTION,
  TICKET_ANSWER,
  TOOL_FAILED_ANSWER,
} from "./scripts.ts"
import {
  ask,
  noteFor,
  settled,
  shownMessages,
  storedMessages,
  supportHeld,
  test,
  tickets,
} from "./support.ts"

test("looks up an order", async ({ app, screen, expect, llm, databaseUrl }) => {
  await app.open("/")
  await ask(screen, ORDER_QUESTION)

  /* The status comes from Postgres, through the tool; the sentence under it from the model. */
  await expect(screen.getByTestId("order-card")).toContainText("Order 1043")
  await expect(screen.getByTestId("order-status")).toHaveText("shipped")
  await expect(screen.getByTestId("message-text").last()).toHaveText(ORDER_ANSWER)

  /* One call asked for the order, one answered from it; both were offered both tools. */
  const calls = llmCalls(llm).all()

  expect(calls.map((call) => call.script)).toEqual([
    "look order 1043 up",
    "say where order 1043 is",
  ])
  expect(calls[0]?.tools).toEqual(["lookupOrder", "createTicket"])
  /* The answer is saved as its stream ends, after its last words show: compare once it ended. */
  await settled(screen, expect)
  expect(await shownMessages(screen)).toEqual(await storedMessages(databaseUrl))
}).invariant(supportHeld)

test("opens a ticket for a broken mug", async ({ app, screen, expect, resend, databaseUrl }) => {
  await app.open("/")
  await ask(screen, BROKEN_MUG)

  await expect(screen.getByTestId("ticket-card")).toContainText("Ticket opened")
  await expect(screen.getByTestId("ticket-number")).toHaveText("T-0001")
  await expect(screen.getByTestId("message-text").last()).toHaveText(TICKET_ANSWER)

  /* One ticket in Postgres, and one email to the customer about it in the Resend emulator. */
  const opened = await tickets(databaseUrl)

  expect(
    opened.map(({ order_number, reason, email }) => ({ order_number, reason, email })),
  ).toEqual([{ order_number: "1042", reason: "damaged", email: "ada@example.com" }])
  expect(
    resendInbox(resend)
      .list("ada@example.com")
      .map((sent) => sent.subject),
  ).toEqual([ticketSubject("T-0001")])
}).invariant(supportHeld)

test("streams the answer in as it is written", async ({ app, screen, expect, llm }) => {
  const story =
    "Every mug is thrown by hand in our studio, glazed twice and fired at high temperature, so no two are quite alike. They are dishwasher safe, but a gentle hand wash keeps the glaze bright for years."

  llmScripts(llm).add({ match: { user: /tell me about your mugs/i }, reply: { text: story } })

  await app.open("/")
  await ask(screen, "Tell me about your mugs")
  await settled(screen, expect)

  const answer = screen.getByTestId("message").last()

  await expect(answer.getByTestId("message-text")).toHaveText(story)
  await expect(answer).toHaveAttribute("data-outcome", "answered")
  /* The page redrew the answer word by word as it streamed in, not once at the end. */
  expect(Number(await answer.getAttribute("data-updates"))).toBeGreaterThan(10)
  expect(llmCalls(llm).last()?.stream).toBe(true)
})

test("shows a retry message when the model is rate-limited, and the retry works", async ({
  app,
  screen,
  expect,
  llm,
  databaseUrl,
}) => {
  /*
   * The AI SDK tries each call three times (it retries twice, after the gateway's Retry-After),
   * so three rate limits run it out; the fourth call, after Retry, answers.
   */
  llmScripts(llm).add({
    match: { user: /has order 1051 shipped/i },
    reply: [
      { error: "rate-limit" },
      { error: "rate-limit" },
      { error: "rate-limit" },
      { text: "Not yet: your tide print is still being made. We'll email you when it ships." },
    ],
  })

  await app.open("/")
  await ask(screen, "Has order 1051 shipped yet?")

  await expect(screen.getByRole("alert").filter({ hasText: BUSY })).toBeVisible()
  expect(
    llmCalls(llm)
      .all()
      .map((call) => call.reply.error),
  ).toEqual(["rate-limit", "rate-limit", "rate-limit"])

  await screen.getByRole("button", { name: "Retry" }).click()

  await expect(screen.getByTestId("message-text").last()).toHaveText(/still being made/)
  await expect(screen.getByRole("alert").filter({ hasText: BUSY })).toHaveCount(0)
  await settled(screen, expect)
  expect(await shownMessages(screen)).toEqual(await storedMessages(databaseUrl))
}).invariant(supportHeld)

test("rejects a malformed tool call without writing anything", async ({
  app,
  screen,
  expect,
  llm,
  resend,
  databaseUrl,
}) => {
  /* The model calls createTicket with a number for the order, a reason that isn't one, no summary. */
  llmScripts(llm).add({
    match: { user: /torn pages/i, toolResult: false },
    reply: {
      toolCalls: [
        { name: "createTicket", arguments: { orderNumber: 1043, reason: "torn", summary: "" } },
      ],
    },
  })

  await app.open("/")
  await ask(screen, "The notebook in order 1043 came with torn pages")
  await settled(screen, expect)

  /* The AI SDK refused the call before it ran: no ticket, no email. */
  expect(await tickets(databaseUrl)).toEqual([])
  expect(resendInbox(resend).list("ada@example.com")).toEqual([])

  await expect(screen.getByTestId("tool-error")).toContainText("nothing was saved")
  /* The seed's script for a failed tool answers the turn after: the model doesn't claim a ticket. */
  await expect(screen.getByTestId("message-text").last()).toHaveText(TOOL_FAILED_ANSWER)
}).invariant(supportHeld)

test("shows a refusal as a refusal", async ({ app, screen, expect, llm }) => {
  llmScripts(llm).add({
    match: { user: /write my essay/i },
    reply: { refusal: "I can't help with that request." },
  })

  await app.open("/")
  await ask(screen, "Can you write my essay on the history of ceramics?")

  const answer = screen.getByTestId("message").last()

  await expect(answer.getByTestId("message-text")).toHaveText("I can't help with that request.")
  await expect(answer.getByTestId("message-note")).toHaveText(noteFor("refused"))
  await expect(answer).toHaveAttribute("data-outcome", "refused")
})

test("regenerates an answer", async ({ app, screen, expect, llm, databaseUrl }) => {
  llmScripts(llm).add({
    match: { user: /returns policy/i },
    reply: [
      { text: "You can return anything within 30 days." },
      { text: "Returns are free within 30 days of delivery: just reply to your order email." },
    ],
  })

  await app.open("/")
  await ask(screen, "What's your returns policy?")
  await expect(screen.getByTestId("message-text").last()).toHaveText(/within 30 days\.$/)

  await screen.getByRole("button", { name: "Regenerate" }).click()

  await expect(screen.getByTestId("message-text").last()).toHaveText(/free within 30 days/)
  await settled(screen, expect)
  /* The new answer took the old one's place, on the page and in Postgres. */
  expect(await shownMessages(screen)).toEqual([
    { role: "user", text: "What's your returns policy?", outcome: null },
    {
      role: "assistant",
      text: "Returns are free within 30 days of delivery: just reply to your order email.",
      outcome: "answered",
    },
  ])
  expect(await storedMessages(databaseUrl)).toEqual(await shownMessages(screen))
}).invariant(supportHeld)
