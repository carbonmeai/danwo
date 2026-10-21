/*
 * danwo's locators: thin wrappers over Playwright's, which add a step record for every action, a
 * test-shaped name in every error, and secrets that are typed without being recorded. A locator
 * is lazy: it is found again on every use, and actions wait for the element to be ready.
 */
import type { Page, Locator as PlaywrightLocator } from "playwright-core"

import { filePaths, type Files } from "../agent/files.ts"
import type { ScreenshotEvent, ScreenshotSettings } from "../assert/screenshot.ts"
import { setChecked } from "../browser/check.ts"
import { pointAt, type PointerKind } from "../browser/pointer.ts"
import { checkSecretField, markSecretField } from "../secrets/fields.ts"
import { isSecret, type Secret } from "../secrets/index.ts"
import { filterCall, roleCall, shown, textCall } from "./describe.ts"
import { valueSelector } from "./display-value.ts"
import { explain, LocatorError } from "./failure.ts"
import type {
  ActionOptions,
  AriaRole,
  ReadOptions,
  Locator,
  RoleOptions,
  Screen,
  SecretResolver,
  TextMatch,
  TextOptions,
  WaitOptions,
} from "./types.ts"

/** The part of the step recorder locators and assertions write to. */
export interface StepLog {
  run<T>(
    kind: "locator" | "assertion" | "app",
    api: string,
    label: string,
    body: () => Promise<T>,
    options?: { readonly verifies?: boolean },
  ): Promise<T>
  /** Notes the tab the running step found its element in. */
  ranIn?(tab: number): void
}

/** What every locator of one session shares. */
export interface LocateContext {
  /** The page to resolve against, read at every use. */
  readonly page: () => Page
  /** Which tab `page` is, as its video is numbered, so a step records where it ran. */
  readonly tabOf?: (page: Page) => number | undefined
  readonly steps: StepLog
  readonly secrets: SecretResolver
  /** Files tests may upload, by name, as absolute paths. */
  readonly files: Files
  readonly actionTimeout: number
  readonly assertionTimeout: number
  /**
   * How long the next check may wait, given its API, its call and its normal timeout; checks that
   * replay a passing run's steps wait only a few times as long as they took there.
   */
  readonly checkTimeout?: (api: string, label: string, fallback: number) => number
  /** Where screenshot checks keep baselines, and how they number and note what they did. */
  readonly shots: ScreenshotDesk
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready?: () => Promise<void>
}

/** The pointer each action shows; actions not listed show none. */
const POINTER_OF: Readonly<Record<string, PointerKind>> = {
  click: "click",
  check: "click",
  uncheck: "click",
  selectOption: "click",
  setInputFiles: "click",
  dragTo: "click",
  fill: "type",
  clear: "type",
  press: "type",
  hover: "hover",
}

/** Playwright's `force` for an action whose options ask for it, so actionability checks are skipped. */
function forced(options: ActionOptions | undefined): { readonly force?: true } {
  return options?.force === true ? { force: true } : {}
}

/** The session's screenshot checks: their settings, a counter, and a note per comparison. */
export interface ScreenshotDesk {
  readonly settings: ScreenshotSettings
  /** A number for the next check, unique within the attempt. */
  next(): number
  /** Records what a check did on the step running now. */
  note(event: ScreenshotEvent): void
}

/** What a `getBy*` call searches within: the page, or another locator's elements. */
type Root = Page | PlaywrightLocator
/** Builds the Playwright locator on a page; called at every use. */
type Query = (page: Page) => PlaywrightLocator

/** The `getBy*` methods, shared by `screen` and by every locator (to search inside it). */
class Finder implements Screen {
  protected readonly context: LocateContext
  private readonly root: (page: Page) => Root
  private readonly prefix: string

  constructor(context: LocateContext, root: (page: Page) => Root, prefix: string) {
    this.context = context
    this.root = root
    this.prefix = prefix
  }

  private derive(
    text: string,
    make: (root: Root) => PlaywrightLocator,
    nearby?: (root: Root) => PlaywrightLocator,
  ): ElementLocator {
    const near = nearby && ((page: Page) => nearby(this.root(page)))

    return new ElementLocator(
      this.context,
      (page) => make(this.root(page)),
      this.prefix + text,
      near,
    )
  }

  getByRole(role: AriaRole, options: RoleOptions = {}): Locator {
    return this.derive(
      roleCall(role, options),
      (root) => root.getByRole(role, options),
      (root) => root.getByRole(role),
    )
  }

  getByLabel(text: TextMatch, options: TextOptions = {}): Locator {
    return this.derive(textCall("getByLabel", text, options), (r) => r.getByLabel(text, options))
  }

  getByPlaceholder(text: TextMatch, options: TextOptions = {}): Locator {
    return this.derive(textCall("getByPlaceholder", text, options), (root) =>
      root.getByPlaceholder(text, options),
    )
  }

  getByText(text: TextMatch, options: TextOptions = {}): Locator {
    return this.derive(textCall("getByText", text, options), (r) => r.getByText(text, options))
  }

  getByDisplayValue(value: TextMatch): Locator {
    return this.derive(`getByDisplayValue(${shown(value)})`, (root) =>
      root.locator(valueSelector(value)),
    )
  }

  getByTestId(id: TextMatch): Locator {
    return this.derive(`getByTestId(${shown(id)})`, (root) => root.getByTestId(id))
  }
}

/** A locator a test holds. */
export class ElementLocator extends Finder implements Locator {
  /** The locator as the test wrote it, e.g. `getByRole("button", name: "Save")`. */
  readonly text: string
  private readonly query: Query
  private readonly nearby: Query | undefined

  constructor(context: LocateContext, query: Query, text: string, nearby?: Query) {
    super(context, query, `${text}.`)
    this.text = text
    this.query = query
    this.nearby = nearby
  }

  /** The Playwright locator on the session's current page. */
  resolve(): PlaywrightLocator {
    return this.query(this.context.page())
  }

  /** The Playwright locator on the current page, as a step uses it: the step notes that page's tab. */
  resolveInStep(): PlaywrightLocator {
    const page = this.context.page()

    this.noteTab(page)

    return this.query(page)
  }

  /** Notes on the running step the tab of `page`, the one its element is looked for in. */
  private noteTab(page: Page): void {
    const tab = this.context.tabOf?.(page)

    if (tab !== undefined) this.context.steps.ranIn?.(tab)
  }

  /** What `expect` needs to poll this locator and record the check. */
  get session(): LocateContext {
    return this.context
  }

  /** The timeout an action or read runs under. */
  private timeout(options: ReadOptions | undefined): number {
    return options?.timeout ?? this.context.actionTimeout
  }

  /** Runs `perform` on the resolved target; a failure becomes a LocatorError naming this locator. */
  private async attempt<T>(
    api: string,
    timeout: number,
    perform: (target: PlaywrightLocator, timeout: number) => Promise<T>,
  ): Promise<T> {
    const page = this.context.page()
    const target = this.query(page)

    this.noteTab(page)

    try {
      return await perform(target, timeout)
    } catch (cause) {
      const nearby = this.nearby?.(page)

      throw await explain(
        { api, text: this.text, timeout, target, ...(nearby && { nearby }) },
        cause,
      )
    }
  }

  /** An action is a step of its own; its label is the call as the test wrote it. */
  private act(
    action: string,
    args: string,
    options: ActionOptions | undefined,
    perform: (target: PlaywrightLocator, timeout: number) => Promise<unknown>,
    verifies = false,
  ): Promise<void> {
    const api = `locator.${action}`

    const kind = POINTER_OF[action]

    const pointed =
      kind === undefined
        ? perform
        : async (target: PlaywrightLocator, timeout: number) => {
            await pointAt(target, kind)

            return perform(target, timeout)
          }

    const body = async () => {
      await this.attempt(api, this.timeout(options), pointed)
      /* A wait is itself a check of the page; anything else is followed by readiness. */
      if (!verifies) await this.context.ready?.()
    }

    return this.context.steps.run("locator", api, `${this.text}.${action}(${args})`, body, {
      verifies,
    })
  }

  click(options?: ActionOptions): Promise<void> {
    return this.act("click", "", options, (target, timeout) =>
      target.click({ timeout, ...forced(options) }),
    )
  }

  tap(options?: ActionOptions): Promise<void> {
    return this.click(options)
  }

  fill(value: string | Secret, options?: ActionOptions): Promise<void> {
    const secret = isSecret(value) ? value : undefined
    const shownValue = secret ? `secret ${JSON.stringify(secret.name)}` : JSON.stringify(value)

    return this.act("fill", shownValue, options, async (target, timeout) => {
      if (secret !== undefined) {
        await checkSecretField(target, secret, timeout)
        await markSecretField(target, timeout)
      }

      const typed = isSecret(value) ? await this.context.secrets.resolve(value) : value

      await target.fill(typed, { timeout, ...forced(options) })
    })
  }

  clear(options?: ActionOptions): Promise<void> {
    return this.act("clear", "", options, (target, timeout) =>
      target.clear({ timeout, ...forced(options) }),
    )
  }

  press(key: string, options?: ActionOptions): Promise<void> {
    return this.act("press", JSON.stringify(key), options, (target, timeout) =>
      target.press(key, { timeout }),
    )
  }

  check(options?: ActionOptions): Promise<void> {
    return this.act("check", "", options, (target, timeout) =>
      setChecked(target, true, { timeout, ...forced(options) }),
    )
  }

  uncheck(options?: ActionOptions): Promise<void> {
    return this.act("uncheck", "", options, (target, timeout) =>
      setChecked(target, false, { timeout, ...forced(options) }),
    )
  }

  selectOption(option: string | readonly string[], options?: ActionOptions): Promise<void> {
    const wanted = typeof option === "string" ? option : [...option]

    return this.act("selectOption", JSON.stringify(option), options, (target, timeout) =>
      target.selectOption(wanted, { timeout, ...forced(options) }),
    )
  }

  setInputFiles(files: string | readonly string[], options?: ActionOptions): Promise<void> {
    const names = typeof files === "string" ? [files] : [...files]

    return this.act("setInputFiles", JSON.stringify(files), options, (target, timeout) =>
      target.setInputFiles(filePaths(this.context.files, names), { timeout }),
    )
  }

  dragTo(target: Locator, options?: ActionOptions): Promise<void> {
    if (!(target instanceof ElementLocator))
      throw new TypeError("dragTo takes a locator from the same screen")

    return this.act("dragTo", target.text, options, (source, timeout) =>
      source.dragTo(target.resolve(), { timeout, ...forced(options) }),
    )
  }

  hover(options?: ActionOptions): Promise<void> {
    return this.act("hover", "", options, (target, timeout) =>
      target.hover({ timeout, ...forced(options) }),
    )
  }

  waitFor(options: WaitOptions = {}): Promise<void> {
    const state = options.state ?? "visible"

    return this.act(
      "waitFor",
      state === "visible" ? "" : JSON.stringify(state),
      options,
      (target, timeout) => target.waitFor({ state, timeout }),
      true,
    )
  }

  textContent(options?: ReadOptions): Promise<string | null> {
    return this.attempt("locator.textContent", this.timeout(options), (target, timeout) =>
      target.textContent({ timeout }),
    )
  }

  innerText(options?: ReadOptions): Promise<string> {
    return this.attempt("locator.innerText", this.timeout(options), (target, timeout) =>
      target.innerText({ timeout }),
    )
  }

  inputValue(options?: ReadOptions): Promise<string> {
    return this.attempt("locator.inputValue", this.timeout(options), async (target, timeout) => {
      if ((await target.getAttribute("type", { timeout })) === "password")
        throw new LocatorError(
          "LOCATOR_FAILED",
          `locator.inputValue: ${this.text} is a password field; danwo does not read it back`,
        )

      return target.inputValue({ timeout })
    })
  }

  getAttribute(name: string, options?: ReadOptions): Promise<string | null> {
    return this.attempt("locator.getAttribute", this.timeout(options), (target, timeout) =>
      target.getAttribute(name, { timeout }),
    )
  }

  isVisible(): Promise<boolean> {
    return this.attempt("locator.isVisible", 0, (target) => target.isVisible())
  }

  isHidden(): Promise<boolean> {
    return this.attempt("locator.isHidden", 0, (target) => target.isHidden())
  }

  isEnabled(options?: ReadOptions): Promise<boolean> {
    return this.attempt("locator.isEnabled", this.timeout(options), (target, timeout) =>
      target.isEnabled({ timeout }),
    )
  }

  isDisabled(options?: ReadOptions): Promise<boolean> {
    return this.attempt("locator.isDisabled", this.timeout(options), (target, timeout) =>
      target.isDisabled({ timeout }),
    )
  }

  isChecked(options?: ReadOptions): Promise<boolean> {
    return this.attempt("locator.isChecked", this.timeout(options), (target, timeout) =>
      target.isChecked({ timeout }),
    )
  }

  count(): Promise<number> {
    return this.resolve().count()
  }

  async all(): Promise<Locator[]> {
    const count = await this.count()

    return Array.from({ length: count }, (_, index) => this.nth(index))
  }

  allTextContents(): Promise<string[]> {
    return this.resolve().allTextContents()
  }

  /** A locator for a subset of this one's elements. */
  private narrow(text: string, make: (target: PlaywrightLocator, page: Page) => PlaywrightLocator) {
    return new ElementLocator(
      this.context,
      (page) => make(this.query(page), page),
      `${this.text}.${text}`,
    )
  }

  first(): Locator {
    return this.narrow("first()", (target) => target.first())
  }

  last(): Locator {
    return this.narrow("last()", (target) => target.last())
  }

  nth(index: number): Locator {
    return this.narrow(`nth(${index})`, (target) => target.nth(index))
  }

  filter(options: { readonly hasText?: TextMatch; readonly has?: Locator }): Locator {
    const inner = options.has instanceof ElementLocator ? options.has : undefined

    if (options.has !== undefined && inner === undefined)
      throw new TypeError("filter({ has }) takes a locator from the same screen")

    const shownFilter = filterCall({
      ...(options.hasText !== undefined && { hasText: options.hasText }),
      ...(inner && { has: inner }),
    })

    return this.narrow(shownFilter, (target, page) =>
      target.filter({
        ...(options.hasText !== undefined && { hasText: options.hasText }),
        ...(inner && { has: inner.query(page) }),
      }),
    )
  }
}

/** The session's `screen`: locators resolved against the whole page, and the page itself. */
export class PageScreen extends Finder {
  constructor(context: LocateContext) {
    super(context, (page) => page, "")
  }

  /** What `expect(screen)` needs: the session's page and settings. */
  get session(): LocateContext {
    return this.context
  }
}

export function createScreen(context: LocateContext): Screen {
  return new PageScreen(context)
}
