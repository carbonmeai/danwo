/**
 * What the app's model answers in the tests: danwo's model API emulator plays the Vercel AI
 * Gateway and answers each call from these scripts, so every run sees the same answers. The seed
 * holds the two journeys most tests share; a test adds its own scripts for its own case.
 */
import type { LlmScript } from "@danwo/sdk"

/** The question about an order on its way. */
export const ORDER_QUESTION = "Where is my order 1043?"

/** What the model says once it has looked order 1043 up. */
export const ORDER_ANSWER =
  "Your dot-grid notebook (order 1043) has shipped. It should reach you on Friday 23 October."

/** The customer's report of a broken mug. */
export const BROKEN_MUG = "My mug from order 1042 arrived broken"

/** What the model says once the ticket is open. */
export const TICKET_ANSWER =
  "I'm so sorry your mug arrived broken. I've opened a ticket and emailed you a copy: the studio will send a replacement."

/** What the model says when the tool it called failed or was refused. */
export const TOOL_FAILED_ANSWER =
  "Sorry, I couldn't do that just now. Could you try again in a moment?"

/**
 * A message asking for a ticket about order 1042, however it is put: "open a ticket for order
 * 1042", "my mug from order 1042 arrived broken". The agent test words it in its own way.
 */
const TICKET_FOR_1042 =
  /\b1042\b[\s\S]*\b(ticket|broken|damaged|cracked|chipped|smashed)|\b(ticket|broken|damaged|cracked|chipped|smashed)\b[\s\S]*\b1042\b/i

/**
 * Every script answers the same way however often it is asked, so a retried call gets the same.
 * The answer after a tool call depends on what the tool handed back, as a model's would.
 */
export const SEED_SCRIPTS: readonly LlmScript[] = [
  {
    name: "look order 1043 up",
    match: { user: /where is my order #?1043/i, toolResult: false },
    reply: { toolCalls: [{ name: "lookupOrder", arguments: { orderNumber: "1043" } }] },
  },
  {
    name: "say where order 1043 is",
    match: { user: /where is my order #?1043/i, toolResult: /"found":true/ },
    reply: { text: ORDER_ANSWER },
  },
  {
    name: "open a ticket for order 1042",
    match: { user: TICKET_FOR_1042, toolResult: false },
    reply: {
      toolCalls: [
        {
          name: "createTicket",
          arguments: {
            orderNumber: "1042",
            summary: "The speckled stoneware mug arrived broken.",
            reason: "damaged",
          },
        },
      ],
    },
  },
  {
    name: "confirm the ticket",
    match: { user: TICKET_FOR_1042, toolResult: /"status":"(opened|already-open)"/ },
    reply: { text: TICKET_ANSWER },
  },
  {
    /* What a model says when its tool failed: it doesn't claim the ticket or the order. */
    name: "apologise for a tool that failed",
    match: { toolResult: true },
    reply: { text: TOOL_FAILED_ANSWER },
  },
]
