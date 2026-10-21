import {
  createIdGenerator,
  createUIMessageStreamResponse,
  toUIMessageStream,
  validateUIMessages,
} from "ai"
import { z } from "zod"

import { answer, supportTools } from "../../../lib/assistant.ts"
import { broken } from "../../../lib/bugs.ts"
import { CONVERSATION_ID, loadMessages, saveMessages } from "../../../lib/conversations.ts"
import { friendlyError, rawError, UNAVAILABLE } from "../../../lib/errors.ts"
import { outcomeOf, type SupportMessage } from "../../../lib/messages.ts"

/** What the page sends: the conversation, and its newest message (the whole history is ours). */
const ChatRequest = z.object({
  id: z.string().regex(CONVERSATION_ID),
  message: z.object({ id: z.string().min(1), role: z.literal("user") }).passthrough(),
})

/** Ids for the assistant's answers, made here so the saved message and the page's agree. */
const answerId = createIdGenerator({ prefix: "msg", size: 16 })

/** Whether an answer holds anything to keep: text, or a tool call. */
function holdsSomething(message: SupportMessage): boolean {
  return message.parts.some((part) => part.type === "text" || part.type.startsWith("tool-"))
}

/**
 * The conversation up to and including `message`: the saved history with it added, or, when it is
 * already saved (a regenerate, or a retry after a failed answer), cut back to it.
 */
async function conversationUpTo(id: string, message: unknown): Promise<SupportMessage[]> {
  const history = await loadMessages(id)
  const newest = message as SupportMessage
  const at = history.findIndex((saved) => saved.id === newest.id)
  const messages = at >= 0 ? history.slice(0, at + 1) : [...history, newest]

  return validateUIMessages<SupportMessage>({ messages, tools: supportTools(id) })
}

/**
 * Answers the customer's newest message, streaming. The question is saved before the model is
 * asked, and the answer once it has ended, with how it ended, so the saved conversation is the
 * one the page showed.
 */
export async function POST(request: Request): Promise<Response> {
  const body = ChatRequest.safeParse(await request.json().catch(() => undefined))

  if (!body.success) return Response.json({ error: "Not a chat message." }, { status: 400 })

  const { id } = body.data
  let messages: SupportMessage[]

  try {
    messages = await conversationUpTo(id, body.data.message)
    await saveMessages(id, messages)
  } catch (error) {
    console.error("could not save the question:", error)

    return Response.json({ error: UNAVAILABLE }, { status: 503 })
  }

  const { result, saidSomething } = await answer(id, messages)

  /* Run the answer to its end even if the page goes away, so it is saved all the same. */
  void result.consumeStream()

  const stream = toUIMessageStream<ReturnType<typeof supportTools>, SupportMessage>({
    stream: result.stream,
    originalMessages: messages,
    generateMessageId: answerId,
    messageMetadata: ({ part }) =>
      part.type === "finish"
        ? { outcome: outcomeOf(part.finishReason, saidSomething()) }
        : undefined,
    onError(error) {
      console.error("the model call failed:", rawError(error))

      return broken("no-retry") ? rawError(error) : friendlyError(error)
    },
    async onEnd({ messages: all, responseMessage }) {
      if (!holdsSomething(responseMessage)) return

      /* An answer that broke off has no outcome from the model; the page marks it interrupted. */
      const kept = responseMessage.metadata?.outcome
        ? all
        : [
            ...all.slice(0, -1),
            { ...responseMessage, metadata: { outcome: "interrupted" as const } },
          ]

      await saveMessages(id, kept).catch((error: unknown) =>
        console.error("could not save the answer:", error),
      )
    },
  })

  return createUIMessageStreamResponse({ stream })
}
