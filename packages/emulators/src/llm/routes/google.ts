/**
 * Gemini's routes on `generativelanguage.googleapis.com` (`v1beta` and `v1`): `generateContent`,
 * `streamGenerateContent`, `countTokens`, `embedContent`, `batchEmbedContents` and the models list.
 */
import type { EmulatorContext } from "../../define.ts"
import { HttpError } from "../../errors.ts"
import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import { answer } from "../answer.ts"
import { bodyOf, onlyFor, send } from "../context.ts"
import { embed } from "../embeddings.ts"
import { geminiChunks, geminiRequest, geminiResponse, geminiStream } from "../gemini.ts"
import { textOf } from "../requests.ts"
import { llmStore } from "../store.ts"
import { promptTokens } from "../usage.ts"
import { cutJson } from "../wire.ts"

/** A model's method, as the path names them: `models/gemini-2.5-flash:generateContent`. */
interface Method {
  readonly model: string
  readonly method: string
}

function methodOf(c: Context): Method {
  const match = /\/models\/([^/:]+):([A-Za-z]+)$/.exec(new URL(c.req.url).pathname)

  if (match === null) throw new HttpError(404, "no such method on this host")

  return { model: decodeURIComponent(match[1] ?? ""), method: match[2] ?? "" }
}

/** The width of a model's vectors, when the call names no `outputDimensionality`. */
function dimensionsOf(model: string, asked: unknown): number {
  if (typeof asked === "number") return asked

  return model.includes("gemini-embedding") ? 3072 : 768
}

/** One `embedContent` request's vector. */
function embedding(body: Record<string, unknown>, model: string): { values: number[] } {
  return {
    values: embed(
      textOf(asRecord(body.content)?.parts),
      dimensionsOf(model, body.outputDimensionality),
    ),
  }
}

/** Answers `generateContent` and `streamGenerateContent`, streaming as SSE or a JSON array. */
async function generate(emulator: EmulatorContext, c: Context, { model, method }: Method) {
  const stream = method === "streamGenerateContent"
  const request = geminiRequest(await bodyOf(c), model, stream)
  const answered = await answer(emulator, c, "gemini", request)
  const whole = geminiResponse(answered.reply, answered.usage, model)

  if (stream && new URL(c.req.url).searchParams.get("alt") !== "sse") {
    const chunks = geminiChunks(answered.reply, whole)

    return answered.behaviour === "stream-cut" ? cutJson(chunks) : c.json(chunks)
  }

  return send(c, answered, stream, whole, () => geminiStream(answered.reply, whole))
}

async function countTokens(c: Context, model: string) {
  const body = await bodyOf(c)
  const asked = asRecord(body.generateContentRequest) ?? body
  const total = promptTokens(geminiRequest(asked, model, false))

  return c.json({
    totalTokens: total,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: total }],
  })
}

async function batchEmbed(c: Context, model: string) {
  const requests = (await bodyOf(c)).requests

  return c.json({
    embeddings: (Array.isArray(requests) ? requests : []).map((entry) =>
      embedding(asRecord(entry) ?? {}, model),
    ),
  })
}

export function googleRoutes(emulator: EmulatorContext): void {
  const { app } = emulator

  app.post("/:version/models/:method", async (c) => {
    onlyFor(c, "google")

    const asked = methodOf(c)

    switch (asked.method) {
      case "generateContent":
      case "streamGenerateContent":
        return generate(emulator, c, asked)
      case "countTokens":
        return countTokens(c, asked.model)
      case "embedContent":
        return c.json({ embedding: embedding(await bodyOf(c), asked.model) })
      case "batchEmbedContents":
        return batchEmbed(c, asked.model)
      default:
        throw new HttpError(404, `Method ${asked.method} is not found for model ${asked.model}`)
    }
  })

  app.get("/v1beta/models", (c) => {
    onlyFor(c, "google")

    return c.json(geminiModels(emulator))
  })
}

/** The models list in Gemini's shape: `models/<id>` names and the methods each supports. */
export function geminiModels(emulator: EmulatorContext): unknown {
  return {
    models: llmStore(emulator.store)
      .settings()
      .models.map((id) => ({
        name: `models/${id}`,
        displayName: id,
        inputTokenLimit: 1_048_576,
        outputTokenLimit: 65_536,
        supportedGenerationMethods: ["generateContent", "countTokens"],
      })),
  }
}
