/** The AI Gateway's routes on `ai-gateway.vercel.sh`: language models and embedding models. */
import type { EmulatorContext } from "../../define.ts"
import type { Context } from "../../http.ts"
import { answer } from "../answer.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { defaultDimensions, embed, inputsOf } from "../embeddings.ts"
import { embeddingMetadata, gatewayResult, gatewayStream } from "../gateway.ts"
import { gatewayRequest } from "../requests.ts"
import { llmStore } from "../store.ts"
import { tokensIn } from "../usage.ts"

/** The gateway's 404 for a model id it does not know. */
function unknownModel(c: Context, model: string): Response {
  return c.json(
    {
      error: {
        message: `Model '${model}' not found`,
        type: "model_not_found",
        param: { modelId: model },
      },
    },
    404,
  )
}

export function gatewayRoutes(emulator: EmulatorContext): void {
  const { app, clock } = emulator
  const settings = () => llmStore(emulator.store).settings()
  const priceOf = (model: string) => settings().prices[model]
  const unknown = (model: string) =>
    settings().knownModelsOnly === true && !settings().models.includes(model)

  app.post("/v4/ai/language-model", async (c) => {
    onlyFor(c, "gateway")

    const model = c.req.header("ai-language-model-id") ?? ""

    if (unknown(model)) return unknownModel(c, model)

    const stream = c.req.header("ai-language-model-streaming") === "true"
    const request = gatewayRequest(await bodyOf(c), model, stream)
    const answered = await answer(emulator, c, "language-model", request)
    const whole = gatewayResult(answered.reply, answered.usage, model, priceOf(model))

    return send(c, answered, stream, whole, () => gatewayStream(whole, model, clock()))
  })

  app.post("/v4/ai/embedding-model", async (c) => {
    onlyFor(c, "gateway")

    const model = c.req.header("ai-model-id") ?? ""

    if (unknown(model)) return unknownModel(c, model)

    const body = await bodyOf(c)
    const values = inputsOf(body.values)
    const size = typeof body.dimensions === "number" ? body.dimensions : defaultDimensions(model)
    const tokens = tokensIn(values.join("\n"))

    return c.json({
      embeddings: values.map((text) => embed(text, size)),
      warnings: [],
      usage: { tokens },
      providerMetadata: embeddingMetadata(tokens, model, priceOf(model)),
    })
  })
}
