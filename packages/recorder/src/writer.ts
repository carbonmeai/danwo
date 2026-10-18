/**
 * Writing a new `*.danwo.ts` file: one test, its imports, the lines around it, its body and its
 * invariant, laid out the way a person would write them. A file that already exists is never
 * replaced.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** One `import { … } from "…"` line. */
export interface ImportLine {
  readonly from: string
  readonly names: readonly string[]
}

/** Lines of a body and the fixtures it destructures, in that order: a test's, or its invariant's. */
export interface InvariantDraft {
  readonly fixtures: readonly string[]
  readonly body: readonly string[]
}

/** Everything a written test file holds: the test's own body, its invariant, and what surrounds them. */
export interface TestFile extends InvariantDraft {
  readonly name: string
  readonly invariant?: InvariantDraft | undefined
  readonly imports: readonly ImportLine[]
  /** Comment lines at the very top, without comment markers. */
  readonly header?: readonly string[]
  /** Lines between the imports and the test, e.g. `const test = base.extend<…>()` or helpers. */
  readonly preamble?: readonly string[]
}

function importCode(line: ImportLine): string {
  return `import { ${line.names.join(", ")} } from ${JSON.stringify(line.from)}`
}

function headerCode(lines: readonly string[]): string[] {
  if (lines.length === 0) return []

  return ["/**", ...lines.map((line) => ` * ${line.replace(/\*\//g, "* /")}`.trimEnd()), " */"]
}

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => (line === "" ? "" : `  ${line}`))
}

/** A body's parameter list: the fixtures it destructures, or none. */
function parameters(fixtures: readonly string[]): string {
  return fixtures.length === 0 ? "()" : `({ ${fixtures.join(", ")} })`
}

function closing(invariant: InvariantDraft | undefined): string[] {
  if (invariant === undefined) return ["})"]

  return [
    `}).invariant(async ${parameters(invariant.fixtures)} => {`,
    ...indented(invariant.body),
    "})",
  ]
}

/** The file's source, formatted, ending in a newline. */
export function renderTest(file: TestFile): string {
  const preamble = file.preamble ?? []

  return [
    ...headerCode(file.header ?? []),
    ...file.imports.map(importCode),
    "",
    ...(preamble.length === 0 ? [] : [...preamble, ""]),
    `test(${JSON.stringify(file.name)}, async ${parameters(file.fixtures)} => {`,
    ...indented(file.body),
    ...closing(file.invariant),
    "",
  ].join("\n")
}

/** Writes `source` at `path`, refusing to replace a file that is already there. */
export async function writeNewTest(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, source, { flag: "wx" }).catch((error: unknown) => {
    const exists = error instanceof Error && "code" in error && error.code === "EEXIST"

    throw exists ? new Error(`${path} already exists; danwo never overwrites a test file`) : error
  })
}
