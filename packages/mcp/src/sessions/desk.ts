/**
 * What a session drives, behind one small interface: a browser page (`PageDesk`) or the
 * environment's mobile device (`DeviceDesk`). The session process hands every page tool to its
 * desk; a tool that only one of them has is refused by the other with a message saying which.
 */
import type { SessionAnswer, SessionCall } from "./protocol.ts"

/** The tools that act on what is in front, by kind. */
export type ActionCall = Extract<
  SessionCall,
  {
    kind:
      | "click"
      | "hover"
      | "fill"
      | "fill_secret"
      | "press"
      | "select"
      | "check"
      | "navigate"
      | "upload"
      | "drag"
      | "switch_tab"
      | "close_tab"
      | "dialog"
      | "back"
      | "scroll"
      | "tap_at"
      | "swipe"
      | "long_press"
      | "dismiss_keyboard"
  }
>

/** The actions only a device has. */
const DEVICE_ONLY = new Set<string>([
  "back",
  "scroll",
  "tap_at",
  "swipe",
  "long_press",
  "dismiss_keyboard",
])

/** The actions only a browser page has. */
const BROWSER_ONLY = new Set<string>([
  "hover",
  "select",
  "upload",
  "drag",
  "switch_tab",
  "close_tab",
  "dialog",
])

export type DeviceOnlyCall = Extract<
  ActionCall,
  { kind: "back" | "scroll" | "tap_at" | "swipe" | "long_press" | "dismiss_keyboard" }
>

type BrowserOnlyCall = Extract<
  ActionCall,
  { kind: "hover" | "select" | "upload" | "drag" | "switch_tab" | "close_tab" | "dialog" }
>

export function isDeviceOnly(call: ActionCall): call is DeviceOnlyCall {
  return DEVICE_ONLY.has(call.kind)
}

export function isBrowserOnly(call: ActionCall): call is BrowserOnlyCall {
  return BROWSER_ONLY.has(call.kind)
}

/** Why a page refuses a device's tool. */
export function deviceOnlyText(kind: string): string {
  const instead =
    kind === "back"
      ? ' (on a page, navigate with to: "back")'
      : kind === "scroll"
        ? " (on a page, actions scroll their element into view by themselves)"
        : kind === "dismiss_keyboard"
          ? " (a page has no on-screen keyboard)"
          : ""

  return `${kind} is for a device session, and this session drives a browser page${instead}`
}

/** What a device on `platform` is called in answers. */
export function deviceName(platform: string): string {
  return platform === "ios" ? "iOS Simulator" : "Android emulator"
}

/** Why a device refuses a browser's tool. */
export function browserOnlyText(kind: string, platform: string): string {
  return `${kind} works on a browser page only, and this session drives an ${deviceName(platform)}: on a device use click (a tap), fill, fill_secret, press, check, navigate, back, scroll, swipe, long_press, dismiss_keyboard and tap_at`
}

/** One session's page or device, driven one tool call at a time. Every answer is redacted. */
export interface SessionDesk {
  /** What is in front now, with refs to act on. */
  snapshot(): Promise<string>
  /** Carries out one action; answers with what it did and what changed. */
  act(call: ActionCall): Promise<string>
  /** Whether a locator finds exactly one element, as `check_locator` answers. */
  check(expression: string): Promise<string>
  /** A PNG with secrets masked, of the whole view or one element. */
  screenshot(target: string | undefined, fullPage: boolean): Promise<SessionAnswer>
  /** The open tabs; a device has none and refuses. */
  tabList(): Promise<string>
  startRecording(video: boolean): Promise<string>
  stopRecording(): Promise<string>
  close(): Promise<void>
}
