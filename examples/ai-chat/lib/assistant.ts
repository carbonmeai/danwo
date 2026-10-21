/**
 * The support assistant: what it is told, the tools it may call, and the model call itself, made
 * through the Vercel AI Gateway with the AI SDK. `AI_GATEWAY_API_KEY` is the gateway's key; in the
 * tests danwo's model API emulator answers the gateway, so any key will do.
 */
import {
  convertToModelMessages,
  type FlexibleSchema,
  jsonSchema,
  parsePartialJson,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  type ToolCallRepairFunction,
} from "ai"
import { z } from "zod"

import { broken } from "./bugs.ts"
import type { SupportMessage } from "./messages.ts"
import { findOrder, type Order } from "./orders.ts"
import { openTicket, TicketInput, type TicketOutcome } from "./tickets.ts"

/** The model, by its gateway id. */
export const MODEL = "openai/gpt-5-mini"

/** What the assistant is told before every conversation. */
export const INSTRUCTIONS = `You are the support assistant for Paper & Clay, a small studio that sells mugs, notebooks and prints online.
Help customers with their orders. Look an order up with lookupOrder before you talk about it, and never guess its status.
When an order arrived damaged, is missing, late or wrong, open a ticket with createTicket: one per order, and tell the customer its number.
Be brief and kind. If you can't help, say so plainly.`

/** What `lookupOrder` takes. */
const LookupInput = z.object({
  orderNumber: z
    .string()
    .regex(/^\d{4}$/)
    .describe("The order's four-digit number, e.g. 1042."),
})

/** What `lookupOrder` hands back: the order, or that there is none by that number. */
export type LookupOutcome =
  | { readonly found: true; readonly order: Order }
  | { readonly found: false; readonly orderNumber: string }

/**
 * The schema `createTicket` checks its input against. With the `no-tool-validation` bug it is the
 * same JSON schema the model is shown, with nothing checking a call against it.
 */
const ticketInput: FlexibleSchema<TicketInput> = broken("no-tool-validation")
  ? jsonSchema<TicketInput>(z.toJSONSchema(TicketInput))
  : TicketInput

/**
 * With the `no-tool-validation` bug, a call whose input broke off is "repaired" by finishing the
 * JSON it started, so whatever half of it arrived goes on to the tool.
 */
const finishCutOffCall: ToolCallRepairFunction<SupportTools> = async ({ toolCall }) => {
  const { value } = await parsePartialJson(toolCall.input)

  return value === undefined ? null : { ...toolCall, input: JSON.stringify(value) }
}

/** The tools of conversation `conversationId`: tickets it opens belong to it. */
export function supportTools(conversationId: string) {
  return {
    lookupOrder: tool({
      description:
        "Look up an order by its number: what was ordered, its status and when it arrives.",
      inputSchema: LookupInput,
      execute: async ({ orderNumber }): Promise<LookupOutcome> => {
        const order = await findOrder(orderNumber)

        return order ? { found: true, order } : { found: false, orderNumber }
      },
    }),
    createTicket: tool({
      description:
        "Open a support ticket about an order that arrived damaged, is missing, late or wrong. The customer gets a copy by email.",
      inputSchema: ticketInput,
      execute: (input): Promise<TicketOutcome> => openTicket(conversationId, input),
    }),
  }
}

export type SupportTools = ReturnType<typeof supportTools>

/** What `answer` started: the model's stream, and whether it has said or done anything yet. */
export interface Answer {
  readonly result: ReturnType<typeof streamText<SupportTools>>
  saidSomething(): boolean
}

/**
 * Asks the model to answer the conversation so far, streaming. The AI SDK retries a rate limit or
 * an outage itself, waiting what the gateway's `Retry-After` asks, and runs the tools the model
 * calls (checking each call's input first) for up to five steps.
 */
export async function answer(
  conversationId: string,
  messages: readonly SupportMessage[],
): Promise<Answer> {
  const tools = supportTools(conversationId)
  let said = false
  const result = streamText({
    model: MODEL,
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages([...messages], { tools }),
    tools,
    stopWhen: stepCountIs(5),
    maxRetries: broken("no-retry") ? 0 : 2,
    ...(broken("no-tool-validation") && { repairToolCall: finishCutOffCall }),
    /* Words arrive one by one, as people expect a chat to type, however the model batches them. */
    experimental_transform: smoothStream({ delayInMs: 12, chunking: "word" }),
    onChunk({ chunk }) {
      if ((chunk.type === "text-delta" && chunk.text.trim() !== "") || chunk.type === "tool-call")
        said = true
    },
  })

  return { result, saidSomething: () => said }
}
