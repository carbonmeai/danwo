/** Anthropic's routes on `api.anthropic.com`: Messages and token counting. */
import type { EmulatorContext } from "../../define.ts"
import { answer } from "../answer.ts"
import { anthropicMessage, anthropicStream } from "../anthropic.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { messagesRequest } from "../requests.ts"
import { promptTokens } from "../usage.ts"

export function anthropicRoutes(emulator: EmulatorContext): void {
  const { app } = emulator

  app.post("/v1/messages", async (c) => {
    onlyFor(c, "anthropic")

    const request = messagesRequest(await bodyOf(c))
    const answered = await answer(emulator, c, "messages", request)
    const whole = anthropicMessage(answered.reply, answered.usage, request.model)

    return send(c, answered, request.stream, whole, () => anthropicStream(answered.reply, whole))
  })

  app.post("/v1/messages/count_tokens", async (c) => {
    onlyFor(c, "anthropic")

    return c.json({ input_tokens: promptTokens(messagesRequest(await bodyOf(c))) })
  })
}
