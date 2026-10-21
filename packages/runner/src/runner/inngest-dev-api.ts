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

const EVENT_RUNS_QUERY = `query ($id: ULID!) {
  eventV2(id: $id) { runs { id functionID status startedAt endedAt } }
}`

/** A run one event started, as the dev server's GraphQL lists it at this moment. */
export interface EventRun {
  readonly id: string
  /** The dev server's id for the function. */
  readonly functionId: string
  /** `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED` or `CANCELLED`. */
  readonly status: string
  readonly startedAt: string | null
  readonly endedAt: string | null
}

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

/** A GraphQL answer from the dev server at `url`, `data` and `errors`; undefined when none came. */
async function answer(
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

    return response.ok ? await response.json() : undefined
  } catch {
    return undefined
  }
}

/** The `data` of a GraphQL answer from the dev server at `url`; undefined when there is none. */
async function ask(
  url: string,
  query: string,
  variables: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  return fieldOf(await answer(url, query, variables), "data")
}

/**
 * The runs event `id` has started so far, as the dev server knows them at this moment (its REST
 * API answers from a cache that lags by up to 15 seconds); none while it has not stored the event
 * yet. Undefined when the dev server does not answer the query.
 */
export async function eventRuns(url: string, id: string): Promise<EventRun[] | undefined> {
  const body = await answer(url, EVENT_RUNS_QUERY, { id })
  const runs = fieldOf(fieldOf(fieldOf(body, "data"), "eventV2"), "runs")

  if (Array.isArray(runs))
    return runs.map((run: unknown) => {
      const time = (name: string) => {
        const value = fieldOf(run, name)

        return typeof value === "string" ? value : null
      }

      return {
        id: textOf(fieldOf(run, "id")),
        functionId: textOf(fieldOf(run, "functionID")),
        status: textOf(fieldOf(run, "status")),
        startedAt: time("startedAt"),
        endedAt: time("endedAt"),
      }
    })

  const unknownEvent = listOf(fieldOf(body, "errors")).some((error) =>
    /event not found/i.test(textOf(fieldOf(error, "message"))),
  )

  return unknownEvent ? [] : undefined
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
