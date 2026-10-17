/*
 * Which fixtures a function asks for, read from its source: `({ app, resource }) => ...` asks for
 * `app` and `resource`. This is what makes extended fixtures lazy.
 */

/**
 * The names a function destructures from its first parameter; "all" when it takes the whole
 * object under a name. A name starting with `_` (`_fixtures`) marks the object as unused.
 */
export type Wanted = readonly string[] | "all"

const OPENERS = "([{"
const CLOSERS = ")]}"
const QUOTES = "'\"`"

export function wantedBy(fn: (...args: never[]) => unknown): Wanted {
  const source = withoutComments(fn.toString()).trim()
  const open = parameterListStart(source)

  if (open === undefined) {
    // `name => ...`: the whole object under one name.
    const bare = /^(?:async\s+)?([\w$]+)\s*=>/.exec(source)?.[1]

    return bare === undefined ? [] : wholeObject(bare)
  }

  const first = (listItems(source, open + 1)[0] ?? "").trim()

  if (first === "") return []

  return first.startsWith("{") ? destructured(first) : wholeObject(first)
}

function wholeObject(parameter: string): Wanted {
  return parameter.startsWith("_") ? [] : "all"
}

function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")
}

/** Where the parameter list's `(` is, or undefined for a single bare parameter. */
function parameterListStart(source: string): number | undefined {
  if (/^(async\s+)?[\w$]+\s*=>/.test(source)) return undefined

  const at = source.indexOf("(")

  return at === -1 ? undefined : at
}

/** The comma-separated items from `start` up to the bracket that closes the one before it. */
function listItems(text: string, start: number): string[] {
  const items: string[] = []
  const scan: Scan = { depth: 0, quote: undefined }
  let from = start
  let at = start

  for (; at < text.length; at++) {
    const char = text.charAt(at)
    const step = advance(scan, char, text.charAt(at - 1))

    if (step === "close") break

    if (step === "comma") {
      items.push(text.slice(from, at))
      from = at + 1
    }
  }

  return [...items, text.slice(from, at)]
}

interface Scan {
  depth: number
  quote: string | undefined
}

/** Moves the scan past `char`: a top-level comma, the closing bracket, or anything else. */
function advance(scan: Scan, char: string, previous: string): "comma" | "close" | undefined {
  if (scan.quote !== undefined) {
    if (char === scan.quote && previous !== "\\") scan.quote = undefined

    return undefined
  }

  if (QUOTES.includes(char)) {
    scan.quote = char

    return undefined
  }

  return bracket(scan, char)
}

function bracket(scan: Scan, char: string): "comma" | "close" | undefined {
  if (OPENERS.includes(char)) scan.depth++
  else if (CLOSERS.includes(char)) return scan.depth-- === 0 ? "close" : undefined

  return char === "," && scan.depth === 0 ? "comma" : undefined
}

/** The property names an object pattern `{ a, b: c, d = 1 }` takes; "all" for a rest element. */
function destructured(pattern: string): Wanted {
  const names: string[] = []

  for (const raw of listItems(pattern, 1)) {
    const item = raw.trim()

    if (item === "") continue

    if (item.startsWith("...") || item.startsWith("[")) return "all"

    names.push(propertyName(item))
  }

  return names
}

function propertyName(item: string): string {
  const key = /^\s*("[^"]*"|'[^']*'|[\w$]+)/.exec(item)?.[1] ?? item

  return key.replaceAll(/^["']|["']$/g, "")
}
