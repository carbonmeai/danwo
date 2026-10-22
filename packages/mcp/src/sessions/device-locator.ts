/**
 * Locators on a device screen, written as a test writes them: the same `getBy…` queries and chain
 * (`.filter({ hasText })`, `.first()`, `.last()`, `.nth(n)`) a page takes, read by the same parser,
 * then matched against one reading of the screen the way a device test's `screen` matches them.
 * `check_locator` on a device answers here: one match gives the line to paste, none or several say
 * why, with the screen's nearest elements.
 */
import { locatorCode, type ScreenQuery } from "@danwo/recorder"
import { likeness } from "@danwo/runner"
import {
  type DeviceChain,
  type DeviceChainLink,
  type DeviceNode,
  resolveChain,
} from "@danwo/runner/runner"

import { type ChainStep, chainCode, type LocatorChain, parseChain } from "./locator-chain.ts"

const MAX_SHOWN = 5

/** A locator read for a device: the chain to match, and how a test writes it. */
export interface DeviceLocator {
  readonly chain: DeviceChain
  readonly code: string
  /** The chain as parsed, for naming a part of it. */
  readonly parsed: LocatorChain
}

/** The query as a device's screen asks it; the ones a device screen has no such thing for refuse. */
function deviceQuery(query: ScreenQuery): DeviceChainLink {
  switch (query.by) {
    case "role":
      return {
        query: {
          by: "role",
          role: String(query.value),
          options: {
            ...(query.name !== undefined && { name: query.name }),
            ...(query.exact !== undefined && { exact: query.exact }),
          },
        },
      }
    case "testId":
      return { query: { by: "testId", match: query.value } }
    case "text":
    case "label":
    case "placeholder":
      return { query: { by: query.by, match: query.value, exact: query.exact === true } }
    default:
      throw new Error(
        `${locatorCode(query)} has no meaning on a device screen: use getByRole, getByText, getByLabel, getByPlaceholder or getByTestId`,
      )
  }
}

function deviceLink(step: ChainStep): DeviceChainLink {
  switch (step.kind) {
    case "query":
      return deviceQuery(step.query)
    case "first":
    case "last":
      return { pick: step.kind }
    case "nth":
      return { pick: step.index }
    default:
      return { hasText: step.hasText }
  }
}

/** Reads `expression` as a device locator. */
export function parseDeviceLocator(expression: string): DeviceLocator {
  const parsed: LocatorChain = parseChain(expression)

  return {
    chain: parsed.steps.map(deviceLink),
    code: chainCode(parsed),
    parsed,
  }
}

/** The elements `locator` matches in `nodes`, in screen order. */
export function matchDevice(nodes: readonly DeviceNode[], locator: DeviceLocator): DeviceNode[] {
  return resolveChain(nodes, locator.chain)
}

/** The first link after which nothing matches, as code, when that is before the chain's end. */
function emptyLink(nodes: readonly DeviceNode[], locator: DeviceLocator): string | undefined {
  const { steps, last } = locator.parsed

  for (let upTo = 1; upTo < locator.chain.length; upTo++) {
    if (resolveChain(nodes, locator.chain.slice(0, upTo)).length === 0)
      return chainCode({ steps: steps.slice(0, upTo), last })
  }

  return undefined
}

/** What the query's text is: the name for a role, the value otherwise. */
function wanted(query: ScreenQuery): string {
  const text = query.by === "role" ? query.name : query.value

  return text === undefined ? "" : String(text)
}

/** How a test would find `node`: by its test id when it has one, else by role and name. */
function nodeLocator(node: DeviceNode): string {
  if (node.testId !== undefined) return locatorCode({ by: "testId", value: node.testId })

  const name = node.name || node.text

  return name === ""
    ? locatorCode({ by: "role", value: node.role })
    : locatorCode({ by: "role", value: node.role, name })
}

/** The screen's elements most like what the locator looked for. */
function nearest(nodes: readonly DeviceNode[], query: ScreenQuery): string[] {
  const text = wanted(query)
  const pool = nodes.filter((node) => node.role !== "generic" || node.testId !== undefined)

  const scored = pool.flatMap((node) => {
    if (query.by === "role" && node.role !== query.value) return []

    const seen = query.by === "testId" ? (node.testId ?? "") : node.name || node.text
    const score = text === "" ? 0.5 : likeness(text, seen)

    return score > 0.3 ? [{ node, score }] : []
  })

  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_SHOWN)
    .map(({ node }) => nodeLocator(node))
}

/** One matched element as a line. */
function matchLine(node: DeviceNode): string {
  const name = node.name || node.text

  return `${node.role}${name === "" ? "" : ` ${JSON.stringify(name)}`}${node.testId === undefined ? "" : ` [testId=${node.testId}]`}`
}

/** The answer to `check_locator` for `expression` on one reading of the screen. */
export function checkDeviceLocator(
  nodes: readonly DeviceNode[],
  expression: string,
  redact: (text: string) => string,
): string {
  const locator = parseDeviceLocator(expression)
  const matched = matchDevice(nodes, locator)
  const { code } = locator

  if (matched.length === 0) {
    const empty = emptyLink(nodes, locator)
    const near = nearest(nodes, locator.parsed.last)

    return redact(
      [
        `${code} matches no element. A test using it would fail: the step waits for the element, then times out.`,
        ...(empty === undefined ? [] : [`already ${empty} matches none; fix that part first.`]),
        ...(near.length === 0
          ? []
          : ["nearest on the screen:", ...near.map((line) => `  ${line}`)]),
      ].join("\n"),
    )
  }

  if (matched.length > 1)
    return redact(
      [
        `${code} matches ${matched.length} elements. A test that taps or fills with it would fail: an action needs exactly one element.`,
        ...matched.slice(0, MAX_SHOWN).map((node, index) => `  [${index}] ${matchLine(node)}`),
        "narrow it: give the role's name, add exact: true, look inside a container (getByTestId(…).getByRole(…)), or pick what only this element has (a test id).",
      ].join("\n"),
    )

  const [only] = matched

  return redact(
    [
      `matches exactly 1 element: ${only === undefined ? "" : matchLine(only)}`,
      `use in a test: ${code}`,
    ].join("\n"),
  )
}
