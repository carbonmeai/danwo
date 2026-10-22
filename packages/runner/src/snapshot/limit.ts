/**
 * How much page text one view may hold for the model that reads it. A page view is the bulk of
 * every prompt, so it gets a share of the model's input window: a quarter, at about four
 * characters a token, which leaves the rest for the instruction, the conversation so far and the
 * answer. Known model families are matched by their id; a model this does not know gets the
 * default, which fits a 128k-token window. Large windows are capped at that default too: past it, a
 * dense page costs more on every turn and shows the model little it needs.
 */
import type { LanguageModel } from "ai"

import { modelName } from "../model/resolve.ts"

/** Characters a view keeps for a model whose input window is not known; about 30k tokens. */
export const DEFAULT_VIEW_CHARS = 120_000

/** The fewest characters a view keeps, however small the window: enough for a simple form. */
const MIN_VIEW_CHARS = 8_000

/** Roughly how many characters of an accessibility tree make one token. */
const CHARS_PER_TOKEN = 4

/** The part of the input window one view may take. */
const VIEW_SHARE = 0.25

/**
 * Input windows in tokens, by a pattern over the model's own id, without its provider (an
 * `ollama/` provider is no Llama). The first match wins, so a narrower pattern comes before the
 * family it belongs to.
 */
const WINDOWS: readonly (readonly [RegExp, number])[] = [
  [/gpt-3\.5/, 16_000],
  [/gpt-4-32k/, 32_000],
  [/gpt-4(?:-0\d{3})?$/, 8_000],
  [/gpt-4o|gpt-4-turbo|gpt-4\.5/, 128_000],
  [/gpt-4\.1|gpt-5|^o[134](?:-|$)/, 200_000],
  [/claude/, 200_000],
  [/gemini/, 1_000_000],
  [/llama-?3\.[1-9]|llama-?4/, 128_000],
  [/llama/, 8_000],
  [/codestral/, 256_000],
  [/mistral-(?:large|medium|small)|ministral|pixtral/, 128_000],
  [/mistral|mixtral/, 32_000],
  [/deepseek/, 64_000],
  [/qwen/, 32_000],
  [/grok/, 128_000],
]

/** The model's input window in tokens, when its id names a family this knows. */
export function inputWindow(model: LanguageModel | undefined): number | undefined {
  const name = modelName(model)?.toLowerCase().split("/").at(-1)

  if (name === undefined) return undefined

  return WINDOWS.find(([pattern]) => pattern.test(name))?.[1]
}

/** How many characters of page text one view may hold for `model`. */
export function viewLimit(model: LanguageModel | undefined): number {
  const window = inputWindow(model)

  if (window === undefined) return DEFAULT_VIEW_CHARS

  const share = Math.floor(window * CHARS_PER_TOKEN * VIEW_SHARE)

  return Math.max(MIN_VIEW_CHARS, Math.min(DEFAULT_VIEW_CHARS, share))
}
