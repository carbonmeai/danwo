/**
 * Perplexity (`api.perplexity.ai`): the Agent API (`POST /v1/agent`, a responses-style API the AI
 * SDK's Perplexity provider uses) and the Sonar API (`POST /v1/sonar` and the older
 * `/chat/completions`, OpenAI-compatible with citations). Both cite the reply's `sources` and
 * report a cost when the model has a price.
 */
import { asRecord } from "../json.ts"
import type { LlmPrice, LlmReply, LlmRequest, LlmSource, LlmUsage } from "./entities.ts"
import { chatChunks, chatCompletion } from "./openai-chat.ts"
import { openaiSchema, request, splitMessages, str, toolNames } from "./requests.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText, sse, unixSeconds } from "./wire.ts"

/** An Agent API body: `input` is a string or a list of items; `model` or `preset` picks a model. */
export function agentRequest(body: Record<string, unknown>): LlmRequest {
  const input =
    typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input
  const { system, messages } = splitMessages(input)

  return request(
    "perplexity",
    {
      model: str(body.model) || str(body.preset),
      system: [str(body.instructions), ...system],
      messages,
      tools: toolNames(body.tools),
      schema: openaiSchema(body.response_format),
    },
    body.stream === true,
  )
}

/** A cost in dollars, split the way Perplexity reports it. */
interface Cost {
  readonly input: number
  readonly output: number
}

function costOf(counts: LlmUsage, price: LlmPrice | undefined): Cost | undefined {
  if (price === undefined) return undefined

  return {
    input: (counts.input * price.input) / 1_000_000,
    output: (counts.output * price.output) / 1_000_000,
  }
}

function sources(reply: LlmReply): readonly LlmSource[] {
  return reply.sources ?? []
}

/** A source as a search result: its numbered id, title, address and what Perplexity read of it. */
function searchResult(source: LlmSource, index: number) {
  return {
    id: index + 1,
    title: source.title ?? source.url,
    url: source.url,
    snippet: source.snippet ?? "",
    date: source.date ?? null,
    last_updated: source.date ?? null,
    source: "web",
  }
}

function messageItem(reply: LlmReply) {
  return {
    type: "message" as const,
    id: llmId("msg_"),
    role: "assistant",
    status: "completed",
    content: [
      {
        type: "output_text",
        text: reply.refusal ?? messageText(reply),
        annotations: sources(reply).map((source) => ({
          type: "url_citation",
          url: source.url,
          title: source.title ?? source.url,
        })),
      },
    ],
  }
}

function callItems(reply: LlmReply) {
  return (reply.toolCalls ?? []).map((call) => ({
    type: "function_call" as const,
    id: llmId("fc_"),
    call_id: llmId("call_"),
    name: call.name,
    arguments: argumentsText(call.arguments),
    status: "completed",
  }))
}

/** The output items: the search results the answer cites, its message, then its tool calls. */
function outputOf(reply: LlmReply) {
  const calls = callItems(reply)
  const cited = sources(reply)
  const hasMessage = calls.length === 0 || messageText(reply) !== "" || reply.refusal !== undefined

  return [
    ...(cited.length > 0
      ? [{ type: "search_results" as const, results: cited.map(searchResult) }]
      : []),
    ...(hasMessage ? [messageItem(reply)] : []),
    ...calls,
  ]
}

function incomplete(reply: LlmReply) {
  if (reply.stop === "length") return { reason: "max_output_tokens" }

  return reply.stop === "content_filter" ? { reason: "content_filter" } : null
}

function agentUsage(counts: LlmUsage, cost: Cost | undefined, searched: boolean) {
  return {
    input_tokens: counts.input,
    output_tokens: counts.output,
    total_tokens: counts.input + counts.output,
    ...(searched && { tool_calls_details: { web_search: { invocation: 1 } } }),
    ...(cost !== undefined && {
      cost: {
        currency: "USD",
        input_cost: cost.input,
        output_cost: cost.output,
        total_cost: cost.input + cost.output,
      },
    }),
  }
}

/** A whole Agent API response. */
export function agentResponse(
  reply: LlmReply,
  counts: LlmUsage,
  model: string,
  now: Date,
  price?: LlmPrice,
) {
  const reason = incomplete(reply)

  return {
    id: llmId("resp_"),
    object: "response" as const,
    created_at: unixSeconds(now),
    model,
    status: reason === null ? "completed" : "incomplete",
    ...(reason !== null && { incomplete_details: reason }),
    error: null,
    output: outputOf(reply),
    usage: agentUsage(counts, costOf(counts, price), sources(reply).length > 0),
  }
}

type AgentResponse = ReturnType<typeof agentResponse>

/** The events an output item streams in: its text deltas and its end, or its end alone. */
function itemEvents(item: AgentResponse["output"][number], index: number): unknown[] {
  if (item.type !== "message")
    return [{ type: "response.output_item.done", output_index: index, item }]

  const text = item.content[0]?.text ?? ""
  const where = { item_id: item.id, output_index: index, content_index: 0 }

  return [
    ...deltas(text).map((delta) => ({ type: "response.output_text.delta", ...where, delta })),
    { type: "response.output_text.done", ...where, text },
    { type: "response.output_item.done", output_index: index, item },
  ]
}

/** A response as its stream of events, numbered in order. */
export function agentStream(whole: AgentResponse): string[] {
  const started = { ...whole, status: "in_progress", output: [] }
  const events = [
    { type: "response.created", response: started },
    ...whole.output.flatMap(itemEvents),
    {
      type: whole.status === "completed" ? "response.completed" : "response.incomplete",
      response: whole,
    },
  ]

  return events.map((event, sequence) => sse({ ...asRecord(event), sequence_number: sequence }))
}

/** What Sonar adds to a chat completion: its citations, search results and search usage. */
function sonarExtras(reply: LlmReply, counts: LlmUsage, price: LlmPrice | undefined) {
  const cited = sources(reply)
  const cost = costOf(counts, price) ?? { input: 0, output: 0 }

  return {
    citations: cited.map((source) => source.url),
    search_results: cited.map(searchResult),
    usage: {
      prompt_tokens: counts.input,
      completion_tokens: counts.output,
      total_tokens: counts.input + counts.output,
      search_context_size: "low",
      num_search_queries: cited.length > 0 ? 1 : 0,
      cost: {
        input_tokens_cost: cost.input,
        output_tokens_cost: cost.output,
        total_cost: cost.input + cost.output,
      },
    },
  }
}

/** A whole Sonar answer: a chat completion with citations. */
export function sonarCompletion(
  reply: LlmReply,
  counts: LlmUsage,
  head: { id: string; model: string; created: number },
  price?: LlmPrice,
) {
  return { ...chatCompletion(reply, counts, head), ...sonarExtras(reply, counts, price) }
}

/** A Sonar answer streamed: each chunk carries the citations, and the last one the usage. */
export function sonarStream(
  reply: LlmReply,
  counts: LlmUsage,
  head: { id: string; model: string; created: number },
  price?: LlmPrice,
): string[] {
  const { usage, ...cited } = sonarExtras(reply, counts, price)
  const chunks = chatChunks(reply, counts, head, false).map((chunk) => {
    const last = chunk.choices.some((choice) => choice.finish_reason !== null)

    return sse({ ...chunk, ...cited, ...(last && { usage }) })
  })

  return [...chunks, sse("[DONE]")]
}
