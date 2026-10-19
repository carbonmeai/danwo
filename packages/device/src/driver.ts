/**
 * The device driver danwo needs: read the screen, act on an element by its ref, take a screenshot.
 * One implementation wraps agent-device (agent-device.ts, the only module that imports it); tests
 * use a scripted one.
 */
import type { DriverNode } from "./tree.ts"

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
  /** Saves a PNG of the screen; false when none could be taken. */
  screenshot(path: string): Promise<boolean>
  /** Ends the session; the device keeps running. */
  close(): Promise<void>
}
