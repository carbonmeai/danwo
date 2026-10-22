/**
 * `screen` on a device: the same locators a web test writes (`getByTestId`, `getByRole`,
 * `getByText`…), resolved on the device's accessibility tree instead of a page. Each action waits
 * for exactly one match, enabled and in place on the latest screen, acts on it through the device
 * driver by that screen's ref, and records a step.
 */
import type { ScreenshotEvent, ScreenshotSettings } from "../assert/screenshot.ts"
import { filterCall, longPressArgs, roleCall, shown, textCall } from "../locate/describe.ts"
import { LocatorError } from "../locate/failure.ts"
import type {
  ActionOptions,
  AriaRole,
  FilterOptions,
  Locator,
  LongPressOptions,
  RoleOptions,
  Screen,
  SecretResolver,
  TextMatch,
  TextOptions,
  WaitOptions,
} from "../locate/types.ts"
import type { StepRecorder } from "../record/index.ts"
import { isSecret, type Secret } from "../secrets/index.ts"
import { DanwoError } from "../support/codes.ts"
import { attributeOf } from "./attributes.ts"
import { currentNode, currentProblem } from "./current.ts"
import {
  type Chain,
  type ChainLink,
  chainCounts,
  collapse,
  type DeviceQuery,
  resolveChain,
  textOf,
} from "./match.ts"
import type { DeviceNode, DeviceScreenReading, DeviceTarget } from "./types.ts"

/** What a device's locators work with. */
export interface DeviceContext {
  readonly target: DeviceTarget
  readonly steps: StepRecorder
  readonly secrets: SecretResolver
  readonly actionTimeout: number
  readonly assertionTimeout: number
  /** Waits for the app and the services behind it to settle after an action. */
  readonly ready: () => Promise<void>
  /** Baselines of `toHaveScreenshot`, and where a difference's images go. */
  readonly shots?: {
    readonly settings: ScreenshotSettings
    next(): number
    note(event: ScreenshotEvent): void
  }
  /** A check's timeout from its earlier passing runs; the given one without a pace. */
  readonly checkTimeout?: (api: string, label: string, fallback: number) => number
}

/** How often a locator reads the screen again while waiting. */
const POLL_MS = 150
/** At most this many candidates are listed when a locator matches nothing. */
const MAX_CANDIDATES = 5
/** The least time a match gets to settle in place, however little of the timeout is left. */
const SETTLE_MIN_MS = 1_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads the screen and keeps the reading for failure evidence. */
export class DeviceReader {
  latest: DeviceScreenReading | undefined
  private readonly target: DeviceTarget

  constructor(target: DeviceTarget) {
    this.target = target
  }

  async read(): Promise<DeviceScreenReading> {
    this.latest = await this.target.read()

    return this.latest
  }
}

/** Elements worth naming when `chain` matched nothing: those with the asked role, else any text. */
function nearby(reading: DeviceScreenReading, chain: Chain): string[] {
  const asked = chain.find((link): link is { readonly query: DeviceQuery } => "query" in link)
  const role = asked?.query.by === "role" ? asked.query.role : undefined
  const pool = reading.nodes.filter((node) =>
    role === undefined ? node.text !== "" : node.role === role,
  )

  return pool.slice(0, MAX_CANDIDATES).map((node) => `${node.role} "${node.name || node.text}"`)
}

/** Elements on the device, found again on every use. */
export class DeviceLocator implements Locator {
  readonly context: DeviceContext
  readonly reader: DeviceReader
  readonly chain: Chain
  /** The locator as the test wrote it, e.g. `getByTestId("buy")`. */
  readonly text: string
  /** Each link's call as the test wrote it, for a failure's count by step. */
  private readonly calls: readonly string[]

  constructor(
    context: DeviceContext,
    reader: DeviceReader,
    chain: Chain,
    text: string,
    calls: readonly string[] = [],
  ) {
    this.context = context
    this.reader = reader
    this.chain = chain
    this.text = text
    this.calls = calls
  }

  private extend(link: ChainLink, call: string): DeviceLocator {
    const text = this.chain.length === 0 ? call : `${this.text}.${call}`
    const calls = [...this.calls, this.chain.length === 0 ? call : `.${call}`]

    return new DeviceLocator(this.context, this.reader, [...this.chain, link], text, calls)
  }

  /** How many elements each call left in `reading`, as `; by step: …`; empty for a single call. */
  private stepCounts(reading: DeviceScreenReading): string {
    if (this.chain.length < 2) return ""

    const counts = chainCounts(reading.nodes, this.chain)

    return `; by step: ${this.calls.map((call, at) => `${call} ${counts[at] ?? "?"}`).join(", ")}`
  }

  getByRole(role: AriaRole, options: RoleOptions = {}): DeviceLocator {
    return this.extend({ query: { by: "role", role, options } }, roleCall(role, options))
  }

  getByText(match: TextMatch, options: TextOptions = {}): DeviceLocator {
    const exact = options.exact === true

    return this.extend(
      { query: { by: "text", match, exact } },
      textCall("getByText", match, options),
    )
  }

  getByLabel(match: TextMatch, options: TextOptions = {}): DeviceLocator {
    const exact = options.exact === true

    return this.extend(
      { query: { by: "label", match, exact } },
      textCall("getByLabel", match, options),
    )
  }

  getByPlaceholder(match: TextMatch, options: TextOptions = {}): DeviceLocator {
    const exact = options.exact === true

    return this.extend(
      { query: { by: "placeholder", match, exact } },
      textCall("getByPlaceholder", match, options),
    )
  }

  getByDisplayValue(match: TextMatch): DeviceLocator {
    return this.extend(
      { query: { by: "value", match, exact: true } },
      `getByDisplayValue(${shown(match)})`,
    )
  }

  getByTestId(match: TextMatch): DeviceLocator {
    return this.extend({ query: { by: "testId", match } }, `getByTestId(${shown(match)})`)
  }

  first(): DeviceLocator {
    return this.extend({ pick: "first" }, "first()")
  }

  or(other: Locator): DeviceLocator {
    const either = sameDevice(other, "or")

    return this.extend({ join: "or", other: either.chain }, `or(${either.text})`)
  }

  and(other: Locator): DeviceLocator {
    const both = sameDevice(other, "and")

    return this.extend({ join: "and", other: both.chain }, `and(${both.text})`)
  }

  last(): DeviceLocator {
    return this.extend({ pick: "last" }, "last()")
  }

  nth(index: number): DeviceLocator {
    return this.extend({ pick: index }, `nth(${index})`)
  }

  filter(options: FilterOptions): DeviceLocator {
    const has = sameDevice(options.has, "has")
    const hasNot = sameDevice(options.hasNot, "hasNot")
    const texts = {
      ...(options.hasText !== undefined && { hasText: options.hasText }),
      ...(options.hasNotText !== undefined && { hasNotText: options.hasNotText }),
    }

    return this.extend(
      { ...texts, ...(has && { has: has.chain }), ...(hasNot && { hasNot: hasNot.chain }) },
      filterCall({ ...texts, ...(has && { has }), ...(hasNot && { hasNot }) }),
    )
  }

  /** What the locator matches in one reading of the screen, without waiting. */
  async matches(): Promise<{
    readonly reading: DeviceScreenReading
    readonly nodes: DeviceNode[]
  }> {
    const reading = await this.reader.read()

    return { reading, nodes: resolveChain(reading.nodes, this.chain) }
  }

  /** The single element it matches, waiting up to `timeout`; a clear error when there is none. */
  async one(api: string, timeout: number): Promise<DeviceNode> {
    const deadline = Date.now() + timeout

    for (;;) {
      const { reading, nodes } = await this.matches()
      const [only] = nodes

      if (nodes.length === 1 && only !== undefined) return only
      if (Date.now() >= deadline) throw this.failure(api, timeout, reading, nodes)

      await sleep(POLL_MS)
    }
  }

  private failure(
    api: string,
    timeout: number,
    reading: DeviceScreenReading,
    nodes: readonly DeviceNode[],
  ): LocatorError {
    if (nodes.length === 0) {
      return new LocatorError(
        "LOCATOR_NOT_FOUND",
        `${api}: ${this.text} matched nothing within ${timeout} ms${this.stepCounts(reading)}`,
        nearby(reading, this.chain),
      )
    }

    return new LocatorError(
      "LOCATOR_AMBIGUOUS",
      `${api}: ${this.text} matched ${nodes.length} elements; it needs exactly one (use first(), nth() or filter())${this.stepCounts(reading)}`,
      nodes.slice(0, MAX_CANDIDATES).map((node) => textOf(reading.nodes, node)),
    )
  }

  private timeout(options: ActionOptions | undefined): number {
    return options?.timeout ?? this.context.actionTimeout
  }

  /**
   * The single match as the latest reading has it, ready to press: in place and enabled (see
   * current.ts). One that went from the screen is looked for again, once.
   */
  private async actionable(api: string, timeout: number): Promise<DeviceNode> {
    const deadline = Date.now() + timeout
    const left = () => Math.max(deadline - Date.now(), SETTLE_MIN_MS)

    for (let tries = 0; ; tries++) {
      const match = await this.one(api, tries === 0 ? timeout : left())
      const found = await currentNode(this.context.target, match, {
        timeout: left(),
        enabled: true,
      })

      if ("node" in found) return found.node
      if (found.problem !== "gone" || tries > 0)
        throw new LocatorError(
          "LOCATOR_NOT_READY",
          `${api}: ${this.text} ${currentProblem(found.problem)}`,
        )
    }
  }

  /**
   * An action on the single match, recorded as a step and followed by readiness. The match is
   * found again on the latest screen first, and waited for until it is enabled.
   */
  private act(
    action: string,
    args: string,
    options: ActionOptions | undefined,
    perform: (node: DeviceNode) => Promise<void>,
  ): Promise<void> {
    const api = `locator.${action}`

    return this.context.steps.run("locator", api, `${this.text}.${action}(${args})`, async () => {
      await perform(await this.actionable(api, this.timeout(options)))
      await this.context.ready()
    })
  }

  click(options?: ActionOptions): Promise<void> {
    return this.act("click", "", options, (node) => this.context.target.tap(node.ref))
  }

  /** `click` by its mobile name. */
  tap(options?: ActionOptions): Promise<void> {
    return this.click(options)
  }

  /**
   * Presses the element and holds it for `durationMs` (the device's 800 ms by default), once it is
   * enabled and in place, by the latest reading's ref.
   */
  longPress(options?: LongPressOptions): Promise<void> {
    const press = this.context.target.longPress?.bind(this.context.target)
    const hold = options?.durationMs

    if (press === undefined) return unsupported("longPress")
    if (hold !== undefined && (!Number.isFinite(hold) || hold < 0))
      return Promise.reject(
        new TypeError(`longPress takes a durationMs of 0 or more, not ${String(hold)}`),
      )

    return this.act("longPress", longPressArgs(options), options, (node) =>
      press(node.ref, hold === undefined ? {} : { durationMs: hold }),
    )
  }

  fill(value: string | Secret, options?: ActionOptions): Promise<void> {
    const shownValue = isSecret(value)
      ? `secret ${JSON.stringify(value.name)}`
      : JSON.stringify(value)

    return this.act("fill", shownValue, options, async (node) => {
      if (!node.editable) {
        throw new LocatorError("LOCATOR_FAILED", `locator.fill: ${this.text} is not a text field`)
      }

      const typed = isSecret(value) ? await this.context.secrets.resolve(value) : value

      await this.context.target.fill(node.ref, typed)
    })
  }

  clear(options?: ActionOptions): Promise<void> {
    return this.fill("", options)
  }

  check(options?: ActionOptions): Promise<void> {
    return this.act("check", "", options, async (node) => {
      if (node.checked !== true) await this.context.target.tap(node.ref)
    })
  }

  uncheck(options?: ActionOptions): Promise<void> {
    return this.act("uncheck", "", options, async (node) => {
      if (node.checked === true) await this.context.target.tap(node.ref)
    })
  }

  hover(): Promise<void> {
    return unsupported("hover")
  }

  /** Taps the element so it has focus, then presses `key` (`Enter`, `Tab`, `Backspace`…). */
  press(key: string, options?: ActionOptions): Promise<void> {
    return this.act("press", JSON.stringify(key), options, async (node) => {
      const { target } = this.context

      if (target.pressKey === undefined) {
        await unsupported("press")

        return
      }

      await target.tap(node.ref)
      await target.pressKey(key)
    })
  }

  setInputFiles(): Promise<void> {
    return unsupported("setInputFiles")
  }

  dragTo(): Promise<void> {
    return unsupported("dragTo")
  }

  /** Opens the picker and taps the option with this text; one option, as a spinner holds one. */
  selectOption(option: string | readonly string[], options?: ActionOptions): Promise<void> {
    const [wanted, ...more] = typeof option === "string" ? [option] : option

    if (wanted === undefined || more.length > 0)
      return Promise.reject(
        new LocatorError("LOCATOR_FAILED", "locator.selectOption takes one option on a device"),
      )

    return this.act("selectOption", JSON.stringify(wanted), options, async (node) => {
      const { target } = this.context

      await target.tap(node.ref)

      const deadline = Date.now() + this.timeout(options)

      for (;;) {
        const choice = (await target.read()).nodes.find(
          (each) => each.ref !== node.ref && collapse(each.text || each.name) === collapse(wanted),
        )

        if (choice !== undefined) return target.tap(choice.ref)
        if (Date.now() >= deadline)
          throw new LocatorError(
            "LOCATOR_NOT_FOUND",
            `locator.selectOption: the picker of ${this.text} shows no option ${JSON.stringify(wanted)}`,
          )

        await sleep(POLL_MS)
      }
    })
  }

  async waitFor(options: WaitOptions = {}): Promise<void> {
    const state = options.state ?? "visible"
    const wanted = state === "visible" || state === "attached"
    const timeout = this.timeout(options)
    const label = `${this.text}.waitFor(${JSON.stringify(state)})`

    await this.context.steps.run(
      "locator",
      "locator.waitFor",
      label,
      async () => {
        const deadline = Date.now() + timeout

        while ((await this.matches()).nodes.length > 0 !== wanted) {
          if (Date.now() >= deadline) {
            throw new LocatorError(
              "LOCATOR_NOT_READY",
              `locator.waitFor: ${this.text} did not become ${state} within ${timeout} ms`,
            )
          }

          await sleep(POLL_MS)
        }
      },
      { verifies: true },
    )
  }

  async textContent(options?: ActionOptions): Promise<string | null> {
    return this.innerText(options)
  }

  async innerText(options?: ActionOptions): Promise<string> {
    const node = await this.one("locator.innerText", this.timeout(options))

    return textOf(this.reader.latest?.nodes ?? [], node)
  }

  async inputValue(options?: ActionOptions): Promise<string> {
    const node = await this.one("locator.inputValue", this.timeout(options))

    if (node.password) {
      throw new LocatorError(
        "LOCATOR_FAILED",
        `locator.inputValue: ${this.text} is a password field`,
      )
    }

    return node.value ?? ""
  }

  /** An attribute by its web name (`aria-label`, `data-testid`, `aria-checked`…); see attributes.ts. */
  async getAttribute(name: string, options?: ActionOptions): Promise<string | null> {
    return attributeOf(await this.one("locator.getAttribute", this.timeout(options)), name)
  }

  async isVisible(): Promise<boolean> {
    return (await this.matches()).nodes.length > 0
  }

  async isHidden(): Promise<boolean> {
    return !(await this.isVisible())
  }

  async isEnabled(options?: ActionOptions): Promise<boolean> {
    return (await this.one("locator.isEnabled", this.timeout(options))).enabled
  }

  async isDisabled(options?: ActionOptions): Promise<boolean> {
    return !(await this.isEnabled(options))
  }

  async isChecked(options?: ActionOptions): Promise<boolean> {
    return (await this.one("locator.isChecked", this.timeout(options))).checked === true
  }

  async count(): Promise<number> {
    return (await this.matches()).nodes.length
  }

  async all(): Promise<Locator[]> {
    const count = await this.count()

    return Array.from({ length: count }, (_, index) => this.nth(index))
  }

  async allTextContents(): Promise<string[]> {
    const { reading, nodes } = await this.matches()

    return nodes.map((node) => textOf(reading.nodes, node))
  }
}

/** Locator methods a device does not support yet. */
/** The locator `option` names (a filter's `has`, an `or`), which must come from the same device screen. */
function sameDevice(locator: Locator, option: string): DeviceLocator

function sameDevice(locator: Locator | undefined, option: string): DeviceLocator | undefined

function sameDevice(locator: Locator | undefined, option: string): DeviceLocator | undefined {
  if (locator === undefined || locator instanceof DeviceLocator) return locator

  const call = option === "or" || option === "and" ? `${option}()` : `filter({ ${option} })`

  throw new TypeError(`${call} takes a locator from the same device screen`)
}

function unsupported(method: string): Promise<never> {
  return Promise.reject(
    new DanwoError("CONFIG_INVALID", `locator.${method} is not supported on devices yet`),
  )
}

/** The device's `screen`. */
export function deviceScreen(context: DeviceContext, reader: DeviceReader): Screen {
  return new DeviceLocator(context, reader, [], "screen")
}
