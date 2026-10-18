/**
 * Reads danwo's TypeScript sources to describe what a module exports: for each exported name its
 * declaration, doc comment and signature, and an interface's members. The spec is built from these
 * descriptions, so it says what the code says and changes when the code does.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"

import {
  type Comment,
  type Declaration as AstDeclaration,
  type ExportNamedDeclaration,
  type Expression,
  type ModuleExportName,
  parseSync,
  type Statement,
  type TSSignature,
  type VariableDeclarator,
} from "oxc-parser"

export type DeclarationKind = "function" | "value" | "interface" | "type" | "class"

/** One member of an interface: its name, its declaration as written and its doc comment. */
export interface Member {
  readonly name: string
  readonly signature: string
  readonly optional: boolean
  readonly doc: string
}

/** An exported name as its source declares it. */
export interface Declared {
  readonly name: string
  readonly kind: DeclarationKind
  /** The module the declaration lives in; empty for a name re-exported from outside danwo. */
  readonly file: string
  readonly doc: string
  /** The function's parameters and return type, the value's type, or the type's definition. */
  readonly signature: string
  /** An interface's own members; empty for every other kind. */
  readonly members: readonly Member[]
  /** The interfaces an interface extends. */
  readonly extends: readonly string[]
}

interface Located {
  readonly node: AstDeclaration
  readonly statement: Statement
}

/** How a module makes a name available: declared here, or taken from another module. */
type Binding =
  | ({ readonly via: "local" } & Located)
  | { readonly via: "module"; readonly from: string; readonly name: string; readonly doc: string }

interface ModuleFacts {
  readonly file: string
  readonly source: string
  readonly comments: readonly Comment[]
  readonly exports: ReadonlyMap<string, Binding>
  readonly star: readonly string[]
}

/** The longest signature kept; longer ones are cut with an ellipsis. */
const MAX_SIGNATURE = 400

/** Whitespace collapsed, so a declaration spread over lines reads as one. */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim()
}

function clipped(text: string): string {
  return text.length > MAX_SIGNATURE ? `${text.slice(0, MAX_SIGNATURE - 1)}…` : text
}

/** A doc comment's text without its `*` gutter, paragraphs kept apart by blank lines. */
function docText(comment: Comment): string {
  const lines = comment.value
    .replace(/^\*/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd())

  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map(oneLine)
    .filter((paragraph) => paragraph !== "")
    .join("\n\n")
}

/** Whether only whitespace and `//` line comments (lint directives) stand between two offsets. */
function nothingBetween(source: string, from: number, to: number): boolean {
  return (
    source
      .slice(from, to)
      .replaceAll(/\/\/[^\n]*/g, "")
      .trim() === ""
  )
}

/** The doc comment right before `start`, with nothing but whitespace or line comments between. */
function docBefore(facts: Pick<ModuleFacts, "source" | "comments">, start: number): string {
  const comment = facts.comments.findLast(
    (c) =>
      c.type === "Block" &&
      c.value.startsWith("*") &&
      c.end <= start &&
      nothingBetween(facts.source, c.end, start),
  )

  return comment === undefined ? "" : docText(comment)
}

function exportName(name: ModuleExportName): string {
  return name.type === "Literal" ? name.value : name.name
}

/** The names a top-level declaration binds, with the node each one is described by. */
function declaredNames(node: AstDeclaration): string[] {
  if (node.type === "VariableDeclaration") {
    return node.declarations.flatMap((declarator) => {
      const id = declarator.id

      if (id.type === "Identifier") return [id.name]
      if (id.type !== "ObjectPattern") return []

      return id.properties.flatMap((property) =>
        property.type === "Property" && property.value.type === "Identifier"
          ? [property.value.name]
          : [],
      )
    })
  }

  if ("id" in node && node.id !== null && node.id.type === "Identifier") return [node.id.name]

  return []
}

function localDeclarations(body: readonly Statement[]): Map<string, Located> {
  const locals = new Map<string, Located>()

  for (const statement of body) {
    const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement

    if (node === null || !isDeclaration(node)) continue

    for (const name of declaredNames(node))
      if (!locals.has(name)) locals.set(name, { node, statement })
  }

  return locals
}

function isDeclaration(node: Statement | AstDeclaration): node is AstDeclaration {
  return [
    "VariableDeclaration",
    "FunctionDeclaration",
    "TSDeclareFunction",
    "ClassDeclaration",
    "TSTypeAliasDeclaration",
    "TSInterfaceDeclaration",
  ].includes(node.type)
}

function importsOf(body: readonly Statement[]): Map<string, { from: string; name: string }> {
  const imports = new Map<string, { from: string; name: string }>()

  for (const statement of body) {
    if (statement.type !== "ImportDeclaration") continue

    for (const specifier of statement.specifiers)
      if (specifier.type === "ImportSpecifier")
        imports.set(specifier.local.name, {
          from: statement.source.value,
          name: exportName(specifier.imported),
        })
  }

  return imports
}

/** What a module knows while reading its export statements. */
interface Scope {
  readonly locals: ReadonlyMap<string, Located>
  readonly imports: ReadonlyMap<string, { from: string; name: string }>
}

/** Where `export { local as exported }` (or `export { … } from`) takes a name from. */
function specifierBinding(
  scope: Scope,
  local: string,
  source: string | undefined,
  doc: string,
): Binding | undefined {
  if (source !== undefined) return { via: "module", from: source, name: local, doc }

  const declared = scope.locals.get(local)

  if (declared !== undefined) return { via: "local", ...declared }

  const imported = scope.imports.get(local)

  return imported && { via: "module", from: imported.from, name: imported.name, doc }
}

/** The names one `export …` statement adds. */
function namedExports(
  facts: Pick<ModuleFacts, "source" | "comments">,
  scope: Scope,
  statement: ExportNamedDeclaration,
): Array<[string, Binding]> {
  const doc = docBefore(facts, statement.start)
  const declaration = statement.declaration
  const declared: Array<[string, Binding]> =
    declaration === null
      ? []
      : declaredNames(declaration).map((name) => [
          name,
          { via: "local", node: declaration, statement },
        ])
  const specified = statement.specifiers.flatMap((specifier): Array<[string, Binding]> => {
    const binding = specifierBinding(
      scope,
      exportName(specifier.local),
      statement.source?.value,
      doc,
    )

    return binding === undefined ? [] : [[exportName(specifier.exported), binding]]
  })

  return [...declared, ...specified]
}

/** Every name a module exports and where each comes from, and the modules it `export *`s. */
function exportsOf(facts: Pick<ModuleFacts, "source" | "comments">, body: readonly Statement[]) {
  const scope: Scope = { locals: localDeclarations(body), imports: importsOf(body) }
  const star = body.flatMap((statement) =>
    statement.type === "ExportAllDeclaration" && statement.exported === null
      ? [statement.source.value]
      : [],
  )
  const exports = new Map(
    body.flatMap((statement) =>
      statement.type === "ExportNamedDeclaration" ? namedExports(facts, scope, statement) : [],
    ),
  )

  return { exports, star }
}

function signatureMember(facts: ModuleFacts, member: TSSignature): Member {
  const text = oneLine(facts.source.slice(member.start, member.end))
    .replace(/;$/, "")
    .replace(/^readonly /, "")
  const key = "key" in member ? member.key : undefined
  const name =
    key === undefined
      ? member.type === "TSIndexSignature"
        ? "[index]"
        : "(call)"
      : key.type === "Identifier"
        ? key.name
        : oneLine(facts.source.slice(key.start, key.end))

  return {
    name,
    signature: text,
    optional: "optional" in member && member.optional,
    doc: docBefore(facts, member.start),
  }
}

/** The text of a function up to its body: `name(params): Returns`. */
function functionSignature(facts: ModuleFacts, start: number, end: number): string {
  return clipped(
    oneLine(facts.source.slice(start, end))
      .replace(/^export /, "")
      .replace(/^(declare )?(async )?function\s*/, "")
      .replace(/\s*\{$/, ""),
  )
}

/** A declarator's signature for `name`, or undefined when it does not bind `name`. */
function declaratorSignature(
  facts: ModuleFacts,
  declarator: VariableDeclarator,
  name: string,
): string | undefined {
  const { id, init } = declarator

  /* `export const { a, b } = c`: each name is a member of `c`. */
  if (id.type === "ObjectPattern")
    return init === null ? undefined : `${textOf(facts, init)}.${name}`
  if (id.type !== "Identifier" || id.name !== name) return undefined
  if (id.typeAnnotation) return clipped(textOf(facts, id.typeAnnotation).replace(/^: ?/, ""))

  return init === null ? "" : initSignature(facts, init)
}

function variableSignature(facts: ModuleFacts, node: AstDeclaration, name: string): string {
  if (node.type !== "VariableDeclaration") return ""

  const signatures = node.declarations.map((d) => declaratorSignature(facts, d, name))

  return signatures.find((s) => s !== undefined) ?? clipped(textOf(facts, node))
}

function textOf(facts: ModuleFacts, span: { readonly start: number; readonly end: number }) {
  return oneLine(facts.source.slice(span.start, span.end))
}

/** A value's signature from what it is initialised with: a function's, or a cast's type. */
function initSignature(facts: ModuleFacts, init: Expression): string {
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
    return functionSignature(facts, init.start, init.body?.start ?? init.end).replace(/ =>$/, "")
  if (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression")
    return clipped(textOf(facts, init.typeAnnotation))

  return clipped(textOf(facts, init))
}

/** What one local declaration says, for the exported name `name`. */
function describeLocal(facts: ModuleFacts, located: Located, name: string): Declared {
  const { node, statement } = located
  const doc = docBefore(facts, statement.start)
  const base = { name, file: facts.file, doc, members: [], extends: [] }

  switch (node.type) {
    case "FunctionDeclaration":
    case "TSDeclareFunction":
      return {
        ...base,
        kind: "function",
        signature: functionSignature(facts, node.start, node.body?.start ?? node.end),
      }
    case "TSInterfaceDeclaration":
      return {
        ...base,
        kind: "interface",
        signature: "",
        members: node.body.body.map((member) => signatureMember(facts, member)),
        extends: node.extends.map((heritage) =>
          oneLine(facts.source.slice(heritage.start, heritage.end)),
        ),
      }
    case "TSTypeAliasDeclaration":
      return {
        ...base,
        kind: "type",
        signature: clipped(
          oneLine(facts.source.slice(node.typeAnnotation.start, node.typeAnnotation.end)),
        ),
      }
    case "ClassDeclaration":
      return { ...base, kind: "class", signature: `class ${name}` }
    default:
      return { ...base, kind: "value", signature: variableSignature(facts, node, name) }
  }
}

/** A name danwo re-exports from a package outside it, such as `z` from zod. */
function external(name: string, from: string, doc: string): Declared {
  return {
    name,
    kind: "value",
    file: "",
    doc,
    signature: `re-exported from ${from}`,
    members: [],
    extends: [],
  }
}

/** Reads and caches modules, and resolves exported names to their declarations. */
export class SourceIndex {
  readonly #modules = new Map<string, ModuleFacts>()

  /** The module file a specifier names from `fromFile`. */
  resolve(specifier: string, fromFile: string): string {
    if (specifier.startsWith(".")) return resolve(dirname(fromFile), specifier)

    return createRequire(fromFile).resolve(specifier)
  }

  /** Every name `file` exports, `export *` included. */
  names(file: string, seen = new Set<string>()): string[] {
    if (seen.has(file)) return []

    seen.add(file)

    const facts = this.#facts(file)
    const starred = facts.star.flatMap((from) => this.names(this.resolve(from, file), seen))

    return [...new Set([...facts.exports.keys(), ...starred])]
  }

  /** What the exported name `name` of `file` is; throws when `file` does not export it. */
  describe(file: string, name: string): Declared {
    const found = this.#find(file, name, new Set())

    if (found === undefined) throw new Error(`${file} does not export ${name}`)

    return found
  }

  #find(file: string, name: string, seen: Set<string>): Declared | undefined {
    const key = `${file}#${name}`

    if (seen.has(key)) return undefined

    seen.add(key)

    const facts = this.#facts(file)
    const binding = facts.exports.get(name)

    if (binding?.via === "local") return describeLocal(facts, binding, name)
    if (binding?.via === "module") return this.#follow(file, name, binding, seen)

    return this.#fromStars(file, facts, name, seen)
  }

  /** A name a module takes from another: danwo's own followed, an outside package's noted. */
  #follow(
    file: string,
    name: string,
    binding: Extract<Binding, { via: "module" }>,
    seen: Set<string>,
  ): Declared | undefined {
    if (!binding.from.startsWith(".") && !binding.from.startsWith("@danwo/"))
      return external(name, binding.from, binding.doc)

    const found = this.#find(this.resolve(binding.from, file), binding.name, seen)

    return found && { ...found, name, doc: found.doc || binding.doc }
  }

  /** A name only an `export *` of the module can provide. */
  #fromStars(file: string, facts: ModuleFacts, name: string, seen: Set<string>) {
    for (const from of facts.star) {
      const found = this.#find(this.resolve(from, file), name, seen)

      if (found !== undefined) return found
    }

    return undefined
  }

  #facts(file: string): ModuleFacts {
    const cached = this.#modules.get(file)

    if (cached !== undefined) return cached

    const source = readFileSync(file, "utf8")
    const parsed = parseSync(file, source, { lang: "ts" })
    const base = { file, source, comments: parsed.comments }
    const facts = { ...base, ...exportsOf(base, parsed.program.body) }

    this.#modules.set(file, facts)

    return facts
  }
}
