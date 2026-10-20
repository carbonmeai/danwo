/**
 * The scripted replies the model API suites seed their emulator with: the weather tool call the
 * tool scenarios ask for, and the JSON answer the structured-output scenarios expect.
 */
import type { LlmScript } from "@danwo/emulators"

/** The tool call every model suite's tool scenario expects back. */
export const WEATHER_TOOL_SCRIPT: LlmScript = {
  match: { tool: "weather" },
  reply: { toolCalls: [{ name: "weather", arguments: { city: "Lagos" } }] },
}

/** The JSON answer the structured-output scenarios expect back. */
export const COLOUR_JSON_SCRIPT: LlmScript = {
  match: { user: "colour" },
  reply: { json: { colour: "blue" } },
}
