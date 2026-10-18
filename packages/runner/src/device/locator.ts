/**
 * `screen` on a device: the same locators a web test writes (`getByTestId`, `getByRole`,
 * `getByText`…), resolved on the device's accessibility tree instead of a page. Each action waits
 * for exactly one match, acts on it through the device driver by ref, and records a step.
 */
import { filterCall, roleCall, shown, textCall } from "../locate/describe.ts"
import { LocatorError } from "../locate/failure.ts"
import type {
  ActionOptions,
  AriaRole,
  Locator,
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
import { type Chain, type ChainLink, type DeviceQuery, resolveChain, textOf } from "./match.ts"
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
  /** A check's timeout from its earlier passing runs; the given one without a pace. */
  readonly checkTimeout?: (api: string, label: string, fallback: number) => number
}

/** How often a locator reads the screen again while waiting. */
const POLL_MS = 150
/** At most this many candidates are listed when a locator matches nothing. */
const MAX_CANDIDATES = 5

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

  constructor(context: DeviceContext, reader: DeviceReader, chain: Chain, text: string) {
    this.context = context
    this.reader = reader
    this.chain = chain
    this.text = text
  }

  private extend(link: ChainLink, call: string): DeviceLocator {
    const text = this.chain.length === 0 ? call : `${this.text}.${call}`

    return new DeviceLocator(this.context, this.reader, [...this.chain, link], text)
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

  last(): DeviceLocator {
    return this.extend({ pick: "last" }, "last()")
  }

  nth(index: number): DeviceLocator {
    return this.extend({ pick: index }, `nth(${index})`)
  }

  filter(options: { readonly hasText?: TextMatch; readonly has?: Locator }): DeviceLocator {
    const has = options.has instanceof DeviceLocator ? options.has : undefined

    if (options.has !== undefined && has === undefined) {
      throw new TypeError("filter({ has }) takes a locator from the same device screen")
    }

    const hasText = options.hasText !== undefined ? { hasText: options.hasText } : {}

    return this.extend(
      { ...hasText, ...(has && { has: has.chain }) },
      filterCall({ ...hasText, ...(has && { has }) }),
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
        `${api}: ${this.text} matched nothing within ${timeout} ms`,
        nearby(reading, this.chain),
      )
    }

    return new LocatorError(
      "LOCATOR_AMBIGUOUS",
      `${api}: ${this.text} matched ${nodes.length} elements; it needs exactly one (use first(), nth() or filter())`,
      nodes.slice(0, MAX_CANDIDATES).map((node) => textOf(reading.nodes, node)),
    )
  }

  private timeout(options: ActionOptions | undefined): number {
    return options?.timeout ?? this.context.actionTimeout
  }

  /** An action on the single match, recorded as a step and followed by readiness. */
  private act(
    action: string,
    args: string,
    options: ActionOptions | undefined,
    perform: (node: DeviceNode) => Promise<void>,
  ): Promise<void> {
    const api = `locator.${action}`

    return this.context.steps.run("locator", api, `${this.text}.${action}(${args})`, async () => {
      await perform(await this.one(api, this.timeout(options)))
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

  press(): Promise<void> {
    return unsupported("press")
  }

  setInputFiles(): Promise<void> {
    return unsupported("setInputFiles")
  }

  dragTo(): Promise<void> {
    return unsupported("dragTo")
  }

  selectOption(): Promise<void> {
    return unsupported("selectOption")
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

  getAttribute(): Promise<string | null> {
    return unsupported("getAttribute")
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
function unsupported(method: string): Promise<never> {
  return Promise.reject(
    new DanwoError("CONFIG_INVALID", `locator.${method} is not supported on Android yet`),
  )
}

/** The device's `screen`. */
export function deviceScreen(context: DeviceContext, reader: DeviceReader): Screen {
  return new DeviceLocator(context, reader, [], "screen")
}
