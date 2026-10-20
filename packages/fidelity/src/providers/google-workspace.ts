/**
 * Gmail, Calendar and Drive, as a signed-in test account uses them: labels and a message sent to
 * the account itself, an event on its primary calendar, a file the suite uploads, and Google's
 * error answers. Everything made is named with the run's tag and removed when the scenario ends;
 * mail is only ever sent to the account's own address. An API the OAuth client's project has not
 * enabled skips its scenario with the console step that enables it.
 */
import { accountJson, asAccount, requireAccount, untilFound } from "../account-target.ts"
import { GOOGLE_ACCOUNT } from "../accounts.ts"
import type { Answer, Scenario, ScenarioContext } from "../scenario.ts"
import { arrayOf, noBody, num, object, partialObject, str } from "../schema.ts"
import { asJsonObject, isJsonArray, stringField } from "../shape.ts"

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
const CALENDAR = "https://www.googleapis.com/calendar/v3"
const DRIVE = "https://www.googleapis.com/drive/v3"

/** Google's error answer, as its APIs document it for every method. */
const GOOGLE_ERROR = object({
  error: partialObject(
    { code: num, message: str },
    { errors: arrayOf(partialObject({ message: str }, { domain: str, reason: str })), status: str },
  ),
})

/** Whether a list answer's `items` holds an entry whose `field` is `value`. */
function listed(body: unknown, items: string, field: string, value: string): boolean {
  const list: unknown = typeof body === "object" && body !== null ? Reflect.get(body, items) : []

  return (
    Array.isArray(list) &&
    list.some(
      (item: unknown) =>
        typeof item === "object" && item !== null && Reflect.get(item, field) === value,
    )
  )
}

/** The `reason` of each entry of a Google error answer's `errors`. */
function errorReasons(answer: Answer): string[] {
  const errors = asJsonObject(asJsonObject(answer.body)?.["error"])?.["errors"]

  return errors !== undefined && isJsonArray(errors)
    ? errors.map((entry) => stringField(entry, "reason"))
    : []
}

/**
 * Stops the scenario when Google refused the call because the OAuth client's project has not
 * enabled `api`, so a setup gap is reported as one instead of as every later call's mismatch.
 */
function skipWhenDisabled(context: ScenarioContext, answer: Answer, api: string): void {
  if (answer.status === 403 && errorReasons(answer).includes("accessNotConfigured"))
    context.skip(
      `${api} not enabled for this OAuth client's project: in the Google Cloud console, open APIs & Services > Library for the project that owns the client, choose ${api}, press Enable, then wait a few minutes`,
    )
}

/** Stops a scenario on a target without a signed-in account. */
function signedIn(context: ScenarioContext): void {
  requireAccount(context, GOOGLE_ACCOUNT)
}

/** A plain-text message from and to `email`, as Gmail's `raw` field takes it. */
function rawMessage(email: string, subject: string): string {
  return Buffer.from(
    [
      `From: ${email}`,
      `To: ${email}`,
      `Subject: ${subject}`,
      "",
      "Sent by danwo's fidelity check.",
    ].join("\r\n"),
  ).toString("base64url")
}

const labels: Scenario = {
  name: "gmail: labels",
  async run(context) {
    signedIn(context)

    const created = await context.step(
      "create a label",
      accountJson("POST", `${GMAIL}/labels`, {
        name: context.tag,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      }),
      { doc: { operation: "POST /gmail/v1/users/{userId}/labels", status: 200 } },
    )

    skipWhenDisabled(context, created, "Gmail API")

    const id = stringField(created.body, "id")

    context.created({
      kind: "label",
      id,
      undo: () => context.target.send(accountJson("DELETE", `${GMAIL}/labels/${id}`)),
    })
    await context.step("list the labels", accountJson("GET", `${GMAIL}/labels`), {
      doc: { operation: "GET /gmail/v1/users/{userId}/labels", status: 200 },
    })
    await context.step("read the label", accountJson("GET", `${GMAIL}/labels/${id}`), {
      doc: { operation: "GET /gmail/v1/users/{userId}/labels/{id}", status: 200 },
    })
    await context.step("delete the label", accountJson("DELETE", `${GMAIL}/labels/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
  },
}

/** Sends a tagged message to the account's own address and finds it again; returns its ids. */
async function sendToSelf(context: ScenarioContext): Promise<{ id: string; thread: string }> {
  const profile = await context.step(
    "read the account's profile",
    accountJson("GET", `${GMAIL}/profile`),
    {
      doc: { operation: "GET /gmail/v1/users/{userId}/profile", status: 200 },
    },
  )

  skipWhenDisabled(context, profile, "Gmail API")

  const sent = await context.step(
    "send a message to the account itself",
    accountJson("POST", `${GMAIL}/messages/send`, {
      raw: rawMessage(stringField(profile.body, "emailAddress"), context.tag),
    }),
    { doc: { operation: "POST /gmail/v1/users/{userId}/messages/send", status: 200 } },
  )
  const id = stringField(sent.body, "id")

  context.created({
    kind: "message",
    id,
    undo: () => context.target.send(accountJson("POST", `${GMAIL}/messages/${id}/trash`)),
  })

  return { id, thread: stringField(sent.body, "threadId") }
}

const messages: Scenario = {
  name: "gmail: a message sent to the account itself",
  async run(context) {
    signedIn(context)

    const { id, thread } = await sendToSelf(context)
    const search = () =>
      accountJson("GET", `${GMAIL}/messages?q=${encodeURIComponent(`subject:${context.tag}`)}`)

    await context.step(
      "read the message",
      accountJson("GET", `${GMAIL}/messages/${id}?format=full`),
      {
        doc: { operation: "GET /gmail/v1/users/{userId}/messages/{id}", status: 200 },
      },
    )
    await untilFound(context.target, search, (body) => listed(body, "messages", "id", id))
    await context.step("find it by its subject", search(), {
      doc: { operation: "GET /gmail/v1/users/{userId}/messages", status: 200 },
    })
    await context.step(
      "star it and mark it read",
      accountJson("POST", `${GMAIL}/messages/${id}/modify`, {
        addLabelIds: ["STARRED"],
        removeLabelIds: ["UNREAD"],
      }),
      { doc: { operation: "POST /gmail/v1/users/{userId}/messages/{id}/modify", status: 200 } },
    )
    await context.step("read its thread", accountJson("GET", `${GMAIL}/threads/${thread}`), {
      doc: { operation: "GET /gmail/v1/users/{userId}/threads/{id}", status: 200 },
    })
    await context.step(
      "move it to the trash",
      accountJson("POST", `${GMAIL}/messages/${id}/trash`),
      {
        doc: { operation: "POST /gmail/v1/users/{userId}/messages/{id}/trash", status: 200 },
      },
    )
    await context.step(
      "deleting it outright needs the full mail scope",
      accountJson("DELETE", `${GMAIL}/messages/${id}`),
      {
        doc: { schema: GOOGLE_ERROR, status: 403 },
      },
    )
  },
}

/** An hour starting a day from now, as Calendar's start and end. */
function nextHour(): { start: { dateTime: string }; end: { dateTime: string } } {
  const start = new Date(Date.now() + 24 * 3_600_000)

  start.setUTCMinutes(0, 0, 0)

  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 3_600_000).toISOString() },
  }
}

const calendar: Scenario = {
  name: "calendar: an event on the primary calendar",
  async run(context) {
    signedIn(context)

    const events = `${CALENDAR}/calendars/primary/events`

    const calendars = await context.step(
      "list the account's calendars",
      accountJson("GET", `${CALENDAR}/users/me/calendarList`),
      {
        doc: { operation: "GET /calendar/v3/users/me/calendarList", status: 200 },
      },
    )

    skipWhenDisabled(context, calendars, "Google Calendar API")

    const created = await context.step(
      "create an event",
      accountJson("POST", events, { summary: context.tag, ...nextHour() }),
      { doc: { operation: "POST /calendar/v3/calendars/{calendarId}/events", status: 200 } },
    )
    const id = stringField(created.body, "id")

    context.created({
      kind: "event",
      id,
      undo: () => context.target.send(accountJson("DELETE", `${events}/${id}`)),
    })
    await context.step("read the event", accountJson("GET", `${events}/${id}`), {
      doc: { operation: "GET /calendar/v3/calendars/{calendarId}/events/{eventId}", status: 200 },
    })
    await context.step(
      "change its description",
      accountJson("PATCH", `${events}/${id}`, {
        description: "Changed by danwo's fidelity check.",
      }),
      {
        doc: {
          operation: "PATCH /calendar/v3/calendars/{calendarId}/events/{eventId}",
          status: 200,
        },
      },
    )
    await context.step(
      "find it by its text",
      accountJson("GET", `${events}?q=${encodeURIComponent(context.tag)}`),
      {
        doc: { operation: "GET /calendar/v3/calendars/{calendarId}/events", status: 200 },
      },
    )
    await context.step("delete the event", accountJson("DELETE", `${events}/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
  },
}

/** A small text file as a multipart upload: its metadata, then its content. */
function multipartUpload(name: string): Request {
  const boundary = "danwo-fidelity-boundary"
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, mimeType: "text/plain" }),
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    "Uploaded by danwo's fidelity check.",
    `--${boundary}--`,
    "",
  ].join("\r\n")

  return asAccount("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  })
}

const drive: Scenario = {
  name: "drive: a file the suite uploads",
  async run(context) {
    signedIn(context)

    const name = `${context.tag}.txt`
    const uploaded = await context.step("upload a file", multipartUpload(name), {
      doc: { operation: "POST /drive/v3/files", status: 200 },
    })

    skipWhenDisabled(context, uploaded, "Google Drive API")

    const id = stringField(uploaded.body, "id")
    const search = () =>
      accountJson(
        "GET",
        `${DRIVE}/files?q=${encodeURIComponent(`name = '${name}' and trashed = false`)}`,
      )

    context.created({
      kind: "file",
      id,
      undo: () => context.target.send(accountJson("DELETE", `${DRIVE}/files/${id}`)),
    })
    await context.step("read the file", accountJson("GET", `${DRIVE}/files/${id}`), {
      doc: { operation: "GET /drive/v3/files/{fileId}", status: 200 },
    })
    await untilFound(context.target, search, (body) => listed(body, "files", "id", id))
    await context.step("find it by its name", search(), {
      doc: { operation: "GET /drive/v3/files", status: 200 },
    })
    await context.step(
      "rename it",
      accountJson("PATCH", `${DRIVE}/files/${id}`, { name: `${context.tag}-renamed.txt` }),
      {
        doc: { operation: "PATCH /drive/v3/files/{fileId}", status: 200 },
      },
    )
    await context.step(
      "list who can open it",
      accountJson("GET", `${DRIVE}/files/${id}/permissions`),
      {
        doc: { operation: "GET /drive/v3/files/{fileId}/permissions", status: 200 },
      },
    )
    await context.step("delete the file", accountJson("DELETE", `${DRIVE}/files/${id}`), {
      doc: { schema: noBody, status: 204 },
    })
    await context.step("read it once it is gone", accountJson("GET", `${DRIVE}/files/${id}`), {
      doc: { schema: GOOGLE_ERROR, status: 404 },
    })
  },
}

const errors: Scenario = {
  name: "errors: a missing message, no token",
  async run(context) {
    signedIn(context)

    await context.step(
      "read a message that does not exist",
      accountJson("GET", `${GMAIL}/messages/18c0000000000000`),
      { doc: { schema: GOOGLE_ERROR, status: 404 } },
    )
    await context.step("call Gmail without a token", new Request(`${GMAIL}/labels`), {
      doc: { schema: GOOGLE_ERROR, status: 401 },
    })
  },
}

/** The account scenarios, in the order a run takes them. */
export const GOOGLE_ACCOUNT_SCENARIOS: readonly Scenario[] = [
  labels,
  messages,
  calendar,
  drive,
  errors,
]
