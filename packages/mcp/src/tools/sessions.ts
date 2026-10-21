/**
 * Live sessions: the app open in danwo's browser, behind its emulators and proxy, driven one step
 * at a time by the agent with no model on danwo's side. Actions answer with what changed on the
 * page; the emulator tools show and fault the services behind the app.
 */
import { FAULT_FORMS } from "@danwo/runner/runner"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z, type ZodRawShape } from "zod"

import { answer, progressOf } from "../reply.ts"
import type { SessionManager } from "../sessions/manager.ts"
import type { SessionAnswer, SessionCall } from "../sessions/protocol.ts"
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, sizeText } from "../sessions/upload.ts"

const session = z.string().describe("the session id open_session returned, e.g. s1")
const target = z
  .string()
  .describe(
    'what to act on: a ref from the latest snapshot ("e12"), or a locator as a test writes it, e.g. getByRole("button", { name: "Pay" }) or getByLabel("Email")',
  )

const mimeType = z.string().optional().describe("e.g. image/png; guessed from the name if left out")

/** One file to upload, in one of the ways an agent can give it. */
const UploadFile = z.union([
  z.strictObject({ path: z.string().describe("a path in the project, relative to its folder") }),
  z.strictObject({ file: z.string().describe("a file the config offers tests by name (files)") }),
  z.strictObject({
    name: z.string(),
    text: z.string().describe("the file's content as text"),
    mimeType,
  }),
  z.strictObject({
    name: z.string(),
    base64: z.string().describe("the file's bytes, base64"),
    mimeType,
  }),
])

const modifiers = z
  .array(z.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))
  .optional()
  .describe("keys held during the click; ControlOrMeta is Meta on macOS, Control elsewhere")
const button = z.enum(["left", "right", "middle"]).optional().describe('default "left"')
const double = z.boolean().optional().describe("a double click")

function reply(result: SessionAnswer): CallToolResult {
  return {
    content: [
      { type: "text", text: result.text },
      ...(result.image === undefined
        ? []
        : [{ type: "image" as const, data: result.image.data, mimeType: result.image.mimeType }]),
    ],
  }
}

/**
 * Every session tool's arguments, all but the session optional. Each tool declares its own input
 * schema for the client, which the SDK checks before calling; this one reads them back typed.
 */
const SessionArgs = z.object({
  session: z.string(),
  target: z.string().optional(),
  value: z.string().optional(),
  secret: z.string().optional(),
  key: z.string().optional(),
  values: z.array(z.string()).optional(),
  checked: z.boolean().optional(),
  to: z.string().optional(),
  locator: z.string().optional(),
  fullPage: z.boolean().optional(),
  video: z.boolean().optional(),
  emulator: z.string().optional(),
  from: z.enum(["last", "open"]).optional(),
  bodies: z.boolean().optional(),
  fault: z.string().optional(),
  files: z.array(UploadFile).optional(),
  modifiers,
  button,
  double,
})

type SessionArgs = z.infer<typeof SessionArgs>

/** An argument the tool's schema requires, so the SDK has already checked it is there. */
function given<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is required`)

  return value
}

interface SessionTool {
  readonly name: string
  readonly description: string
  readonly input: ZodRawShape
  readonly call: (args: SessionArgs) => SessionCall
  readonly readOnly?: boolean
}

function register(server: McpServer, sessions: SessionManager, tool: SessionTool): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: tool.readOnly ?? false },
    },
    (args) =>
      answer(async () => {
        const parsed = SessionArgs.parse(args)

        return reply(await sessions.call(parsed.session, tool.call(parsed)))
      }),
  )
}

const ACTION_NOTE =
  "Answers with what changed on the page (+ new, - gone, or the whole page after a navigation) and the console errors, failed requests and dialogs since the last call."

function registerActions(server: McpServer, sessions: SessionManager): void {
  register(server, sessions, {
    name: "click",
    description: `Click an element: a left click by default; button: "right" for a context menu, double: true for a double click, modifiers to hold keys (Shift to select a range, ControlOrMeta to add to a selection or open a link in a new tab). ${ACTION_NOTE}`,
    input: { session, target, modifiers, button, double },
    call: (args) => ({
      kind: "click",
      target: given(args.target, "target"),
      modifiers: args.modifiers,
      button: args.button,
      double: args.double,
    }),
  })
  register(server, sessions, {
    name: "hover",
    description: `Move the pointer over an element, e.g. to open a menu. ${ACTION_NOTE}`,
    input: { session, target },
    call: (args) => ({ kind: "hover", target: given(args.target, "target") }),
  })
  register(server, sessions, {
    name: "fill",
    description: `Type a value into a field, replacing what it holds. For passwords and keys use fill_secret. ${ACTION_NOTE}`,
    input: { session, target, value: z.string() },
    call: (args) => ({
      kind: "fill",
      target: given(args.target, "target"),
      value: given(args.value, "value"),
    }),
  })
  register(server, sessions, {
    name: "fill_secret",
    description: `Fill a field with one of the project's secrets, by name (danwo://config lists them). The value never appears in any answer, screenshot or recording. ${ACTION_NOTE}`,
    input: { session, target, secret: z.string().describe("the secret's name in danwo.config.ts") },
    call: (args) => ({
      kind: "fill_secret",
      target: given(args.target, "target"),
      secret: given(args.secret, "secret"),
    }),
  })
  register(server, sessions, {
    name: "press",
    description: `Press a key or combination (Enter, Tab, Control+A) on an element, or on the page without a target. ${ACTION_NOTE}`,
    input: { session, key: z.string(), target: target.optional() },
    call: (args) => ({ kind: "press", key: given(args.key, "key"), target: args.target }),
  })
  register(server, sessions, {
    name: "select",
    description: `Choose options of a select element by value or label. ${ACTION_NOTE}`,
    input: { session, target, values: z.array(z.string()).min(1) },
    call: (args) => ({
      kind: "select",
      target: given(args.target, "target"),
      values: given(args.values, "values"),
    }),
  })
  register(server, sessions, {
    name: "check",
    description: `Tick (or with checked: false, untick) a checkbox or radio button. ${ACTION_NOTE}`,
    input: { session, target, checked: z.boolean().optional() },
    call: (args) => ({
      kind: "check",
      target: given(args.target, "target"),
      checked: args.checked ?? true,
    }),
  })
  register(server, sessions, {
    name: "upload",
    description: `Put files into a file input, or into the file chooser an element opens when clicked. Each file is a path in the project, a file the config offers by name, or bytes ({ name, text } or { name, base64 }); ${sizeText(MAX_UPLOAD_BYTES)} and ${MAX_UPLOAD_FILES} files at most per call. An empty list clears the input. ${ACTION_NOTE}`,
    input: { session, target, files: z.array(UploadFile).max(MAX_UPLOAD_FILES) },
    call: (args) => ({
      kind: "upload",
      target: given(args.target, "target"),
      files: given(args.files, "files"),
    }),
  })
  register(server, sessions, {
    name: "navigate",
    description: `Go to a path of the app or a full URL, or "back", "forward", "reload". ${ACTION_NOTE}`,
    input: { session, to: z.string() },
    call: (args) => ({ kind: "navigate", to: given(args.to, "to") }),
  })
}

function registerPageTools(server: McpServer, sessions: SessionManager): void {
  register(server, sessions, {
    name: "snapshot",
    description:
      "The page now as an accessibility tree with refs ([ref=e12]) to act on. Refs belong to the latest snapshot or action answer.",
    input: { session },
    call: () => ({ kind: "snapshot" }),
    readOnly: true,
  })
  register(server, sessions, {
    name: "check_locator",
    description:
      "Check a locator before writing it into a test: exactly one match gives the line to paste; no match or several say why a test using it would fail, with the page's nearest elements.",
    input: {
      session,
      locator: z
        .string()
        .describe('as a test writes it, e.g. getByRole("button", { name: "Sign in" })'),
    },
    call: (args) => ({ kind: "check_locator", locator: given(args.locator, "locator") }),
    readOnly: true,
  })
  register(server, sessions, {
    name: "screenshot",
    description:
      "A PNG of the page (or one element). Password fields, filled secrets and any text showing a secret are masked.",
    input: { session, target: target.optional(), fullPage: z.boolean().optional() },
    call: (args) => ({ kind: "screenshot", target: args.target, fullPage: args.fullPage ?? false }),
    readOnly: true,
  })
  register(server, sessions, {
    name: "start_recording",
    description:
      "Record the session: a screenshot after every action (secrets masked), and with video: true a video too. A video cannot mask secrets, so it is refused once a secret was filled, and fill_secret is refused while it records.",
    input: { session, video: z.boolean().optional() },
    call: (args) => ({ kind: "start_recording", video: args.video ?? false }),
  })
  register(server, sessions, {
    name: "stop_recording",
    description: "Stop recording; answers with where the screenshots and video are.",
    input: { session },
    call: () => ({ kind: "stop_recording" }),
  })
}

function registerServiceTools(server: McpServer, sessions: SessionManager): void {
  register(server, sessions, {
    name: "emulator_state",
    description:
      "What the emulated services behind the app hold now (Stripe objects, sent mail, Slack messages, S3 objects, sign-ins…): rows per collection and the latest few, redacted.",
    input: {
      session,
      emulator: z.string().optional().describe("one emulator by name, e.g. stripe"),
    },
    call: (args) => ({ kind: "emulator_state", emulator: args.emulator }),
    readOnly: true,
  })
  register(server, sessions, {
    name: "exchanges",
    description:
      "What the app and browser sent through danwo's proxy and got back, since the last look (or from: open, since the session opened), with each call's route as inject_fault names it. bodies: true adds redacted request and response bodies.",
    input: { session, from: z.enum(["last", "open"]).optional(), bodies: z.boolean().optional() },
    call: (args) => ({
      kind: "exchanges",
      from: args.from ?? "last",
      bodies: args.bodies ?? false,
    }),
    readOnly: true,
  })
  register(server, sessions, {
    name: "deliver_webhooks",
    description:
      "Deliver the webhooks and pushes the emulators have queued for the app (they wait on the emulators' clock), then list the deliveries since the last look.",
    input: { session },
    call: () => ({ kind: "deliver_webhooks" }),
  })
  register(server, sessions, {
    name: "inject_fault",
    description: `Arm one fault, named as danwo matrix names them; it fires once on the next matching call or delivery. Forms:\n${FAULT_FORMS.join("\n")}`,
    input: { session, fault: z.string() },
    call: (args) => ({ kind: "inject_fault", fault: given(args.fault, "fault") }),
  })
  register(server, sessions, {
    name: "clear_faults",
    description: "Disarm every fault inject_fault armed that has not fired yet.",
    input: { session },
    call: () => ({ kind: "clear_faults" }),
  })
}

function registerLifecycle(server: McpServer, sessions: SessionManager): void {
  server.registerTool(
    "open_session",
    {
      description:
        "Open the app in danwo's browser for step-by-step use: starts the project's environment (its app, emulators and proxy, as a test worker would) and answers with a session id and the page's accessibility tree. No model runs on danwo's side. Several sessions may be open at once, each with its own environment; idle sessions close by themselves.",
      inputSchema: { path: z.string().optional().describe('a path of the app, default "/"') },
    },
    (args, extra) =>
      answer(async () => {
        progressOf(extra)("starting the environment and browser")

        return reply(await sessions.open(args.path ?? "/", extra.signal))
      }),
  )
  server.registerTool(
    "close_session",
    {
      description: "Close a session: its browser, app and emulators stop.",
      inputSchema: { session },
    },
    (args) =>
      answer(async () => {
        await sessions.close(args.session)

        return reply({ text: `session ${args.session} closed` })
      }),
  )
}

/** The groups of session tools, registered in the order clients list them. */
const TOOL_GROUPS = [registerLifecycle, registerPageTools, registerActions, registerServiceTools]

export function registerSessionTools(server: McpServer, sessions: SessionManager): void {
  for (const registerGroup of TOOL_GROUPS) registerGroup(server, sessions)
}
