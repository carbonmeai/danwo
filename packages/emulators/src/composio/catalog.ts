/**
 * The toolkits, tools and trigger types a Composio emulator knows out of the box: the common
 * Gmail, Calendar, Drive, Slack, GitHub and Outlook ones, named and shaped as Composio publishes
 * them. Seeds add custom ones next to these.
 */
import type {
  JsonSchema,
  ToolDefinition,
  ToolkitDefinition,
  TriggerTypeDefinition,
} from "./entities.ts"

type Property = Readonly<Record<string, unknown>>

const text = (description: string): Property => ({ type: "string", description })
const number = (description: string): Property => ({ type: "integer", description })
const flag = (description: string): Property => ({ type: "boolean", description })
const texts = (description: string): Property => ({
  type: "array",
  items: { type: "string" },
  description,
})

function schema(
  properties: Readonly<Record<string, Property>>,
  required: string[] = [],
): JsonSchema {
  return { type: "object", properties, required }
}

const GOOGLE = "https://www.googleapis.com/auth/"

export const TOOLKITS: readonly ToolkitDefinition[] = [
  {
    slug: "gmail",
    name: "Gmail",
    description: "Send, read and organise email in Gmail.",
    categories: ["email"],
    authSchemes: ["OAUTH2"],
    managed: true,
    appUrl: "https://mail.google.com",
    defaultScopes: [`${GOOGLE}gmail.modify`, `${GOOGLE}userinfo.email`],
  },
  {
    slug: "googlecalendar",
    name: "Google Calendar",
    description: "Create and list events on Google Calendar.",
    categories: ["scheduling"],
    authSchemes: ["OAUTH2"],
    managed: true,
    appUrl: "https://calendar.google.com",
    defaultScopes: [`${GOOGLE}calendar`, `${GOOGLE}userinfo.email`],
  },
  {
    slug: "googledrive",
    name: "Google Drive",
    description: "Find, read and share files on Google Drive.",
    categories: ["file management"],
    authSchemes: ["OAUTH2"],
    managed: true,
    appUrl: "https://drive.google.com",
    defaultScopes: [`${GOOGLE}drive`, `${GOOGLE}userinfo.email`],
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Post messages and read channels in a Slack workspace.",
    categories: ["communication"],
    authSchemes: ["OAUTH2", "BEARER_TOKEN"],
    managed: true,
    appUrl: "https://slack.com",
    defaultScopes: ["chat:write", "channels:read", "channels:history", "users:read"],
  },
  {
    slug: "github",
    name: "GitHub",
    description: "Work with repositories, issues and pull requests on GitHub.",
    categories: ["developer tools"],
    authSchemes: ["OAUTH2", "API_KEY"],
    managed: true,
    appUrl: "https://github.com",
    defaultScopes: ["repo", "read:user"],
  },
  {
    slug: "outlook",
    name: "Outlook",
    description: "Send and read mail in Microsoft Outlook.",
    categories: ["email"],
    authSchemes: ["OAUTH2"],
    managed: true,
    appUrl: "https://outlook.office.com",
    defaultScopes: ["Mail.ReadWrite", "Mail.Send", "User.Read", "offline_access"],
  },
]

const messageId = (n: number): string => `18c${String(n).padStart(13, "0")}`

const gmailTools: ToolDefinition[] = [
  {
    slug: "GMAIL_SEND_EMAIL",
    name: "Send Email",
    description: "Sends an email from the user's Gmail account.",
    toolkit: "gmail",
    input: schema(
      {
        recipient_email: text("The primary recipient's address."),
        subject: text("The subject line."),
        body: text("The email body, plain text or HTML."),
        cc: texts("Addresses to copy."),
        bcc: texts("Addresses to blind-copy."),
        is_html: flag("Whether the body is HTML."),
        extra_recipients: texts("Further recipients in the To field."),
      },
      ["body"],
    ),
    scopes: [`${GOOGLE}gmail.send`],
    tags: ["important"],
    sample: (_args, n) => ({ id: messageId(n), threadId: messageId(n), labelIds: ["SENT"] }),
  },
  {
    slug: "GMAIL_FETCH_EMAILS",
    name: "Fetch Emails",
    description: "Lists the user's emails, newest first, with an optional search query.",
    toolkit: "gmail",
    input: schema({
      query: text("A Gmail search query, such as `from:ada@example.com is:unread`."),
      max_results: number("At most this many messages."),
      label_ids: texts("Only messages with all of these labels."),
      include_payload: flag("Include each message's headers and body."),
    }),
    scopes: [`${GOOGLE}gmail.readonly`],
    tags: ["important"],
    sample: () => ({ messages: [], resultSizeEstimate: 0 }),
  },
  {
    slug: "GMAIL_CREATE_EMAIL_DRAFT",
    name: "Create Email Draft",
    description: "Saves an email as a draft in the user's Gmail account.",
    toolkit: "gmail",
    input: schema(
      {
        recipient_email: text("The primary recipient's address."),
        subject: text("The subject line."),
        body: text("The email body."),
        is_html: flag("Whether the body is HTML."),
      },
      ["body"],
    ),
    scopes: [`${GOOGLE}gmail.compose`],
    sample: (_args, n) => ({ id: `r${n}`, message: { id: messageId(n), labelIds: ["DRAFT"] } }),
  },
]

const calendarTools: ToolDefinition[] = [
  {
    slug: "GOOGLECALENDAR_CREATE_EVENT",
    name: "Create Event",
    description: "Creates an event on one of the user's Google calendars.",
    toolkit: "googlecalendar",
    input: schema(
      {
        summary: text("The event's title."),
        description: text("The event's description."),
        start_datetime: text("When it starts, ISO 8601."),
        end_datetime: text("When it ends, ISO 8601; otherwise from the duration."),
        event_duration_hour: number("Hours it lasts when no end is given."),
        event_duration_minutes: number("Minutes it lasts when no end is given."),
        timezone: text("An IANA time zone for the start and end."),
        attendees: texts("Attendees' email addresses."),
        calendar_id: text("The calendar, `primary` by default."),
      },
      ["start_datetime"],
    ),
    scopes: [`${GOOGLE}calendar.events`],
    tags: ["important"],
    sample: (args, n) => ({
      id: `evt${n}`,
      status: "confirmed",
      summary: args["summary"] ?? "",
      start: { dateTime: args["start_datetime"] },
    }),
  },
  {
    slug: "GOOGLECALENDAR_EVENTS_LIST",
    name: "List Events",
    description: "Lists events on one of the user's calendars, optionally within a time range.",
    toolkit: "googlecalendar",
    input: schema({
      calendar_id: text("The calendar, `primary` by default."),
      time_min: text("Only events ending after this time, RFC 3339."),
      time_max: text("Only events starting before this time, RFC 3339."),
      max_results: number("At most this many events."),
      q: text("Free text to search events for."),
    }),
    scopes: [`${GOOGLE}calendar.readonly`],
    sample: () => ({ kind: "calendar#events", items: [] }),
  },
]

const driveTools: ToolDefinition[] = [
  {
    slug: "GOOGLEDRIVE_FIND_FILE",
    name: "Find File",
    description: "Searches the user's Drive for files matching a query.",
    toolkit: "googledrive",
    input: schema({
      q: text("A Drive search query, such as `name contains 'report'`."),
      page_size: number("At most this many files."),
    }),
    scopes: [`${GOOGLE}drive.readonly`],
    tags: ["important"],
    sample: () => ({ files: [] }),
  },
]

const slackTools: ToolDefinition[] = [
  {
    slug: "SLACK_SEND_MESSAGE",
    name: "Send Message",
    description: "Posts a message to a Slack channel, direct message or thread.",
    toolkit: "slack",
    input: schema(
      {
        channel: text("The channel's id or name."),
        text: text("The message's text."),
        markdown_text: text("The message as markdown, instead of `text`."),
        thread_ts: text("Reply in this thread."),
      },
      ["channel"],
    ),
    scopes: ["chat:write"],
    tags: ["important"],
    sample: (args, n) => ({
      ok: true,
      channel: args["channel"],
      ts: `1700000000.${String(n).padStart(6, "0")}`,
    }),
  },
  {
    slug: "SLACK_LIST_ALL_CHANNELS",
    name: "List All Channels",
    description: "Lists the channels in the workspace.",
    toolkit: "slack",
    input: schema({
      limit: number("At most this many channels."),
      types: text("Channel types, such as `public_channel,private_channel`."),
    }),
    scopes: ["channels:read"],
    sample: () => ({ ok: true, channels: [] }),
  },
]

const githubTools: ToolDefinition[] = [
  {
    slug: "GITHUB_CREATE_AN_ISSUE",
    name: "Create an Issue",
    description: "Opens an issue in a GitHub repository.",
    toolkit: "github",
    input: schema(
      {
        owner: text("The repository's owner."),
        repo: text("The repository's name."),
        title: text("The issue's title."),
        body: text("The issue's body."),
        labels: texts("Labels to add."),
        assignees: texts("Logins to assign."),
      },
      ["owner", "repo", "title"],
    ),
    scopes: ["repo"],
    tags: ["important"],
    sample: (args, n) => ({ number: n, title: args["title"], state: "open" }),
  },
  {
    slug: "GITHUB_GET_A_REPOSITORY",
    name: "Get a Repository",
    description: "Reads a GitHub repository.",
    toolkit: "github",
    input: schema(
      { owner: text("The repository's owner."), repo: text("The repository's name.") },
      ["owner", "repo"],
    ),
    sample: (args) => ({
      name: args["repo"],
      full_name: `${String(args["owner"])}/${String(args["repo"])}`,
    }),
  },
]

const outlookTools: ToolDefinition[] = [
  {
    slug: "OUTLOOK_SEND_EMAIL",
    name: "Send Email",
    description: "Sends an email from the user's Outlook mailbox.",
    toolkit: "outlook",
    input: schema(
      {
        to_email: text("The recipient's address."),
        subject: text("The subject line."),
        body: text("The email body."),
        is_html: flag("Whether the body is HTML."),
        cc_emails: texts("Addresses to copy."),
        bcc_emails: texts("Addresses to blind-copy."),
      },
      ["to_email", "subject", "body"],
    ),
    scopes: ["Mail.Send"],
    tags: ["important"],
    sample: () => ({}),
  },
  {
    slug: "OUTLOOK_LIST_MESSAGES",
    name: "List Messages",
    description: "Lists messages in a mail folder, newest first.",
    toolkit: "outlook",
    input: schema({
      folder: text("The folder, `inbox` by default."),
      top: number("At most this many messages."),
    }),
    scopes: ["Mail.Read"],
    sample: () => ({ value: [] }),
  },
]

export const TOOLS: readonly ToolDefinition[] = [
  ...gmailTools,
  ...calendarTools,
  ...driveTools,
  ...slackTools,
  ...githubTools,
  ...outlookTools,
]

export const TRIGGER_TYPES: readonly TriggerTypeDefinition[] = [
  {
    slug: "GMAIL_NEW_GMAIL_MESSAGE",
    name: "New Gmail Message Received",
    description: "Fires when a new message arrives in the user's mailbox.",
    toolkit: "gmail",
    type: "poll",
    config: schema({
      labelIds: text("Only messages with this label, `INBOX` by default."),
      interval: number("Minutes between checks."),
      query: text("Only messages matching this search."),
    }),
    payload: schema({
      message_id: text("The message's id."),
      thread_id: text("The thread's id."),
      sender: text("Who sent it."),
      subject: text("Its subject."),
      message_text: text("Its plain-text body."),
    }),
  },
  {
    slug: "SLACK_RECEIVE_MESSAGE",
    name: "New Message Received",
    description: "Fires when a message is posted in a channel the app can see.",
    toolkit: "slack",
    type: "webhook",
    config: schema({ channel: text("Only messages in this channel.") }),
    payload: schema({
      channel: text("The channel's id."),
      user: text("Who posted it."),
      text: text("The message's text."),
      ts: text("The message's timestamp."),
    }),
  },
  {
    slug: "GITHUB_COMMIT_EVENT",
    name: "Commit Event",
    description: "Fires when commits are pushed to a repository.",
    toolkit: "github",
    type: "webhook",
    config: schema(
      { owner: text("The repository's owner."), repo: text("The repository's name.") },
      ["owner", "repo"],
    ),
    payload: schema({
      id: text("The commit's sha."),
      message: text("The commit message."),
      author: text("Who wrote it."),
      url: text("The commit on GitHub."),
    }),
  },
  {
    slug: "GOOGLECALENDAR_EVENT_CREATED_TRIGGER",
    name: "Event Created",
    description: "Fires when an event is added to the user's calendar.",
    toolkit: "googlecalendar",
    type: "poll",
    config: schema({ calendar_id: text("The calendar, `primary` by default.") }),
    payload: schema({
      event_id: text("The event's id."),
      summary: text("Its title."),
      start: text("When it starts."),
    }),
  },
]
