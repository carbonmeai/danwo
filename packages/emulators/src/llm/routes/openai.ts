/** OpenAI's routes on `api.openai.com`: Chat Completions, Responses and embeddings. */
import type OpenAI from "openai"

import type { EmulatorContext } from "../../define.ts"
import { asRecord } from "../../json.ts"
import { answer } from "../answer.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { defaultDimensions, embed, inputsOf } from "../embeddings.ts"
import { chatCompletion, chatHead, chatStream } from "../openai-chat.ts"
import { responseObject, responseStream } from "../openai-responses.ts"
import { chatRequest, responsesRequest } from "../requests.ts"
import { tokensIn } from "../usage.ts"

export function openaiRoutes(emulator: EmulatorContext): void {
  const { app, clock } = emulator

  app.post("/v1/chat/completions", async (c) => {
    onlyFor(c, "openai")

    const body = await bodyOf(c)
    const request = chatRequest(body)
    const answered = await answer(emulator, c, "chat", request)
    const head = chatHead(request.model, clock())
    const includeUsage = asRecord(body.stream_options)?.include_usage === true

    return send(
      c,
      answered,
      request.stream,
      chatCompletion(answered.reply, answered.usage, head),
      () => chatStream(answered.reply, answered.usage, head, includeUsage),
    )
  })

  app.post("/v1/responses", async (c) => {
    onlyFor(c, "openai")

    const request = responsesRequest(await bodyOf(c))
    const answered = await answer(emulator, c, "responses", request)
    const whole = responseObject(answered.reply, answered.usage, request.model, clock())

    return send(c, answered, request.stream, whole, () => responseStream(whole))
  })

  app.post("/v1/embeddings", async (c) => {
    onlyFor(c, "openai")

    const body = await bodyOf(c)
    const model = typeof body.model === "string" ? body.model : ""
    const size = typeof body.dimensions === "number" ? body.dimensions : defaultDimensions(model)
    const inputs = inputsOf(body.input)
    const tokens = tokensIn(inputs.join("\n"))

    return c.json({
      object: "list",
      model,
      data: inputs.map((text, index) => ({
        object: "embedding",
        index,
        embedding: embed(text, size),
      })),
      usage: { prompt_tokens: tokens, total_tokens: tokens },
    } satisfies OpenAI.Embeddings.CreateEmbeddingResponse)
  })
}
