/* The shapes of `screen` and its locators, as a test file uses them. */
import type { Page } from "playwright-core"

import type { Secret } from "../secrets/index.ts"

/** A string matches as Playwright does (case-insensitive substring) unless `exact`; a RegExp tests. */
export type TextMatch = string | RegExp

/** The ARIA roles Playwright knows, e.g. `"button"` or `"heading"`. */
export type AriaRole = Parameters<Page["getByRole"]>[0]

/** Narrows `getByRole` by accessible name (`exact` for a whole, case-sensitive match) and state. */
export type RoleOptions = NonNullable<Parameters<Page["getByRole"]>[1]>

/** `exact` matches the whole text, case-sensitively. */
export type TextOptions = NonNullable<Parameters<Page["getByText"]>[1]>

/** Options of one read of an element. */
export interface ReadOptions {
  /** Milliseconds to wait for the element to be ready; the session's action timeout by default. */
  readonly timeout?: number
}

/** Options of one action. */
export interface ActionOptions extends ReadOptions {
  /**
   * Acts without waiting for the element to be visible, stable, enabled and not covered by
   * another element. An escape hatch for a control a user can reach but Playwright's checks
   * refuse. `press`, `setInputFiles` and device locators ignore it.
   */
  readonly force?: boolean
}

/** An action on the single matched element. */
type Action = (options?: ActionOptions) => Promise<void>

/** A read of the single matched element, waiting up to the timeout for it to exist. */
type Read<T> = (options?: ReadOptions) => Promise<T>

/** Options of `waitFor`. */
export interface WaitOptions extends ReadOptions {
  readonly state?: "attached" | "detached" | "visible" | "hidden"
}

/** Finds elements the way a user names them. */
export interface Screen {
  getByRole(role: AriaRole, options?: RoleOptions): Locator
  getByLabel(text: TextMatch, options?: TextOptions): Locator
  getByPlaceholder(text: TextMatch, options?: TextOptions): Locator
  getByText(text: TextMatch, options?: TextOptions): Locator
  /** An input, textarea or select whose current value is `value` (whole, unless a RegExp). */
  getByDisplayValue(value: TextMatch): Locator
  /** By the `data-testid` attribute. */
  getByTestId(id: TextMatch): Locator
}

/**
 * Some elements on the page, found again on every use. Actions need exactly one; reads of one
 * element (text, value, state) do too.
 */
export interface Locator extends Screen {
  /** Actions that take no input; each waits for the element to be ready. */
  readonly click: Action
  /** `click` by its mobile name; the same action on a web page. */
  readonly tap: Action
  readonly clear: Action
  readonly check: Action
  readonly uncheck: Action
  readonly hover: Action
  /** Types `value` in place of what the field holds; a secret's value never reaches a record. */
  fill(value: string | Secret, options?: ActionOptions): Promise<void>
  /** Presses a key such as `"Enter"` or `"Control+A"` with the element focused. */
  press(key: string, options?: ActionOptions): Promise<void>
  /**
   * Puts files into a file input (or the file picker the element opens), by the names the session
   * offers them under (`files` in its options), never by path.
   */
  setInputFiles(files: string | readonly string[], options?: ActionOptions): Promise<void>
  /** Drags this element and drops it on `target`. */
  dragTo(target: Locator, options?: ActionOptions): Promise<void>
  /** Selects options by value or label. */
  selectOption(option: string | readonly string[], options?: ActionOptions): Promise<void>
  /** Waits for the element to become visible, or another `state`. */
  waitFor(options?: WaitOptions): Promise<void>

  readonly textContent: Read<string | null>
  readonly innerText: Read<string>
  /** A field's current value; refuses password fields. */
  readonly inputValue: Read<string>
  getAttribute(name: string, options?: ReadOptions): Promise<string | null>
  /** Reads that answer at once, without waiting for the element. */
  isVisible(): Promise<boolean>
  isHidden(): Promise<boolean>
  /** Whether the single matched element is enabled, disabled or checked. */
  readonly isEnabled: Read<boolean>
  readonly isDisabled: Read<boolean>
  readonly isChecked: Read<boolean>

  count(): Promise<number>
  /** One locator per element matched right now. */
  all(): Promise<Locator[]>
  allTextContents(): Promise<string[]>
  first(): Locator
  last(): Locator
  nth(index: number): Locator
  filter(options: { readonly hasText?: TextMatch; readonly has?: Locator }): Locator
}

/** Turns a secret handle into its value at the moment it is typed. */
export interface SecretResolver {
  resolve(secret: Secret): Promise<string>
}
