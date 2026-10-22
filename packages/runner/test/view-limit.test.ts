/**
 * The page view's length follows the model that reads it: a quarter of its input window, never
 * more than the default, never less than a floor, and the default for a model it does not know.
 */
import { MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"

import { DEFAULT_VIEW_CHARS, inputWindow, viewLimit } from "../src/snapshot/limit.ts"

function model(provider: string, modelId: string) {
  return new MockLanguageModelV4({ provider, modelId })
}

describe("the view's length for a model", () => {
  it.each([
    ["anthropic/claude-sonnet-5", 200_000, DEFAULT_VIEW_CHARS],
    ["openai/gpt-5-mini", 200_000, DEFAULT_VIEW_CHARS],
    ["openai/gpt-4o-mini", 128_000, DEFAULT_VIEW_CHARS],
    ["openai/o4-mini", 200_000, DEFAULT_VIEW_CHARS],
    ["google/gemini-3-flash", 1_000_000, DEFAULT_VIEW_CHARS],
    ["deepseek/deepseek-chat", 64_000, 64_000],
    ["mistral/mixtral-8x7b", 32_000, 32_000],
    ["openai/gpt-3.5-turbo", 16_000, 16_000],
    ["openai/gpt-4", 8_000, 8_000],
    ["meta/llama-3.3-70b", 128_000, DEFAULT_VIEW_CHARS],
  ])("%s has a %d-token window and a %d-character view", (id, window, chars) => {
    expect(inputWindow(id)).toBe(window)
    expect(viewLimit(id)).toBe(chars)
  })

  it("reads a model instance by its provider and id", () => {
    expect(viewLimit(model("ollama", "qwen2.5-coder"))).toBe(32_000)
  })

  it("gives a model it does not know the default", () => {
    expect(inputWindow(model("local", "house-model"))).toBeUndefined()
    expect(viewLimit(model("local", "house-model"))).toBe(DEFAULT_VIEW_CHARS)
    expect(viewLimit(undefined)).toBe(DEFAULT_VIEW_CHARS)
  })
})
