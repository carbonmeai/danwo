/** The AI Gateway's routes on `ai-gateway.vercel.sh`: language models and embedding models. */
import type { EmulatorContext } from "../../define.ts"
import { answer } from "../answer.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { defaultDimensions, embed, inputsOf } from "../embeddings.ts"
import { gatewayResult, gatewayStream } from "../gateway.ts"
import { gatewayRequest } from "../requests.ts"
import { tokensIn } from "../usage.ts"

export function gatewayRoutes(emulator: EmulatorContext): void {
  const { app } = emulator

  app.post("/v4/ai/language-model", async (c) => {
    onlyFor(c, "gateway")

    const model = c.req.header("ai-language-model-id") ?? ""
    const stream = c.req.header("ai-language-model-streaming") === "true"
    const request = gatewayRequest(await bodyOf(c), model, stream)
    const answered = await answer(emulator, c, "language-model", request)
    const whole = gatewayResult(answered.reply, answered.usage, model, answered.cost)

    return send(c, answered, stream, whole, () => gatewayStream(whole))
  })

  app.post("/v4/ai/embedding-model", async (c) => {
    onlyFor(c, "gateway")

    const model = c.req.header("ai-model-id") ?? ""
    const body = await bodyOf(c)
    const values = inputsOf(body.values)
    const size = typeof body.dimensions === "number" ? body.dimensions : defaultDimensions(model)

    return c.json({
      embeddings: values.map((text) => embed(text, size)),
      usage: { tokens: tokensIn(values.join("\n")) },
    })
  })
}
