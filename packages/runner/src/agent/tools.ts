/**
 * The agent's tools: the things a person does to a page, each aimed at an element by the ref it
 * carries in the latest view (`[ref=e12]`), plus `done` to end the step. The runner carries out
 * every call itself, so no tool has an `execute`.
 */
import { tool } from "ai"
import { z } from "zod"

const ref = z.string().describe('The element\'s ref from the latest page view, e.g. "e12".')

/** A place on the latest screenshot: a mark, or x and y, and always what is there. */
const spot = {
  mark: z.number().int().positive().optional().describe("A mark number from the latest look."),
  x: z.number().optional().describe("Screenshot pixels from the left, when no mark fits."),
  y: z.number().optional().describe("Screenshot pixels from the top, when no mark fits."),
  description: z.string().describe('What is there, e.g. "the green Pay button".'),
}

/** What each tool takes; the runner parses every call against these. */
export const toolInputs = {
  click: z.object({ ref }),
  fill: z.object({ ref, text: z.string() }),
  fill_secret: z.object({ ref, secret: z.string().describe("The secret's name.") }),
  press: z.object({ key: z.string(), ref: ref.optional() }),
  select: z.object({ ref, option: z.string() }),
  check: z.object({ ref, checked: z.boolean() }),
  hover: z.object({ ref }),
  upload_file: z.object({
    ref,
    files: z.array(z.string()).min(1).describe("Names of files the step offers, not paths."),
  }),
  drag: z.object({ ref, to: ref }),
  dialog: z.object({
    accept: z.boolean(),
    text: z.string().optional().describe("What to type into a prompt dialog before accepting."),
  }),
  scroll: z.object({ direction: z.enum(["up", "down"]).optional(), ref: ref.optional() }),
  navigate: z.object({ url: z.string() }),
  back: z.object({}),
  switch_tab: z.object({ tab: z.number().int().nonnegative() }),
  wait_for: z.object({
    text: z.string().optional(),
    ref: ref.optional(),
    state: z.enum(["visible", "hidden"]).optional(),
    network_idle: z.boolean().optional(),
    ms: z.number().max(10_000).optional(),
  }),
  read_mail: z.object({
    to: z.string().describe("The email address or phone number the app wrote to."),
    pick: z.enum(["code", "link"]),
    match: z
      .string()
      .optional()
      .describe("For a link: a word in its text or URL, when the mail has several."),
  }),
  open_mail: z.object({ to: z.string().describe("The email address the app wrote to.") }),
  look: z.object({}),
  click_at: z.object(spot),
  type_at: z.object({
    ...spot,
    text: z.string().optional().describe("What to type."),
    secret: z.string().optional().describe("Or a secret's name, to type the secret."),
  }),
  drag_at: z.object({ from: z.object(spot), to: z.object(spot) }),
  scroll_at: z.object({ ...spot, direction: z.enum(["up", "down"]) }),
  done: z.object({ status: z.enum(["passed", "failed"]), summary: z.string() }),
}

export type ToolName = keyof typeof toolInputs
export type ToolInput<Name extends ToolName> = z.infer<(typeof toolInputs)[Name]>

/** Every tool answers with a line of text: what happened, and the page after it. */
const outcome = z.string()

const descriptions: Record<ToolName, string> = {
  click: "Click an element: a button, link, checkbox, tab or menu item.",
  fill: "Replace the content of a text field with `text`.",
  fill_secret:
    "Type a secret into a field by the secret's name. You never see secret values; the browser fills it in.",
  press:
    'Press a key or a combination such as "Enter", "Escape", "ArrowDown" or "Control+A", on an element or on the page.',
  select: "Choose an option of a select box by its label or value.",
  check: "Tick (`checked: true`) or untick a checkbox or switch.",
  hover:
    "Move the pointer over an element, e.g. to open a menu or tooltip that only shows on hover.",
  upload_file:
    "Attach files to a file input, or to a button that opens a file picker. Name only files the step offers.",
  drag: "Drag the element `ref` and drop it on the element `to`.",
  dialog:
    "Answer the alert, confirm or prompt dialog that is open: accept (with `text` for a prompt) or dismiss.",
  scroll: "Scroll the page up or down, or scroll element `ref` into view.",
  navigate: "Go to a URL or a path of the app. Prefer clicking links the page offers.",
  back: "Go back to the previous page, like the browser's back button.",
  switch_tab: "Make tab `tab` (as the view numbers them) the one you see and act on.",
  wait_for:
    "Wait until `text` or element `ref` appears (or with `state: hidden`, goes away), until the network is idle, or for `ms` milliseconds.",
  read_mail:
    "Read the newest email or text message the app sent to `to` (an email address or a phone number): its one-time code, or a link (the first, or the one `match` names). Use what it gives you with fill or navigate.",
  open_mail:
    "Show the newest email the app sent to `to` in the current tab, to read it or click a link in it.",
  look: "See the page as a screenshot with numbered marks over what can be clicked, for what the text view does not show.",
  click_at: "Click a place on the latest screenshot: a mark, or x and y.",
  type_at:
    "Click a place on the latest screenshot, then type `text` (or the secret named `secret`) there.",
  drag_at: "Drag from one place on the latest screenshot to another.",
  scroll_at: "Scroll up or down with the pointer over a place on the latest screenshot.",
  done: "End the step: `passed` once the instruction is carried out, `failed` when it cannot be. Say why in `summary`.",
}

/** One tool as the model is offered it. */
function offer<Input>(name: ToolName, inputSchema: z.ZodType<Input>) {
  return tool({ description: descriptions[name], inputSchema, outputSchema: outcome })
}

/** The tools as the model is offered them. */
const agentTools = {
  click: offer("click", toolInputs.click),
  fill: offer("fill", toolInputs.fill),
  fill_secret: offer("fill_secret", toolInputs.fill_secret),
  press: offer("press", toolInputs.press),
  select: offer("select", toolInputs.select),
  check: offer("check", toolInputs.check),
  hover: offer("hover", toolInputs.hover),
  upload_file: offer("upload_file", toolInputs.upload_file),
  drag: offer("drag", toolInputs.drag),
  dialog: offer("dialog", toolInputs.dialog),
  scroll: offer("scroll", toolInputs.scroll),
  navigate: offer("navigate", toolInputs.navigate),
  back: offer("back", toolInputs.back),
  switch_tab: offer("switch_tab", toolInputs.switch_tab),
  wait_for: offer("wait_for", toolInputs.wait_for),
  read_mail: offer("read_mail", toolInputs.read_mail),
  open_mail: offer("open_mail", toolInputs.open_mail),
  done: offer("done", toolInputs.done),
}

/** The tools that work on the page as an image; offered only when the step may use vision. */
const visionTools = {
  look: offer("look", toolInputs.look),
  click_at: offer("click_at", toolInputs.click_at),
  type_at: offer("type_at", toolInputs.type_at),
  drag_at: offer("drag_at", toolInputs.drag_at),
  scroll_at: offer("scroll_at", toolInputs.scroll_at),
}

/** The tools a step is offered: with the vision tools when it may use vision. */
export function toolsFor(vision: boolean) {
  return vision ? { ...agentTools, ...visionTools } : agentTools
}
