import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const SOURCE = fileURLToPath(new URL("../src", import.meta.url))

/**
 * Elements the component library already builds, accessibly and in the design system's look: the
 * dashboard uses the library's button, select, input, table, list roles, collapsible and dialog
 * rather than styling the raw element itself.
 */
const LIBRARY_BUILDS = [
  "button",
  "select",
  "option",
  "input",
  "textarea",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "ul",
  "ol",
  "li",
  "details",
  "summary",
  "dialog",
  "label",
]

/**
 * Raw elements a dashboard file may use anyway, each with why. Empty today: video, images, links
 * and forms are not on the list above, since the library has no component for them.
 */
const ALLOWED: readonly {
  readonly file: string
  readonly element: string
  readonly why: string
}[] = []

const TAGS = LIBRARY_BUILDS.join("|")

/** Every way a file can reach a raw element: `styled("x")`, `styled.x`, `<x>` and `as="x"`. */
const PATTERNS: readonly RegExp[] = [
  new RegExp(`styled\\(\\s*["'](${TAGS})["']`, "g"),
  new RegExp(`styled\\.(${TAGS})\\b`, "g"),
  new RegExp(`<(${TAGS})(?=[\\s/>])`, "g"),
  new RegExp(`\\bas=\\{?["'](${TAGS})["']`, "g"),
  new RegExp(`\\bas:\\s*["'](${TAGS})["']`, "g"),
]

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) return entry.name === "styled-system" ? [] : sourceFiles(path)

      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".gen.ts") ? [path] : []
    }),
  )

  return nested.flat()
}

/** Where a file reaches a raw element the library builds, as `file:line element`. */
async function rawElementsIn(path: string): Promise<string[]> {
  return rawElementsInText(relative(SOURCE, path), await readFile(path, "utf8"))
}

function rawElementsInText(file: string, text: string): string[] {
  const lines = text.split("\n")

  return lines.flatMap((line, i) =>
    PATTERNS.flatMap((pattern) =>
      [...line.matchAll(pattern)].flatMap((match) => {
        const element = match[1] ?? ""

        return ALLOWED.some((allowed) => allowed.file === file && allowed.element === element)
          ? []
          : [`${file}:${i + 1} ${element}`]
      }),
    ),
  )
}

describe("the dashboard's components", () => {
  it("come from the component library, not raw elements styled by hand", async () => {
    const found = (await Promise.all((await sourceFiles(SOURCE)).map(rawElementsIn))).flat()

    expect(found).toEqual([])
  })

  it("are checked for every way of reaching a raw element", () => {
    const text = [
      'const A = styled("button", {})',
      "const B = styled.select",
      "<table aria-label='x'>",
      '<Box as="li" />',
      '{...(go && { as: "button" })}',
      "<Button variant='ghost' /> <styled.video /> <Link />",
    ].join("\n")

    expect(rawElementsInText("x.tsx", text)).toEqual([
      "x.tsx:1 button",
      "x.tsx:2 select",
      "x.tsx:3 table",
      "x.tsx:4 li",
      "x.tsx:5 button",
    ])
  })

  it("explain every raw element they are allowed", () => {
    for (const allowed of ALLOWED) expect(allowed.why.length).toBeGreaterThan(10)
  })
})
