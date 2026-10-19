/**
 * Running a tool: a seeded answer when one matches, else the connected backend emulator's API with
 * the account's token, else the catalogue's sample data. Every run is kept in the project's logs.
 */
import type { Emulator } from "../define.ts"
import { isRecord } from "../json.ts"
import type { Store } from "../store.ts"
import { accountForCall, authConfigOf, changeAccount } from "./accounts.ts"
import { type Backend, type BackendAnswer, backendFor, type OAuthClient } from "./backends/index.ts"
import type { ComposioRouteContext } from "./context.ts"
import type { ConnectedAccountRecord, ExecutionRecord, ToolDefinition } from "./entities.ts"
import { badRequest, composioId, iso } from "./helpers.ts"

/** What a tool call answers: Composio's `{ data, error, successful }`. */
export interface ToolAnswer {
  readonly data: unknown
  readonly error: string | null
  readonly successful: boolean
}

/** What a tool handler is told about the call besides its arguments. */
export interface ToolCall {
  readonly tool: string
  readonly userId: string | null
  readonly connectedAccountId: string | null
}

/**
 * Answers one tool's calls from test code: the data to return, or a full {@link ToolAnswer} to make
 * the call unsuccessful, either one directly or as a promise.
 */
export type ToolHandler = (args: Readonly<Record<string, unknown>>, call: ToolCall) => unknown

const HANDLERS = new WeakMap<Store, Map<string, ToolHandler>>()

/** Tool handlers of a Composio emulator, which answer before any seeded result or backend. */
export interface ComposioTools {
  /** Answers every call to `tool` with `handler`, until `clear`. */
  handle(tool: string, handler: ToolHandler): void
  /** Drops every handler. */
  clear(): void
}

export function composioTools(emulator: Pick<Emulator, "store">): ComposioTools {
  const handlers = HANDLERS.get(emulator.store) ?? new Map<string, ToolHandler>()

  HANDLERS.set(emulator.store, handlers)

  return {
    handle: (tool, handler) => handlers.set(tool.toUpperCase(), handler),
    clear: () => handlers.clear(),
  }
}

function isAnswer(value: unknown): value is ToolAnswer {
  return isRecord(value) && "successful" in value && "data" in value
}

/** The required arguments a call left out. */
function missingArguments(tool: ToolDefinition, args: Readonly<Record<string, unknown>>): string[] {
  return (tool.input.required ?? []).filter(
    (name) => args[name] === undefined || args[name] === null,
  )
}

/** The OAuth app an account's tokens were issued to, for refreshing them. */
function clientOf(
  context: ComposioRouteContext,
  account: ConnectedAccountRecord,
  backend: Backend,
): OAuthClient {
  const credentials = authConfigOf(context.objects, account.authConfigId).credentials
  const id = credentials["client_id"]
  const secret = credentials["client_secret"]

  return typeof id === "string" && typeof secret === "string"
    ? { client_id: id, client_secret: secret }
    : backend.managedClient
}

/**
 * Runs `tool` on the backend with the account's token. A 401 refreshes the token once and tries
 * again; when that fails too, the account is marked EXPIRED and the expiry webhook goes out.
 */
async function onBackend(
  context: ComposioRouteContext,
  tool: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
  account: ConnectedAccountRecord,
): Promise<ToolAnswer | undefined> {
  const connected = backendFor(context.store, tool.toolkit)
  const executor = connected?.backend.tools[tool.slug]
  const token = account.val["access_token"]

  if (!connected || !executor || typeof token !== "string") return undefined

  const send = (request: Request) => connected.emulator.fetch(request)
  let answer: BackendAnswer = await executor({ args, token, send })

  if (answer.status === 401) {
    const refreshToken = account.val["refresh_token"]
    const renewed =
      typeof refreshToken === "string"
        ? await connected.backend.refresh(
            send,
            clientOf(context, account, connected.backend),
            refreshToken,
          )
        : undefined

    if (renewed === undefined) {
      const expired = changeAccount(context, account.id, {
        status: "EXPIRED",
        statusReason:
          "The provider refused the account's credentials and they could not be refreshed",
      })

      context.events.expired(expired, context.objects.authConfigs.get(account.authConfigId))

      return answerOf(answer)
    }

    changeAccount(context, account.id, { val: { ...account.val, ...renewed } })
    answer = await executor({ args, token: renewed.access_token, send })
  }

  return answerOf(answer)
}

function answerOf(answer: BackendAnswer): ToolAnswer {
  return answer.error === undefined
    ? { data: answer.data, error: null, successful: true }
    : {
        data: isRecord(answer.data) ? answer.data : { response: answer.data },
        error: answer.error,
        successful: false,
      }
}

/** A seeded result whose `match` fields all equal the call's arguments. */
function seeded(
  context: ComposioRouteContext,
  tool: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
): ToolAnswer | undefined {
  const found = context.objects
    .results()
    .find(
      (result) =>
        result.tool === tool.slug &&
        Object.entries(result.match).every(
          ([key, value]) => JSON.stringify(args[key]) === JSON.stringify(value),
        ),
    )

  return found && { data: found.data, error: found.error, successful: found.successful }
}

async function handled(
  context: ComposioRouteContext,
  tool: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
  call: ToolCall,
): Promise<ToolAnswer | undefined> {
  const handler = HANDLERS.get(context.store)?.get(tool.slug)

  if (!handler) return undefined

  const result = await handler(args, call)

  return isAnswer(result) ? result : { data: result ?? {}, error: null, successful: true }
}

/** The account a call runs on, or null for a tool that needs none. */
function accountFor(
  context: ComposioRouteContext,
  tool: ToolDefinition,
  request: { readonly accountId?: string | undefined; readonly userId?: string | undefined },
): ConnectedAccountRecord | null {
  return tool.noAuth === true ? null : accountForCall(context.objects, tool.toolkit, request)
}

/** Runs a tool call and keeps it in the logs; throws for a call Composio refuses outright. */
export async function execute(
  context: ComposioRouteContext,
  tool: ToolDefinition,
  args: Readonly<Record<string, unknown>>,
  request: { readonly accountId?: string | undefined; readonly userId?: string | undefined },
): Promise<ToolAnswer & { readonly logId: string }> {
  const missing = missingArguments(tool, args)

  if (missing.length > 0) throw badRequest(`Missing required argument(s): ${missing.join(", ")}`)

  const account = accountFor(context, tool, request)
  const call: ToolCall = {
    tool: tool.slug,
    userId: account?.userId ?? request.userId ?? null,
    connectedAccountId: account?.id ?? null,
  }
  const fromTest = (await handled(context, tool, args, call)) ?? seeded(context, tool, args)
  const fromBackend =
    fromTest ?? (account ? await onBackend(context, tool, args, account) : undefined)
  const answer = fromBackend ?? {
    data: tool.sample?.(args, context.objects.next()) ?? {},
    error: null,
    successful: true,
  }
  const record: ExecutionRecord = {
    id: composioId("log"),
    tool: tool.slug,
    toolkit: tool.toolkit,
    userId: call.userId,
    accountId: call.connectedAccountId,
    arguments: { ...args },
    ...answer,
    source: fromTest ? "seeded" : fromBackend ? "backend" : "sample",
    at: iso(context.clock()),
  }

  context.objects.executions.add(record, null)

  return { ...answer, logId: record.id }
}
