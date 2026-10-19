/**
 * The agent's tools on a device: what a person does with a phone, each aimed at an element by the
 * ref it carries in the latest view, plus `done`. The runner carries out every call itself.
 */
import { tool } from "ai"
import { z } from "zod"

import { parseToolCall, toolInputs } from "../../agent/tools.ts"

const ref = z.string().describe('The element\'s ref from the latest view, e.g. "e12".')

/** What each tool takes; the runner parses every call against these. Shared ones are the web's. */
const deviceToolInputs = {
  tap: toolInputs.click,
  fill: toolInputs.fill,
  fill_secret: toolInputs.fill_secret,
  check: toolInputs.check,
  select: toolInputs.select,
  press_key: z.object({
    key: z.string().describe('A key: "Enter", "Tab", "Backspace", "Escape", "ArrowDown"…'),
    ref: ref.optional().describe("A field to tap first, so the key goes to it."),
  }),
  scroll: z.object({
    direction: z.enum(["up", "down", "left", "right"]),
    ref: ref
      .optional()
      .describe("A list or other scrollable element; the whole screen without it."),
  }),
  back: toolInputs.back,
  open_link: z.object({ url: z.string().describe("A deep link of the app or a web URL.") }),
  wait_for: z.object({
    text: z.string().optional(),
    ref: ref.optional(),
    state: z.enum(["visible", "hidden"]).optional(),
    ms: z.number().max(10_000).optional(),
  }),
  look: toolInputs.look,
  tap_at: toolInputs.click_at,
  type_at: toolInputs.type_at,
  done: toolInputs.done,
}

export type DeviceToolName = keyof typeof deviceToolInputs
export type DeviceToolInput<Name extends DeviceToolName> = z.infer<(typeof deviceToolInputs)[Name]>

const descriptions: Record<DeviceToolName, string> = {
  tap: "Tap an element: a button, link, list item, tab, checkbox or field.",
  fill: "Replace the content of a text field with `text`.",
  fill_secret:
    "Type a secret into a field by the secret's name. You never see secret values; the device gets it.",
  check: "Turn a checkbox or switch on (`checked: true`) or off.",
  select: "Open a picker (a dropdown or spinner) and choose the option with this text.",
  press_key: "Press a key, e.g. Enter to submit a field; with `ref`, that field gets it.",
  scroll:
    "Scroll the screen, or the element `ref`, to show what is further up, down, left or right.",
  back: "Press the device's Back button.",
  open_link:
    "Open a link: the app's own deep link, or a web page in the device's browser. Prefer tapping what the screen offers.",
  wait_for:
    "Wait until `text` or element `ref` appears (or with `state: hidden`, goes away), or for `ms` milliseconds.",
  look: "See the screen as a screenshot with numbered marks over what can be tapped, for what the text view does not show.",
  tap_at: "Tap a place on the latest screenshot: a mark, or x and y.",
  type_at: "Tap a place on the latest screenshot, then type `text` (or the secret named `secret`).",
  done: "End the step: `passed` once the instruction is carried out, `failed` when it cannot be. Say why in `summary`.",
}

/** Every tool answers with a line of text: what happened, and the screen after it. */
const outcome = z.string()

function offer<Input>(name: DeviceToolName, inputSchema: z.ZodType<Input>) {
  return tool({ description: descriptions[name], inputSchema, outputSchema: outcome })
}

const tools = {
  tap: offer("tap", deviceToolInputs.tap),
  fill: offer("fill", deviceToolInputs.fill),
  fill_secret: offer("fill_secret", deviceToolInputs.fill_secret),
  check: offer("check", deviceToolInputs.check),
  select: offer("select", deviceToolInputs.select),
  press_key: offer("press_key", deviceToolInputs.press_key),
  scroll: offer("scroll", deviceToolInputs.scroll),
  back: offer("back", deviceToolInputs.back),
  open_link: offer("open_link", deviceToolInputs.open_link),
  wait_for: offer("wait_for", deviceToolInputs.wait_for),
  done: offer("done", deviceToolInputs.done),
}

const visionTools = {
  look: offer("look", deviceToolInputs.look),
  tap_at: offer("tap_at", deviceToolInputs.tap_at),
  type_at: offer("type_at", deviceToolInputs.type_at),
}

/** The tools a device step is offered: with the vision tools when it may see the screen. */
export function deviceToolsFor(vision: boolean) {
  return vision ? { ...tools, ...visionTools } : tools
}

/** The tools that act: every tool but `done`. */
type ActionName = Exclude<DeviceToolName, "done">

/** A call of one tool, with that tool's input. */
export type DeviceCall = {
  [Name in ActionName]: { readonly name: Name; readonly input: DeviceToolInput<Name> }
}[ActionName]

/** A raw tool call parsed, or what was wrong with it in words the model can act on. */
export function parseDeviceCall(
  name: string,
  input: unknown,
): { readonly call: DeviceCall } | { readonly problem: string } {
  return parseToolCall(deviceToolInputs, name, input)
}
