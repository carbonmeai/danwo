/**
 * The models list, which OpenAI, Anthropic, Perplexity and Gemini's `v1` all serve at
 * `GET /v1/models`, each in its own shape.
 */
import type { EmulatorContext } from "../../define.ts"
import { providerOf } from "../helpers.ts"
import { llmStore } from "../store.ts"
import { unixSeconds } from "../wire.ts"
import { geminiModels } from "./google.ts"

export function modelRoutes(emulator: EmulatorContext): void {
  const { app, clock, store } = emulator

  app.get("/v1/models", (c) => {
    const models = llmStore(store).settings().models
    const now = clock()
    const provider = providerOf(c)

    if (provider === "google") return c.json(geminiModels(emulator))

    if (provider === "anthropic") {
      return c.json({
        data: models.map((id) => ({
          type: "model",
          id,
          display_name: id,
          created_at: now.toISOString(),
        })),
        has_more: false,
        first_id: models[0] ?? null,
        last_id: models.at(-1) ?? null,
      })
    }

    return c.json({
      object: "list",
      data: models.map((id) => ({
        id,
        object: "model",
        created: unixSeconds(now),
        owned_by: "danwo",
      })),
    })
  })
}
