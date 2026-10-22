/**
 * The device driver danwo needs: read the screen, act on an element by its ref, take a screenshot.
 * One implementation wraps agent-device (agent-device.ts, the only module that imports it); tests
 * use a scripted one.
 */
import type { DriverNode } from "./tree.ts"

/** A point on the screen. */
export interface Point {
  readonly x: number
  readonly y: number
}

export interface DeviceDriver {
  /** Starts a session on the device, with `app` in front. */
  open(app: string): Promise<void>
  /** The whole accessibility tree, refs valid until the next snapshot. */
  snapshot(): Promise<readonly DriverNode[]>
  /** Taps the element with `ref`. */
  tap(ref: string): Promise<void>
  /** Types `text` into the field with `ref`, replacing what it holds. */
  fill(ref: string, text: string): Promise<void>
  /** Types `text` into whatever has focus, any characters; without it adb types ASCII only. */
  type?(text: string): Promise<void>
  /** Taps a point, in the driver's own units (those of the snapshot's rectangles). */
  tapAt?(x: number, y: number): Promise<void>
  /**
   * Drags one finger from `from` to `to`, in the driver's own units, over `durationMs` when given
   * (the driver's own quick swipe otherwise).
   */
  swipe?(from: Point, to: Point, durationMs?: number): Promise<void>
  /** Presses the element with `ref` and holds it for `durationMs`. */
  longPress?(ref: string, durationMs: number): Promise<void>
  /** Goes back the platform's way: on iOS, the screen's back or close control, or an edge swipe. */
  back?(): Promise<void>
  /** Presses the on-screen keyboard's return key. */
  pressEnter?(): Promise<void>
  /** Puts the on-screen keyboard away. */
  dismissKeyboard?(): Promise<void>
  /** Saves a PNG of the screen; false when none could be taken. */
  screenshot(path: string): Promise<boolean>
  /** Ends the session; the device keeps running. */
  close(): Promise<void>
}
