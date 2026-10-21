/**
 * What `inngestService` asks an Inngest dev server through its GraphQL API (`/v0/gql`): the
 * functions it has registered, the runs one function had since a moment, and invoking a function
 * now, as its "Invoke" button does.
 */

/** A function the dev server has registered. */
export interface RegisteredFunction {
  /** The dev server's id for it, which its runs carry. */
  readonly id: string
  /** The app's id for it, prefixed with the app's (`digests-send-one`). */
  readonly slug: string
  /** The event names it is triggered by, `*` a wildcard. */
  readonly events: readonly string[]
  /** Its cron schedules. */
  readonly crons: readonly string[]
  /** The id of its `onFailure` handler, when it has one. */
  readonly failureHandler: string | undefined
}

const FUNCTIONS_QUERY = "{ functions { id slug triggers { type value } failureHandler { id } } }"
const RUNS_QUERY = `query ($from: Time!, $functions: [UUID!]) {
  runs(first: 200, orderBy: [{ field: QUEUED_AT, direction: ASC }], filter: { from: $from, functionIDs: $functions }) {
    edges { node { triggerIDs } }
  }
}`
const INVOKE_MUTATION = "mutation ($slug: String!) { invokeFunction(functionSlug: $slug) }"

/** `value`'s field `name`, when `value` is an object. */
function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** The `data` of a GraphQL answer from the dev server at `url`; undefined when there is none. */
async function ask(
  url: string,
  query: string,
  variables: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  try {
    const response = await fetch(new URL("/v0/gql", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(2_000),
    })

    return response.ok ? fieldOf(await response.json(), "data") : undefined
  } catch {
    return undefined
  }
}

/** The values of `fn`'s triggers of one `type`. */
function triggersOf(fn: unknown, type: string): string[] {
  return listOf(fieldOf(fn, "triggers")).flatMap((trigger) => {
    const value = fieldOf(trigger, "value")

    return fieldOf(trigger, "type") === type && typeof value === "string" ? [value] : []
  })
}

/** The functions the dev server at `url` has registered; undefined when it cannot say. */
export async function registeredFunctions(url: string): Promise<RegisteredFunction[] | undefined> {
  const functions = fieldOf(await ask(url, FUNCTIONS_QUERY), "functions")

  if (!Array.isArray(functions)) return undefined

  return functions.map((fn: unknown) => {
    const handler = textOf(fieldOf(fieldOf(fn, "failureHandler"), "id"))

    return {
      id: textOf(fieldOf(fn, "id")),
      slug: textOf(fieldOf(fn, "slug")),
      events: triggersOf(fn, "EVENT"),
      crons: triggersOf(fn, "CRON"),
      failureHandler: handler || undefined,
    }
  })
}

/**
 * The events that started the runs of function `id` queued since `sinceMs`, one per run: the
 * dev server's own events for runs no app's event started, such as an invocation or an
 * `onFailure` handler's `inngest/function.failed`.
 */
export async function runTriggers(url: string, id: string, sinceMs: number): Promise<string[]> {
  const runs = fieldOf(
    await ask(url, RUNS_QUERY, { from: new Date(sinceMs).toISOString(), functions: [id] }),
    "runs",
  )

  return listOf(fieldOf(runs, "edges")).flatMap((edge) => {
    const [trigger] = listOf(fieldOf(fieldOf(edge, "node"), "triggerIDs"))

    return typeof trigger === "string" ? [trigger] : []
  })
}

/** Starts a run of the function `slug` now; whether the dev server took it. */
export async function invokeFunction(url: string, slug: string): Promise<boolean> {
  return fieldOf(await ask(url, INVOKE_MUTATION, { slug }), "invokeFunction") === true
}
