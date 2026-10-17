/*
 * What loading a test file declared: its tests, describe blocks and hooks, as plain records the
 * worker runs and the parent turns into a test list.
 */
import type { StoredBody, TestOptions } from "./types.ts"

export type Mode = "normal" | "skip" | "only"

/** A `describe` block. */
export interface Block {
  readonly title: string
  readonly parent: Block | undefined
  readonly mode: Mode
}

/** A fixture definition from `test.extend`: a setup function or a plain value. */
export type FixtureDefinition = unknown

export interface DeclaredTest {
  readonly title: string
  /** Describe titles from the outside in, then the test's own title. */
  readonly titlePath: readonly string[]
  readonly block: Block | undefined
  readonly mode: Mode
  readonly options: TestOptions
  readonly body: StoredBody
  readonly fixtures: Readonly<Record<string, FixtureDefinition>>
  invariant: StoredBody | undefined
}

export type HookKind = "beforeEach" | "afterEach" | "beforeAll" | "afterAll"

export interface DeclaredHook {
  readonly kind: HookKind
  readonly block: Block | undefined
  readonly fn: StoredBody
}

export interface FileDeclarations {
  readonly tests: DeclaredTest[]
  readonly hooks: DeclaredHook[]
  /** Set once the file finished loading; nothing can be declared on it afterwards. */
  sealed: boolean
}

interface Loading {
  readonly declarations: FileDeclarations
  block: Block | undefined
}

let loading: Loading | undefined

/** The file being loaded, or an error naming what was called outside one. */
export function currentFile(what: string): Loading {
  if (loading === undefined) {
    throw new Error(`${what} can only be called while danwo loads a test file`)
  }

  return loading
}

export function isLoading(): boolean {
  return loading !== undefined
}

/** Runs `load` (which imports a test file) and returns everything that file declared. */
export async function declarationsOf(load: () => Promise<unknown>): Promise<FileDeclarations> {
  if (loading !== undefined) {
    throw new Error("danwo loads one test file at a time")
  }

  const declarations: FileDeclarations = { tests: [], hooks: [], sealed: false }

  loading = { declarations, block: undefined }

  try {
    await load()
  } finally {
    loading = undefined
    declarations.sealed = true
  }

  return declarations
}

/** `block` and the blocks around it, innermost first. */
function enclosing(block: Block | undefined): Block[] {
  return block === undefined ? [] : [block, ...enclosing(block.parent)]
}

/**
 * The mode a new block or test gets: its own, unless the block it sits in skips or focuses. A
 * block's own mode already folds in the blocks around it.
 */
export function inheritedMode(own: Mode, block: Block | undefined): Mode {
  const around = block?.mode ?? "normal"

  if (own === "skip" || around === "skip") return "skip"

  return own === "only" || around === "only" ? "only" : "normal"
}

/**
 * The hooks of `kind` that apply to `test`: those at the file's top level and in its enclosing
 * blocks. `beforeEach` runs outermost first, `afterEach` innermost first; hooks of one block keep
 * their declaration order.
 */
export function hooksAround(
  file: FileDeclarations,
  test: DeclaredTest,
  kind: "beforeEach" | "afterEach",
): DeclaredHook[] {
  const blocks = enclosing(test.block)
  const depth = (hook: DeclaredHook) =>
    hook.block === undefined ? blocks.length : blocks.indexOf(hook.block)
  const applies = file.hooks.filter(
    (hook) => hook.kind === kind && (hook.block === undefined || blocks.includes(hook.block)),
  )

  // `depth` counts from the innermost block (0) out to the file (blocks.length).
  return applies.toSorted((a, b) =>
    kind === "beforeEach" ? depth(b) - depth(a) : depth(a) - depth(b),
  )
}

/** The file's `beforeAll` hooks outermost first, or its `afterAll` hooks innermost first. */
export function suiteHooks(file: FileDeclarations, kind: "beforeAll" | "afterAll"): DeclaredHook[] {
  const depth = (hook: DeclaredHook) => enclosing(hook.block).length
  const hooks = file.hooks.filter((hook) => hook.kind === kind)

  return hooks.toSorted((a, b) =>
    kind === "beforeAll" ? depth(a) - depth(b) : depth(b) - depth(a),
  )
}
