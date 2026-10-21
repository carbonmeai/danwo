/**
 * A test file's `beforeAll` and `afterAll` hooks around its tests. Teardown always runs: every
 * `afterAll` runs after the file's tests, after a `beforeAll` that threw, and after an earlier
 * `afterAll` that threw, so external state a setup made (seeded accounts, uploaded files) is
 * cleaned up whichever way the file went. The first failure is what the file reports; the others
 * are named beside it.
 */
import { type FileDeclarations, suiteHooks } from "../tests/registry.ts"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Runs every `afterAll` hook of `declarations`, innermost first; resolves to what each threw. */
async function teardown(declarations: FileDeclarations, fixtures: object): Promise<unknown[]> {
  const errors: unknown[] = []

  for (const hook of suiteHooks(declarations, "afterAll")) {
    try {
      await hook.fn(fixtures)
    } catch (error) {
      errors.push(error)
    }
  }

  return errors
}

/** The one error a file reports: its first failure, with any teardown failures named after it. */
export function fileFailure(first: unknown, teardownErrors: readonly unknown[]): unknown {
  const all = first === undefined ? [...teardownErrors] : [first, ...teardownErrors]

  if (all.length <= 1) return all[0]

  const [lead, ...rest] = all
  const afterAll = rest.map(messageOf).join("; ")
  const message =
    first === undefined
      ? `${all.length} afterAll hooks failed: ${all.map(messageOf).join("; ")}`
      : `${messageOf(lead)} (afterAll also failed: ${afterAll})`

  return new AggregateError(all, message, { cause: lead })
}

/**
 * Runs `body` (the file's setup and tests), then every `afterAll` hook whatever `body` did; throws
 * the file's failure, if it had one, once teardown is done.
 */
export async function withTeardown<T>(
  declarations: FileDeclarations,
  fixtures: object,
  body: () => Promise<T>,
): Promise<T> {
  let result: { readonly value: T } | undefined
  let failed: unknown

  try {
    result = { value: await body() }
  } catch (error) {
    failed = error ?? new Error("the file's setup failed")
  }

  const failure = fileFailure(failed, await teardown(declarations, fixtures))

  if (failure !== undefined || result === undefined) throw failure

  return result.value
}
