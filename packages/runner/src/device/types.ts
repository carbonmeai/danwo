/**
 * What a mobile device gives a test in place of a browser. @danwo/device implements `DeviceTarget`
 * for an Android emulator; the runner turns it into the same `screen`, `app` and `expect` a web test
 * gets, with locators resolved here on the device's accessibility tree.
 */

/** One element on the device's screen, as locators see it. */
export interface DeviceNode {
  /** The device driver's handle for acting on this element, valid until the screen is read again. */
  readonly ref: string
  /** A role in web terms: `button`, `textbox`, `heading`, `text`, `img`, `checkbox`, `switch`, `generic`… */
  readonly role: string
  /** The accessible name: the element's label or content description. */
  readonly name: string
  /** The text the element shows: its label, or a field's value. */
  readonly text: string
  /** A field's current value. */
  readonly value?: string
  /** React Native's `testID` (Android's resource id, without the package). */
  readonly testId?: string
  /** A field's hint, while it shows. */
  readonly placeholder?: string
  readonly editable: boolean
  readonly password: boolean
  readonly enabled: boolean
  readonly checked?: boolean
  /** The ref of the element that contains this one. */
  readonly parent?: string
  /** Where it is on the screen, in screenshot pixels. */
  readonly box?: DeviceBox
}

/** A rectangle on the screen, in screenshot pixels. */
export interface DeviceBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A way to swipe: the direction the finger moves is the opposite of where the content goes. */
export type ScrollDirection = "up" | "down" | "left" | "right"

/** What is in front on the device. */
export interface DeviceForeground {
  /** The package of the app (or browser) in front, e.g. `com.danwo.shopmobile`. */
  readonly package: string
  /** True when a browser is in front, such as a Custom Tab the app opened for checkout. */
  readonly browser: boolean
  /** The page a browser in front is showing, when known. */
  readonly url?: string
}

/** One reading of the device's screen. */
export interface DeviceScreenReading {
  /** The elements on screen, outermost first; status and navigation bars left out. */
  readonly nodes: readonly DeviceNode[]
}

/** A line of the device's log, from the app under test. */
export interface DeviceLogLine {
  readonly at: string
  readonly level: "debug" | "info" | "warn" | "error"
  readonly text: string
}

/** How a start went. */
export interface DeviceStart {
  /** Why the app had to be launched a second time, when it did. */
  readonly relaunched: string | undefined
}

/** A device an attempt drives instead of a browser. */
export interface DeviceTarget {
  readonly platform: "android"
  /** The app's package, e.g. `com.danwo.shopmobile`. */
  readonly app: string
  /** The app's link scheme, e.g. `danwoshop`; `app.open(path)` opens `<scheme>://<path>`. */
  readonly scheme?: string | undefined
  /** The app back to a fresh install's state and in front: data cleared, permissions granted, launched. */
  startApp(): Promise<DeviceStart>
  /** Opens `url` (a deep link, or a web page in the device's browser). */
  openLink(url: string): Promise<void>
  /** Reads the screen. */
  read(): Promise<DeviceScreenReading>
  /** What is in front: the app, or a browser it opened (and the page it shows). */
  foreground(): Promise<DeviceForeground>
  /** Taps the element with this ref, from the latest reading. */
  tap(ref: string): Promise<void>
  /** Types `text` into the field with this ref, in place of what it holds. */
  fill(ref: string, text: string): Promise<void>
  /** Presses the device's Back button. */
  back(): Promise<void>
  /**
   * Scrolls the screen (or the part of it in `within`, a list's box) to show what is further
   * `direction`: `down` swipes the finger up, as a person scrolls a list down.
   */
  scroll?(direction: ScrollDirection, within?: DeviceBox): Promise<void>
  /** Presses a key by its name: `Enter`, `Tab`, `Backspace`, `Escape`, `Home`, `ArrowDown`… */
  pressKey?(key: string): Promise<void>
  /** Taps a point of the screen, in screenshot pixels. */
  tapAt?(x: number, y: number): Promise<void>
  /** Types `text` into whatever has focus. */
  typeText?(text: string): Promise<void>
  /** Saves a PNG of the screen to `path`; false when none could be taken. */
  screenshot(path: string): Promise<boolean>
  /** The app's log lines since the last call, oldest first. */
  logs?(): Promise<readonly DeviceLogLine[]>
  /**
   * Starts filming the screen into `path` (an MP4); undefined when this device cannot film. The
   * film is written once it is stopped.
   */
  recordScreen?(path: string): Promise<ScreenFilm | undefined>
}

/** The screen being filmed. */
export interface ScreenFilm {
  /** When filming began, by the wall clock in milliseconds. */
  readonly startedAt: number
  /** Stops filming and writes the file; false when no file could be written. */
  stop(): Promise<boolean>
}
