/**
 * Turns what the page reports into test lines: the element's locator (found while it is still on
 * the page), the action on it, and the value typed, written as a secret's name for passwords and
 * as a mail reference for codes and links the app emailed.
 */
import { latestMail, type MailSource, pickFrom } from "@danwo/runner/runner"
import type { Page } from "playwright-core"

import { chooseQuery, type ElementFacts, factsOf, isVolatile, stablePath } from "./describe.ts"
import type { PageEvent } from "./events.ts"
import { locatorCode, type ScreenQuery } from "./locators.ts"
import type { ActionStep, AssertStep, Mark, Step } from "./steps.ts"

type ElementEvent = Exclude<PageEvent, { kind: "stop" | "note" }>

/** A password field the recording wrote as a secret, by the name the test fills it with. */
export interface SecretUse {
  readonly name: string
  readonly purpose: "password"
}

interface Located {
  readonly facts: ElementFacts
  readonly query: ScreenQuery | undefined
}

/** A secret's name from its field's label: `Confirm password` → `confirmPassword`. */
export function secretName(label: string): string {
  const words = label.toLowerCase().match(/[a-z0-9]+/g) ?? ["secret"]

  return words
    .map((word, at) => (at === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("")
}

function describedAs(facts: ElementFacts): string {
  const what = facts.name ?? facts.label ?? facts.text

  return `${facts.role ?? facts.tag}${what === "" ? "" : ` ${JSON.stringify(what)}`}`
}

/** What an action does to an element, as the end of a locator line. */
function actionCall(event: ElementEvent, value: string): string {
  switch (event.kind) {
    case "fill":
      return `.fill(${value})`
    case "select":
      return `.selectOption(${JSON.stringify(event.label)})`
    case "check":
      return event.checked ? ".check()" : ".uncheck()"
    case "press":
      return `.press(${JSON.stringify(event.key)})`
    default:
      return ".click()"
  }
}

/** The instruction the agent gets for an element no locator finds on its own. */
function agentLine(event: ElementEvent, facts: ElementFacts): string {
  const verb =
    event.kind === "fill"
      ? "type into"
      : event.kind === "press"
        ? `press ${event.key} in`
        : event.kind

  return `await agent.act(${JSON.stringify(`${verb} the ${describedAs(facts)}`)})`
}

export class StepWriter {
  readonly baseUrl: string
  private readonly mail: readonly MailSource[]
  private readonly recorded: Step[] = []
  private readonly located = new Map<string, Located>()
  private readonly typed: string[] = []
  /** Where each field's value sits in `typed`. */
  private readonly typedAt = new Map<string, number>()
  private readonly secretUses = new Map<string, SecretUse>()

  constructor(options: { readonly baseUrl: string; readonly mail: readonly MailSource[] }) {
    this.baseUrl = options.baseUrl
    this.mail = options.mail
  }

  steps(): readonly Step[] {
    return this.recorded
  }

  secrets(): readonly SecretUse[] {
    return [...this.secretUses.values()]
  }

  push(step: Step): void {
    const last = this.recorded.at(-1)
    const sameField =
      step.kind === "action" &&
      step.typing === true &&
      last?.kind === "action" &&
      last.typing === true &&
      last.tag === step.tag

    if (sameField) this.recorded[this.recorded.length - 1] = { ...step, mark: last.mark }
    else this.recorded.push(step)
  }

  /** The element named `tag`, described the first time it is used. */
  private async locate(page: Page, tag: string): Promise<Located> {
    const known = this.located.get(tag)

    if (known !== undefined) return known

    const facts = await factsOf(page, tag)
    const found = { facts, query: await chooseQuery(page, tag, facts, this.typed) }

    this.located.set(tag, found)

    return found
  }

  /** A value as the test writes it: a secret's name, a mail reference, or the text itself. */
  private valueCode(event: Extract<PageEvent, { kind: "fill" }>, facts: ElementFacts): string {
    if (event.secret) {
      const name = this.secretUses.get(event.tag)?.name ?? this.newSecret(facts)

      this.secretUses.set(event.tag, { name, purpose: "password" })

      return `secret(${JSON.stringify(name)})`
    }

    const value = event.value ?? ""
    const from = this.mailedTo(value, "code")

    return from === undefined ? JSON.stringify(value) : `await mail.code(${JSON.stringify(from)})`
  }

  private newSecret(facts: ElementFacts): string {
    const base = secretName(facts.label ?? facts.name ?? "password")
    const taken = new Set([...this.secretUses.values()].map((use) => use.name))
    let name = base

    for (let n = 2; taken.has(name); n++) name = `${base}${String(n)}`

    return name
  }

  /** The address whose newest mail holds `value` as its code or link, if any typed address does. */
  private mailedTo(value: string, kind: "code" | "link"): string | undefined {
    if (value.length < 4) return undefined

    return this.typed
      .filter((address) => address.includes("@"))
      .find((address) => {
        const message = latestMail(this.mail, address)

        return message !== undefined && pickFrom(message, { kind }) === value
      })
  }

  /** The step an element event records, or undefined when it adds nothing. */
  async stepFor(page: Page, event: ElementEvent, mark: Mark): Promise<Step | undefined> {
    const { facts, query } = await this.locate(page, event.tag)

    if (event.kind === "assert") return this.assertStep(page, query, facts)

    const value = event.kind === "fill" ? this.valueCode(event, facts) : ""

    if (event.kind === "fill" && !event.secret && event.value !== undefined)
      this.remember(event.tag, event.value)

    return {
      kind: "action",
      line:
        query === undefined
          ? agentLine(event, facts)
          : `await ${locatorCode(query)}${actionCall(event, value)}`,
      mark,
      tag: event.tag,
      typing: event.kind === "fill",
    }
  }

  /** Keeps the newest value typed into each field, for mail lookups and locator checks. */
  private remember(tag: string, value: string): void {
    const at = this.typedAt.get(tag)

    if (at === undefined) {
      this.typedAt.set(tag, this.typed.length)
      this.typed.push(value)
    } else {
      this.typed[at] = value
    }
  }

  private assertStep(page: Page, query: ScreenQuery | undefined, facts: ElementFacts): AssertStep {
    const url = new URL(page.url())
    const own = url.origin === new URL(this.baseUrl).origin
    const observed = {
      query,
      text: facts.text,
      path: own ? stablePath(url, this.typed) : undefined,
    }

    if (query === undefined) {
      return {
        kind: "assert",
        observed,
        line: `await agent.assert(${JSON.stringify(`the ${describedAs(facts)} is shown`)})`,
      }
    }

    const code = locatorCode(query)
    const shown = query.by === "role" || (query.by === "text" && typeof query.value === "string")

    return {
      kind: "assert",
      observed,
      line:
        shown || facts.text === ""
          ? `await expect(${code}).toBeVisible()`
          : `await expect(${code}).toHaveText(${JSON.stringify(facts.text)})`,
    }
  }

  /** The step for a page the person went to themselves; undefined for one danwo cannot open. */
  openStep(address: string, mark: Mark): ActionStep | undefined {
    const url = new URL(address)
    const from = this.mailedTo(address, "link")

    if (from !== undefined)
      return {
        kind: "action",
        line: `await app.open(await mail.link(${JSON.stringify(from)}))`,
        mark,
      }
    if (url.origin !== new URL(this.baseUrl).origin || isVolatile(url.pathname, this.typed))
      return undefined

    return {
      kind: "action",
      line: `await app.open(${JSON.stringify(stablePath(url, this.typed))})`,
      mark,
    }
  }
}
