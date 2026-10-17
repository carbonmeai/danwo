import { type Wanted, wantedBy } from "./parameters.ts"
// One test's `test.extend` fixtures: set up on first need, torn down last-set-up-first.
import type { FixtureDefinition } from "./registry.ts"

type SetupFunction = (
  fixtures: Record<string, unknown>,
  use: (value: unknown) => Promise<void>,
) => Promise<void>

interface Running {
  /** Lets the setup function continue past `use(value)` into its teardown. */
  readonly release: () => void
  readonly finished: Promise<void>
}

export interface FixtureScope {
  /** Built-in, environment and set-up extended fixtures: what bodies and hooks receive. */
  readonly values: Record<string, unknown>
  /** Sets up every extended fixture `wanted` names, and the ones they ask for in turn. */
  prepare(wanted: Wanted): Promise<void>
  /** Runs every teardown, last set up first; returns the errors they threw. */
  tearDown(): Promise<unknown[]>
}

/** The union of what several functions ask for. */
export function wantedByAll(fns: readonly ((...args: never[]) => unknown)[]): Wanted {
  const names = new Set<string>()

  for (const fn of fns) {
    const wanted = wantedBy(fn)

    if (wanted === "all") return "all"

    for (const name of wanted) names.add(name)
  }

  return [...names]
}

export function fixtureScope(
  definitions: Readonly<Record<string, FixtureDefinition>>,
  base: Readonly<Record<string, unknown>>,
): FixtureScope {
  const values: Record<string, unknown> = { ...base }
  const started = new Map<string, Promise<void>>()
  const running: Running[] = []

  const start = (name: string, chain: readonly string[]): Promise<void> => {
    if (chain.includes(name)) {
      throw new Error(`fixtures depend on each other in a loop: ${[...chain, name].join(" → ")}`)
    }

    const existing = started.get(name)

    if (existing !== undefined) return existing

    const setup = setUp(name, [...chain, name])

    started.set(name, setup)

    return setup
  }

  const setUp = async (name: string, chain: readonly string[]): Promise<void> => {
    const definition = definitions[name]

    if (typeof definition !== "function") {
      values[name] = definition

      return
    }

    const wanted = wantedBy(definition as SetupFunction)

    // A setup taking the whole object gets every fixture it doesn't itself sit under.
    await prepareAll(
      wanted === "all" ? namesIn(wanted).filter((other) => !chain.includes(other)) : wanted,
      chain,
    )
    values[name] = await runSetup(name, definition as SetupFunction, values, running)
  }

  const prepareAll = async (names: readonly string[], chain: readonly string[]) => {
    for (const name of names) {
      if (name in definitions) await start(name, chain)
    }
  }

  const namesIn = (wanted: Wanted): readonly string[] =>
    wanted === "all" ? Object.keys(definitions) : wanted

  return {
    values,
    prepare: (wanted) => prepareAll(namesIn(wanted), []),
    tearDown: () => tearDownAll(running),
  }
}

/** Starts a setup function and resolves with the value it hands to `use`. */
function runSetup(
  name: string,
  setup: SetupFunction,
  values: Record<string, unknown>,
  running: Running[],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let release = () => {}

    let used = false

    const released = new Promise<void>((done) => {
      release = done
    })

    const use = async (value: unknown) => {
      used = true
      resolve(value)
      await released
    }

    const finished = setup(values, use).then(
      () => {
        if (!used) reject(new Error(`fixture "${name}" finished without calling use(value)`))
      },
      (error: unknown) => {
        if (!used) reject(error)
        else throw error
      },
    )

    running.push({ release: () => release(), finished })
  })
}

async function tearDownAll(running: Running[]): Promise<unknown[]> {
  const errors: unknown[] = []

  for (const fixture of running.toReversed()) {
    fixture.release()
    await fixture.finished.catch((error: unknown) => errors.push(error))
  }

  running.length = 0

  return errors
}
