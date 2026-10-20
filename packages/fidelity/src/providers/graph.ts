/**
 * Microsoft Graph, as a signed-in test account uses it: a message sent to the account itself, an
 * event, a OneDrive file the suite uploads, the app's change subscriptions, and Graph's error
 * answers. Everything made is named with the run's tag and removed when the scenario ends; mail
 * is only ever sent to the account's own address and deleted for good, both copies.
 */
import { accountJson, asAccount, requireAccount, untilFound } from "../account-target.ts"
import { MICROSOFT_ACCOUNT } from "../accounts.ts"
import type { Scenario, ScenarioContext, Target } from "../scenario.ts"
import { map, noBody, object, partialObject, str } from "../schema.ts"
import { asJsonObject, isJsonArray, type Json, readJson, stringField } from "../shape.ts"

export const GRAPH = "https://graph.microsoft.com/v1.0"

/** The paths of Graph's description the scenarios' answers are documented by. */
export const GRAPH_PATHS = [
  "/me",
  "/me/mailFolders",
  "/me/messages",
  "/me/messages/{message-id}",
  "/me/events",
  "/me/events/{event-id}",
  "/drives/{drive-id}/items/{driveItem-id}",
  "/drives/{drive-id}/items/{driveItem-id}/children",
  "/subscriptions",
] as const

/** Graph's error answer. */
const GRAPH_ERROR = object({
  error: partialObject({ code: str, message: str }, { innerError: map }),
})

/** The entries of a collection answer. */
export function valuesOf(body: Json): readonly Json[] {
  const value = asJsonObject(body)?.["value"]

  return value !== undefined && isJsonArray(value) ? value : []
}

/** A `$filter` on an exact subject. */
function bySubject(collection: string, subject: string): string {
  return `${GRAPH}/me/${collection}?$filter=${encodeURIComponent(`subject eq '${subject}'`)}`
}

/** Deletes for good every message whose subject is `subject`: the inbox and sent copies. */
export async function purgeMessages(target: Target, subject: string): Promise<Response> {
  const found = valuesOf(
    await readJson(await target.send(accountJson("GET", bySubject("messages", subject)))),
  )
  let last = new Response(null, { status: 204 })

  for (const message of found)
    last = await target.send(
      accountJson("POST", `${GRAPH}/me/messages/${stringField(message, "id")}/permanentDelete`),
    )

  return last
}

function signedIn(context: ScenarioContext): void {
  requireAccount(context, MICROSOFT_ACCOUNT)
}

const mail: Scenario = {
  name: "mail: a message sent to the account itself",
  async run(context) {
    signedIn(context)

    const me = await context.step("read the account", accountJson("GET", `${GRAPH}/me`), {
      doc: { operation: "GET /v1.0/me", status: 200 },
    })
    const address = stringField(me.body, "mail") || stringField(me.body, "userPrincipalName")

    await context.step("list the mail folders", accountJson("GET", `${GRAPH}/me/mailFolders`), {
      doc: { operation: "GET /v1.0/me/mailFolders", status: 200 },
    })
    context.created({
      kind: "message",
      id: context.tag,
      undo: () => purgeMessages(context.target, context.tag),
    })
    await context.step(
      "send a message to the account itself",
      accountJson("POST", `${GRAPH}/me/sendMail`, {
        message: {
          subject: context.tag,
          body: { contentType: "Text", content: "Sent by danwo's fidelity check." },
          toRecipients: [{ emailAddress: { address } }],
        },
        saveToSentItems: true,
      }),
      { doc: { schema: noBody, status: 202 } },
    )

    const search = () => accountJson("GET", bySubject("messages", context.tag))

    await untilFound(context.target, search, (body) => valuesOf(body).length >= 2)

    const found = await context.step("find it by its subject", search(), {
      doc: { operation: "GET /v1.0/me/messages", status: 200 },
    })
    const id = stringField(valuesOf(found.body)[0] ?? null, "id")

    await context.step("read the message", accountJson("GET", `${GRAPH}/me/messages/${id}`), {
      doc: { operation: "GET /v1.0/me/messages/{message-id}", status: 200 },
    })
    await context.step(
      "mark it read and flag it",
      accountJson("PATCH", `${GRAPH}/me/messages/${id}`, {
        isRead: true,
        flag: { flagStatus: "flagged" },
      }),
      { doc: { operation: "PATCH /v1.0/me/messages/{message-id}", status: 200 } },
    )
    await context.step("delete the message", accountJson("DELETE", `${GRAPH}/me/messages/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
  },
}

/** A time as Graph's `dateTimeTimeZone`, in UTC. */
function graphTime(date: Date): { dateTime: string; timeZone: string } {
  return { dateTime: date.toISOString().slice(0, 19), timeZone: "UTC" }
}

/** An hour starting a day from now, as Graph's start and end. */
function nextHour(): {
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
} {
  const start = new Date(Date.now() + 24 * 3_600_000)

  start.setUTCMinutes(0, 0, 0)

  return { start: graphTime(start), end: graphTime(new Date(start.getTime() + 3_600_000)) }
}

const events: Scenario = {
  name: "calendar: an event",
  async run(context) {
    signedIn(context)

    const created = await context.step(
      "create an event",
      accountJson("POST", `${GRAPH}/me/events`, { subject: context.tag, ...nextHour() }),
      { doc: { operation: "POST /v1.0/me/events", status: 201 } },
    )
    const id = stringField(created.body, "id")

    context.created({
      kind: "event",
      id,
      undo: () => context.target.send(accountJson("DELETE", `${GRAPH}/me/events/${id}`)),
    })
    await context.step("read the event", accountJson("GET", `${GRAPH}/me/events/${id}`), {
      doc: { operation: "GET /v1.0/me/events/{event-id}", status: 200 },
    })
    await context.step(
      "change its location",
      accountJson("PATCH", `${GRAPH}/me/events/${id}`, { location: { displayName: "danwo" } }),
      { doc: { operation: "PATCH /v1.0/me/events/{event-id}", status: 200 } },
    )
    await context.step(
      "find it by its subject",
      accountJson("GET", bySubject("events", context.tag)),
      {
        doc: { operation: "GET /v1.0/me/events", status: 200 },
      },
    )
    await context.step("delete the event", accountJson("DELETE", `${GRAPH}/me/events/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
  },
}

const ITEM = "/v1.0/drives/{drive-id}/items/{driveItem-id}"

const onedrive: Scenario = {
  name: "onedrive: a file the suite uploads",
  async run(context) {
    signedIn(context)

    const uploaded = await context.step(
      "upload a file",
      asAccount(`${GRAPH}/me/drive/root:/${context.tag}.txt:/content`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "Uploaded by danwo's fidelity check.",
      }),
      { doc: { operation: `GET ${ITEM}`, status: 201 } },
    )
    const id = stringField(uploaded.body, "id")

    context.created({
      kind: "file",
      id,
      undo: () => context.target.send(accountJson("DELETE", `${GRAPH}/me/drive/items/${id}`)),
    })
    await context.step("read the file", accountJson("GET", `${GRAPH}/me/drive/items/${id}`), {
      doc: { operation: `GET ${ITEM}`, status: 200 },
    })
    await context.step(
      "list the drive's top folder",
      accountJson("GET", `${GRAPH}/me/drive/root/children`),
      {
        doc: { operation: `GET ${ITEM}/children`, status: 200 },
      },
    )
    await context.step("delete the file", accountJson("DELETE", `${GRAPH}/me/drive/items/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
  },
}

const subscriptions: Scenario = {
  name: "subscriptions: the app's change subscriptions",
  async run(context) {
    signedIn(context)

    await context.step("list the subscriptions", accountJson("GET", `${GRAPH}/subscriptions`), {
      doc: { operation: "GET /v1.0/subscriptions", status: 200 },
    })
  },
}

const errors: Scenario = {
  name: "errors: a missing file, no token",
  async run(context) {
    signedIn(context)

    await context.step(
      "read a file that does not exist",
      accountJson("GET", `${GRAPH}/me/drive/items/01DANWOFIDELITYNOSUCHITEM000000000`),
      { doc: { schema: GRAPH_ERROR, status: 404 } },
    )
    await context.step("call Graph without a token", new Request(`${GRAPH}/me`), {
      doc: { schema: GRAPH_ERROR, status: 401 },
    })
  },
}

/** The account scenarios, in the order a run takes them. */
export const GRAPH_SCENARIOS: readonly Scenario[] = [mail, events, onedrive, subscriptions, errors]
