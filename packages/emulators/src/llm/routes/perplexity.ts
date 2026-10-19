/**
 * Perplexity's routes on `api.perplexity.ai`: the Agent API (`/v1/agent`) and Sonar, at
 * `/v1/sonar` and its older address `/chat/completions`.
 */
import type { EmulatorContext } from "../../define.ts"
import type { Context } from "../../http.ts"
import { answer } from "../answer.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { chatHead } from "../openai-chat.ts"
import {
  agentRequest,
  agentResponse,
  agentStream,
  sonarCompletion,
  sonarStream,
} from "../perplexity.ts"
import { chatRequest } from "../requests.ts"
import { llmStore } from "../store.ts"

export function perplexityRoutes(emulator: EmulatorContext): void {
  const { app, clock } = emulator
  const priceOf = (model: string) => llmStore(emulator.store).settings().prices[model]

  app.post("/v1/agent", async (c) => {
    onlyFor(c, "perplexity")

    const request = agentRequest(await bodyOf(c))
    const answered = await answer(emulator, c, "agent", request)
    const whole = agentResponse(
      answered.reply,
      answered.usage,
      request.model,
      clock(),
      priceOf(request.model),
    )

    return send(c, answered, request.stream, whole, () => agentStream(whole))
  })

  const sonar = async (c: Context) => {
    onlyFor(c, "perplexity")

    const request = chatRequest(await bodyOf(c), "perplexity")
    const answered = await answer(emulator, c, "chat", request)
    const head = chatHead(request.model, clock())
    const price = priceOf(request.model)

    return send(
      c,
      answered,
      request.stream,
      sonarCompletion(answered.reply, answered.usage, head, price),
      () => sonarStream(answered.reply, answered.usage, head, price),
    )
  }

  app.post("/v1/sonar", sonar)
  app.post("/chat/completions", sonar)
}
