// The `test` function a test file imports, and everything hanging off it.
import {
  type Block,
  currentFile,
  type DeclaredTest,
  type FixtureDefinition,
  type HookKind,
  inheritedMode,
  isLoading,
  type Mode,
} from "./registry.ts"
import { SkipSignal } from "./skip.ts"
import {
  type DescribeCall,
  isStoredBody,
  type SessionArgs,
  type SessionDefinition,
  type StoredBody,
  type TestAPI,
  type TestCase,
  type TestOptions,
  type UseOptions,
} from "./types.ts"

type Definitions = Readonly<Record<string, FixtureDefinition>>

/** `test(title, body)` or `test(title, options, body)`, whichever was written. */
function declaration(args: readonly unknown[]): { options: TestOptions; body: StoredBody } {
  const [, second, third] = args

  if (isStoredBody(second)) {
    return { options: {}, body: second }
  }

  if (isStoredBody(third) && typeof second === "object" && second !== null) {
    return { options: second, body: third }
  }

  throw new TypeError("test() takes a title, optional options, and a body function")
}

function testCase(test: DeclaredTest, sealed: () => boolean): TestCase<never> {
  const self: TestCase<never> = {
    invariant(fn) {
      if (sealed()) {
        throw new Error(`"${test.title}": can't add an invariant once its file has loaded`)
      }

      if (test.invariant !== undefined) {
        throw new Error(`"${test.title}" already has an invariant; a test takes one`)
      }

      test.invariant = fn

      return self
    },
  }

  return self
}

function declarer(own: Mode, fixtures: Definitions) {
  return (...args: unknown[]): TestCase<never> => {
    const title = args[0]

    if (typeof title !== "string") {
      throw new TypeError("a test needs a title string first")
    }

    const { options, body } = declaration(args)
    const file = currentFile("test()")
    const { block } = file
    const skipped = options.skip !== undefined && options.skip !== false
    const test: DeclaredTest = {
      title,
      titlePath: [...blockTitles(block), title],
      block,
      mode: inheritedMode(skipped ? "skip" : own, block),
      options,
      body,
      fixtures,
      invariant: undefined,
    }

    file.declarations.tests.push(test)

    return testCase(test, () => file.declarations.sealed)
  }
}

function blockTitles(block: Block | undefined): string[] {
  return block === undefined ? [] : [...blockTitles(block.parent), block.title]
}

/** `test.skip`: a skipped declaration while loading; inside a running test, a runtime skip. */
function skipper(fixtures: Definitions) {
  const declare = declarer("skip", fixtures)

  return (...args: unknown[]): TestCase<never> | undefined => {
    if (typeof args[1] === "function" || typeof args[2] === "function") {
      return declare(...args)
    }

    if (isLoading()) {
      throw new Error(
        "test.skip(reason) skips a running test; to skip a declaration, pass its body",
      )
    }

    const [first, second] = args
    const condition = typeof first === "boolean" ? first : true
    const reason =
      typeof first === "string" ? first : typeof second === "string" ? second : undefined

    if (condition) {
      throw new SkipSignal(reason)
    }

    return undefined
  }
}

function describer(own: Mode) {
  return (title: string, body: () => void): void => {
    const file = currentFile("describe()")
    const outer = file.block

    file.block = { title, parent: outer, mode: inheritedMode(own, outer) }

    try {
      const result: unknown = body()

      if (result instanceof Promise) {
        throw new Error(`describe("${title}") takes a synchronous body; declare tests, don't await`)
      }
    } finally {
      file.block = outer
    }
  }
}

function hook(kind: HookKind) {
  return (fn: StoredBody): void => {
    const file = currentFile(`${kind}()`)

    file.declarations.hooks.push({ kind, block: file.block, fn })
  }
}

function use(options: UseOptions): void {
  const file = currentFile("test.use()")

  file.declarations.uses.push({ block: file.block, options })
}

/**
 * `test.session`: records the file's definition of a saved session. The runner hands every setup
 * the same fixtures; `TestAPI` types the definition by the file's own fixture set.
 */
function session(name: string, definition: SessionDefinition<SessionArgs>): void {
  currentFile("test.session()").declarations.sessions.set(name, definition)
}

const describe: DescribeCall = Object.assign(describer("normal"), {
  skip: describer("skip"),
  only: describer("only"),
})

function testApi<F>(fixtures: Definitions): TestAPI<F> {
  const api = Object.assign(declarer("normal", fixtures), {
    only: declarer("only", fixtures),
    skip: skipper(fixtures),
    describe,
    beforeEach: hook("beforeEach"),
    afterEach: hook("afterEach"),
    beforeAll: hook("beforeAll"),
    afterAll: hook("afterAll"),
    use,
    session,
    extend: (definitions?: object) => testApi({ ...fixtures, ...definitions }),
  })

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runtime functions take every overload's arguments; TestAPI<F> narrows them per fixture set
  return api as unknown as TestAPI<F>
}

export const test: TestAPI = testApi({})
