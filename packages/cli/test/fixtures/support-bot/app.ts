/*
 * A small support assistant, written the way such apps are: the official OpenAI client on its real
 * host, a tool the model can call to refund an order, and a page to ask on. It knows nothing about
 * danwo. Each order is refunded at most once, a failed model call is retried once without running
 * the tool again, and the customer never sees a raw error.
 *
 * Env: PORT, OPENAI_API_KEY. SUPPORT_BUG=raw-errors shows the API's own error text to the customer
 * and never retries; SUPPORT_BUG=double-refund restarts the whole conversation when the reply after
 * a refund fails, refunding the order again. Both are bugs to catch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

import OpenAI from "openai"

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Completion = OpenAI.Chat.Completions.ChatCompletion

const bug = process.env["SUPPORT_BUG"] ?? ""
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"], maxRetries: 0, timeout: 5_000 })
const refunded = new Set<number>()
let refunds = 0
let lastAnswer = ""

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "issue_refund",
      description: "Refunds an order in full",
      parameters: {
        type: "object",
        properties: { order: { type: "number" } },
        required: ["order"],
      },
    },
  },
]

const SORRY = "Sorry, our assistant is unavailable right now. Please try again."

const page = (body: string) => `<!doctype html><title>Support</title><main><h1>Support</h1>${body}
  <p role="status">Refunds issued: ${refunds}</p></main>`

const askForm = () =>
  page(`<form method="post" action="/ask">
    <label>Question <input name="question"></label>
    <button type="submit">Ask</button>
  </form>`)

/** One model call; the careful app tries it twice, the buggy one once. */
async function complete(messages: Message[]): Promise<Completion> {
  const attempts = bug === "" ? 2 : 1
  let failure: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await openai.chat.completions.create({ model: "gpt-5-mini", messages, tools: TOOLS })
    } catch (error) {
      failure = error
    }
  }

  throw failure
}

/** The message an answer carries, or an empty one. */
function messageOf(completion: Completion): OpenAI.Chat.Completions.ChatCompletionMessage {
  return completion.choices[0]?.message ?? { role: "assistant", content: null, refusal: null }
}

/** What the customer reads from an answer: its text, or a polite line when there is none. */
function textOf(completion: Completion): string {
  const message = messageOf(completion)

  if (message.refusal) return "Sorry, I can't help with that."

  return (message.content ?? "").trim() || "Sorry, I didn't get an answer. Please try again."
}

/** Refunds an order once; the double-refund bug forgets which orders it refunded. */
function refund(order: number): string {
  if (bug !== "double-refund" && refunded.has(order)) return "already refunded"

  refunded.add(order)
  refunds += 1

  return "refunded"
}

/** Runs one tool call and asks the model for its reply to the result. */
async function afterTool(messages: Message[], first: Completion): Promise<string> {
  const message = messageOf(first)
  const call = message.tool_calls?.[0]

  if (call?.type !== "function") return textOf(first)

  const args: { order: number } = JSON.parse(call.function.arguments)
  const toolTurn: Message = { role: "tool", tool_call_id: call.id, content: refund(args.order) }

  return textOf(await complete([...messages, message, toolTurn]))
}

async function answer(question: string): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: "You are the support assistant for a small shop." },
    { role: "user", content: question },
  ]

  return afterTool(messages, await complete(messages))
}

/** What the customer sees when the answer fails; each bug fails differently. */
const ON_FAILURE: Record<string, (error: unknown, question: string) => Promise<string> | string> = {
  "raw-errors": (error) => (error instanceof Error ? error.message : String(error)),
  "double-refund": (_error, question) => answer(question).catch(() => SORRY),
}

/** The answer, or what the customer sees when it fails. */
async function reply(question: string): Promise<string> {
  try {
    return await answer(question)
  } catch (error) {
    return (ON_FAILURE[bug] ?? (() => SORRY))(error, question)
  }
}

async function formOf(req: IncomingMessage): Promise<URLSearchParams> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  return new URLSearchParams(body)
}

async function ask(req: IncomingMessage): Promise<string> {
  lastAnswer = await reply((await formOf(req)).get("question") ?? "")

  return page(`<section aria-label="Answer"><p>${lastAnswer}</p></section>`)
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === "/__test/state") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ refunds, lastAnswer }))

    return
  }

  const html = req.method === "POST" && req.url === "/ask" ? await ask(req) : askForm()

  res.writeHead(200, { "content-type": "text/html" })
  res.end(html)
}

createServer((req, res) => void route(req, res)).listen(
  Number(process.env["PORT"]),
  "127.0.0.1",
  () => console.log("listening"),
)
