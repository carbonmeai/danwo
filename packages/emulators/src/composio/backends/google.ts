import { seedGoogle } from "../../google/index.ts"
import { googleStore } from "../../google/store.ts"
/** Gmail, Google Calendar and Google Drive tools, run on the Google emulator. */
import { asRecord } from "../../json.ts"
import { OAUTH_CALLBACK } from "../helpers.ts"
import {
  apiCall,
  arg,
  argList,
  argNumber,
  type Backend,
  challengeParams,
  type BackendAnswer,
  type Executor,
  type Send,
  tokenEndpoint,
  withQuery,
} from "./backend.ts"

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
const CALENDAR = "https://www.googleapis.com/calendar/v3"
const DRIVE = "https://www.googleapis.com/drive/v3"
const TOKEN = "https://oauth2.googleapis.com/token"

/** An RFC 822 message for the Gmail API's `raw` field, base64url. */
function rawMessage(args: Readonly<Record<string, unknown>>): string {
  const to = [arg(args, "recipient_email"), ...argList(args, "extra_recipients")].filter(
    (address) => address !== undefined,
  )
  const headers = [
    to.length > 0 && `To: ${to.join(", ")}`,
    argList(args, "cc").length > 0 && `Cc: ${argList(args, "cc").join(", ")}`,
    argList(args, "bcc").length > 0 && `Bcc: ${argList(args, "bcc").join(", ")}`,
    `Subject: ${arg(args, "subject") ?? ""}`,
    "MIME-Version: 1.0",
    `Content-Type: ${args["is_html"] === true ? "text/html" : "text/plain"}; charset="UTF-8"`,
  ].filter((line) => typeof line === "string")

  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${arg(args, "body") ?? ""}`).toString(
    "base64url",
  )
}

/** A header of a Gmail message resource. */
function header(message: Record<string, unknown>, name: string): string {
  const headers = asRecord(message["payload"])?.["headers"]

  if (!Array.isArray(headers)) return ""

  const found = headers.map(asRecord).find((h) => String(h?.["name"]).toLowerCase() === name)

  return typeof found?.["value"] === "string" ? found["value"] : ""
}

/** The plain-text body of a Gmail message resource, from its first text part. */
function plainText(part: Record<string, unknown> | undefined): string {
  const data = asRecord(part?.["body"])?.["data"]

  if (typeof data === "string" && String(part?.["mimeType"]).startsWith("text/"))
    return Buffer.from(data, "base64url").toString()

  const parts = part?.["parts"]

  return Array.isArray(parts)
    ? (parts.map((p) => plainText(asRecord(p))).find((t) => t !== "") ?? "")
    : ""
}

/** A message the way Composio's Gmail tools describe one. */
function describedMessage(message: Record<string, unknown>) {
  return {
    messageId: message["id"],
    threadId: message["threadId"],
    labelIds: message["labelIds"] ?? [],
    messageTimestamp: new Date(Number(message["internalDate"] ?? 0)).toISOString(),
    sender: header(message, "from"),
    to: header(message, "to"),
    subject: header(message, "subject"),
    messageText: plainText(asRecord(message["payload"])),
    preview: { subject: header(message, "subject"), body: message["snippet"] ?? "" },
  }
}

/** Reads each listed message, or the first failed read. */
async function readMessages(
  send: Send,
  token: string,
  ids: readonly unknown[],
): Promise<unknown[] | BackendAnswer> {
  const messages: unknown[] = []

  for (const entry of ids) {
    const read = await apiCall(
      send,
      token,
      "GET",
      `${GMAIL}/messages/${String(asRecord(entry)?.["id"])}`,
    )

    if (read.error !== undefined) return read
    messages.push(describedMessage(asRecord(read.data) ?? {}))
  }

  return messages
}

const fetchEmails: Executor = async ({ args, token, send }) => {
  const listed = await apiCall(
    send,
    token,
    "GET",
    withQuery(`${GMAIL}/messages`, {
      q: arg(args, "query"),
      maxResults: argNumber(args, "max_results") ?? 10,
      labelIds: argList(args, "label_ids").join(",") || undefined,
    }),
  )
  const ids = asRecord(listed.data)?.["messages"]

  if (listed.error !== undefined || !Array.isArray(ids)) return listed

  const messages = await readMessages(send, token, ids)

  if (!Array.isArray(messages)) return messages

  return {
    status: 200,
    data: {
      messages,
      nextPageToken: asRecord(listed.data)?.["nextPageToken"] ?? null,
      resultSizeEstimate: messages.length,
    },
  }
}

/** The event body Google Calendar takes, from Composio's flatter arguments. */
function eventBody(args: Readonly<Record<string, unknown>>) {
  const start = arg(args, "start_datetime") ?? new Date().toISOString()
  const minutes =
    (argNumber(args, "event_duration_hour") ?? 0) * 60 +
    (argNumber(args, "event_duration_minutes") ?? 0)
  const end =
    arg(args, "end_datetime") ??
    new Date(Date.parse(start) + (minutes > 0 ? minutes : 30) * 60_000).toISOString()
  const timeZone = arg(args, "timezone")

  return {
    summary: arg(args, "summary"),
    description: arg(args, "description"),
    start: { dateTime: start, ...(timeZone && { timeZone }) },
    end: { dateTime: end, ...(timeZone && { timeZone }) },
    attendees: argList(args, "attendees").map((email) => ({ email })),
  }
}

const calendarOf = (args: Readonly<Record<string, unknown>>): string =>
  encodeURIComponent(arg(args, "calendar_id") ?? "primary")

const tools: Record<string, Executor> = {
  GMAIL_SEND_EMAIL: ({ args, token, send }) =>
    apiCall(send, token, "POST", `${GMAIL}/messages/send`, { raw: rawMessage(args) }),
  GMAIL_CREATE_EMAIL_DRAFT: ({ args, token, send }) =>
    apiCall(send, token, "POST", `${GMAIL}/drafts`, { message: { raw: rawMessage(args) } }),
  GMAIL_FETCH_EMAILS: fetchEmails,
  GOOGLECALENDAR_CREATE_EVENT: ({ args, token, send }) =>
    apiCall(
      send,
      token,
      "POST",
      `${CALENDAR}/calendars/${calendarOf(args)}/events`,
      eventBody(args),
    ),
  GOOGLECALENDAR_EVENTS_LIST: ({ args, token, send }) =>
    apiCall(
      send,
      token,
      "GET",
      withQuery(`${CALENDAR}/calendars/${calendarOf(args)}/events`, {
        timeMin: arg(args, "time_min"),
        timeMax: arg(args, "time_max"),
        maxResults: argNumber(args, "max_results"),
        q: arg(args, "q"),
      }),
    ),
  GOOGLEDRIVE_FIND_FILE: ({ args, token, send }) =>
    apiCall(
      send,
      token,
      "GET",
      withQuery(`${DRIVE}/files`, { q: arg(args, "q"), pageSize: argNumber(args, "page_size") }),
    ),
}

async function whoami(send: Send, token: string): Promise<string | null> {
  const answer: BackendAnswer = await apiCall(
    send,
    token,
    "GET",
    "https://openidconnect.googleapis.com/v1/userinfo",
  )
  const email = asRecord(answer.data)?.["email"]

  return typeof email === "string" ? email : null
}

export const googleBackend: Backend = {
  name: "google",
  toolkits: ["gmail", "googlecalendar", "googledrive"],
  managedClient: {
    client_id: "composio-managed.apps.googleusercontent.com",
    client_secret: "GOCSPX-composio-managed",
  },
  pkce: true,
  authorizeUrl: (client, scopes, state, challenge) =>
    withQuery("https://accounts.google.com/o/oauth2/v2/auth", {
      client_id: client.client_id,
      redirect_uri: OAUTH_CALLBACK,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      ...challengeParams(challenge),
    }),
  ...tokenEndpoint(TOKEN),
  whoami,
  register(emulator, client) {
    if (googleStore(emulator.store).clients.findOneBy("client_id", client.client_id)) return

    seedGoogle(emulator.store, {
      oauth_clients: [{ ...client, name: "Composio", redirect_uris: [OAUTH_CALLBACK] }],
    })
  },
  apiBase: (toolkit) =>
    ({ gmail: "https://gmail.googleapis.com", googlecalendar: CALENDAR, googledrive: DRIVE })[
      toolkit
    ] ?? "https://www.googleapis.com",
  tools,
}
