/**
 * What the MCP server and a live session's process say to each other. A session process owns one
 * project environment (app, emulators, proxy) and one browser for as long as the session is open;
 * the server forwards each tool call to it as one request and relays its answer. Answers are
 * already redacted and written for the agent, so secret values never leave the session process.
 * Messages are plain JSON over the child's IPC channel.
 */
import type { JobPlace } from "../jobs/protocol.ts"

/** What an action works on: a ref from the latest snapshot (`e12`) or a locator expression. */
export type Target = string

/** A key held down during a click; `ControlOrMeta` is Meta on macOS and Control elsewhere. */
export type Modifier = "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift"

/**
 * A file to upload: a path in the project, a file the config offers tests by name, or bytes the
 * agent passes as text or base64.
 */
export type UploadFile =
  | { readonly path: string }
  | { readonly file: string }
  | { readonly name: string; readonly text: string; readonly mimeType?: string | undefined }
  | { readonly name: string; readonly base64: string; readonly mimeType?: string | undefined }

export type SessionCall =
  | { readonly kind: "snapshot" }
  | {
      readonly kind: "click"
      readonly target: Target
      readonly modifiers?: readonly Modifier[] | undefined
      readonly button?: "left" | "right" | "middle" | undefined
      readonly double?: boolean | undefined
    }
  | { readonly kind: "hover"; readonly target: Target }
  | { readonly kind: "fill"; readonly target: Target; readonly value: string }
  | { readonly kind: "fill_secret"; readonly target: Target; readonly secret: string }
  | { readonly kind: "press"; readonly key: string; readonly target?: Target | undefined }
  | { readonly kind: "select"; readonly target: Target; readonly values: readonly string[] }
  | { readonly kind: "check"; readonly target: Target; readonly checked: boolean }
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "drag"; readonly target: Target; readonly to: Target }
  | { readonly kind: "tabs" }
  | { readonly kind: "switch_tab"; readonly tab: number }
  | { readonly kind: "close_tab"; readonly tab?: number | undefined }
  | { readonly kind: "upload"; readonly target: Target; readonly files: readonly UploadFile[] }
  | { readonly kind: "check_locator"; readonly locator: string }
  | {
      readonly kind: "screenshot"
      readonly target?: Target | undefined
      readonly fullPage: boolean
    }
  | { readonly kind: "emulator_state"; readonly emulator?: string | undefined }
  | { readonly kind: "exchanges"; readonly from: "last" | "open"; readonly bodies: boolean }
  | { readonly kind: "deliver_webhooks" }
  | { readonly kind: "inject_fault"; readonly fault: string }
  | { readonly kind: "clear_faults" }
  | { readonly kind: "start_recording"; readonly video: boolean }
  | { readonly kind: "stop_recording" }
  | { readonly kind: "close" }

/** A session's answer to one call: text for the agent, and an image when one was asked for. */
export interface SessionAnswer {
  readonly text: string
  readonly image?: { readonly data: string; readonly mimeType: string } | undefined
}

/** How the server asks a session process to start. */
export interface OpenRequest {
  readonly type: "open"
  readonly place: JobPlace
  /** The session's slot, handed to the environment as its worker index. */
  readonly slot: number
  readonly id: string
  readonly path: string
}

export interface CallRequest {
  readonly type: "call"
  readonly seq: number
  readonly call: SessionCall
}

export type SessionRequest = OpenRequest | CallRequest

export type SessionMessage =
  | { readonly type: "opened"; readonly answer: SessionAnswer }
  | { readonly type: "line"; readonly text: string }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "answer"; readonly seq: number; readonly answer: SessionAnswer }
  | { readonly type: "error"; readonly seq: number; readonly message: string }

function hasType(value: unknown): value is { readonly type: unknown } {
  return typeof value === "object" && value !== null && "type" in value
}

/** Narrows an IPC message from a session process. */
export function isSessionMessage(value: unknown): value is SessionMessage {
  if (!hasType(value)) return false

  return ["opened", "line", "failed", "answer", "error"].includes(String(value.type))
}

/** Narrows an IPC message from the server. */
export function isSessionRequest(value: unknown): value is SessionRequest {
  return hasType(value) && (value.type === "open" || value.type === "call")
}
