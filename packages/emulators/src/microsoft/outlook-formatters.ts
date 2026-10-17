import type {
  Attendee,
  Calendar,
  Event,
  FileAttachment,
  MailFolder,
  Message,
  Recipient,
} from "@microsoft/microsoft-graph-types"

import type {
  Address,
  CalendarRecord,
  EventRecord,
  MailAttachment,
  MailFolderRecord,
  MessageRecord,
  MicrosoftUser,
} from "./entities.ts"
import { formatInZone } from "./time-zones.ts"

/** How a reader wants bodies and times: Graph's `Prefer` header choices. */
export interface Preferences {
  /** `outlook.body-content-type="text"`: bodies as plain text. */
  readonly textBodies: boolean
  /** `outlook.timezone="…"`: event times in this zone instead of UTC. */
  readonly timeZone: string
}

const TAGS = /<(script|style)\b[\s\S]*?<\/\1>|<[^>]*>/gi

/** An HTML body's readable text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(TAGS, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim()
}

function recipient(address: Address): Recipient {
  return { emailAddress: { name: address.name, address: address.address } }
}

function body(type: "text" | "html", content: string, preferences: Preferences) {
  return preferences.textBodies && type === "html"
    ? { contentType: "text" as const, content: htmlToText(content) }
    : { contentType: type, content }
}

export function mailFolderObject(folder: MailFolderRecord, messages: readonly MessageRecord[]) {
  const inside = messages.filter((m) => m.folderId === folder.graphId)

  return {
    id: folder.graphId,
    displayName: folder.displayName,
    parentFolderId: folder.parentId ?? `${folder.owner}-msgfolderroot`,
    childFolderCount: 0,
    unreadItemCount: inside.filter((m) => !m.isRead).length,
    totalItemCount: inside.length,
    isHidden: false,
  } satisfies MailFolder
}

export function attachmentObject(attachment: MailAttachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    id: attachment.graphId,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    isInline: attachment.isInline,
    contentBytes: attachment.contentBytes,
  } satisfies FileAttachment & { "@odata.type": string }
}

export function messageObject(message: MessageRecord, preferences: Preferences) {
  const content = body(message.bodyType, message.body, preferences)
  const from = message.from && recipient(message.from)

  return {
    "@odata.etag": `W/"${message.changeKey}"`,
    id: message.graphId,
    createdDateTime: message.created_at,
    lastModifiedDateTime: message.updated_at,
    changeKey: message.changeKey,
    categories: message.categories,
    receivedDateTime: message.receivedAt,
    sentDateTime: message.sentAt,
    hasAttachments: message.attachments.length > 0,
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    bodyPreview: htmlToText(message.body).slice(0, 255),
    importance: message.importance,
    parentFolderId: message.folderId,
    conversationId: message.conversationId,
    isDeliveryReceiptRequested: false,
    isReadReceiptRequested: false,
    isRead: message.isRead,
    isDraft: message.isDraft,
    webLink: `https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(message.graphId)}&exvsurl=1&viewmodel=ReadMessageItem`,
    inferenceClassification: "focused",
    body: content,
    sender: from,
    from,
    toRecipients: message.to.map(recipient),
    ccRecipients: message.cc.map(recipient),
    bccRecipients: message.bcc.map(recipient),
    replyTo: message.replyTo.map(recipient),
    flag: { flagStatus: message.flagged ? "flagged" : "notFlagged" },
  } satisfies Message & { "@odata.etag": string }
}

export function calendarObject(calendar: CalendarRecord, owner: MicrosoftUser) {
  return {
    id: calendar.graphId,
    name: calendar.name,
    color: "auto",
    isDefaultCalendar: calendar.isDefault,
    changeKey: calendar.graphId.slice(-12),
    canShare: true,
    canViewPrivateItems: true,
    canEdit: true,
    allowedOnlineMeetingProviders: [],
    defaultOnlineMeetingProvider: "unknown",
    isTallyingResponses: true,
    isRemovable: !calendar.isDefault,
    owner: { name: owner.name, address: owner.email },
  } satisfies Calendar
}

function attendee(person: EventRecord["attendees"][number]): Attendee {
  return {
    type: person.type,
    status: { response: "none", time: "0001-01-01T00:00:00Z" },
    emailAddress: { name: person.name, address: person.address },
  }
}

/** One occurrence of an event: where a series falls on a day, or a single event itself. */
export interface Occurrence {
  readonly event: EventRecord
  readonly start: string
  readonly end: string
  /** The occurrence's own id, for an instance of a series. */
  readonly instanceId?: string
}

function eventKind(occurrence: Occurrence) {
  if (occurrence.instanceId) return "occurrence"

  return occurrence.event.recurrence ? "seriesMaster" : "singleInstance"
}

export function eventObject(
  occurrence: Occurrence,
  organizer: MicrosoftUser,
  preferences: Preferences,
) {
  const { event } = occurrence

  return {
    "@odata.etag": `W/"${event.changeKey}"`,
    id: occurrence.instanceId ?? event.graphId,
    createdDateTime: event.created_at,
    lastModifiedDateTime: event.updated_at,
    changeKey: event.changeKey,
    categories: [],
    originalStartTimeZone: event.timeZone,
    originalEndTimeZone: event.timeZone,
    iCalUId: `040000008200E00074C5B7101A82E008${Buffer.from(event.graphId).toString("hex").slice(0, 32)}`,
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
    hasAttachments: false,
    subject: event.subject,
    bodyPreview: htmlToText(event.body).slice(0, 255),
    importance: "normal",
    sensitivity: "normal",
    isAllDay: event.isAllDay,
    isCancelled: event.isCancelled,
    isOrganizer: true,
    responseRequested: true,
    seriesMasterId: occurrence.instanceId ? event.graphId : null,
    showAs: event.showAs,
    type: eventKind(occurrence),
    webLink: `https://outlook.office365.com/owa/?itemid=${encodeURIComponent(event.graphId)}&exvsurl=1&path=/calendar/item`,
    body: body(event.bodyType, event.body, preferences),
    start: {
      dateTime: formatInZone(occurrence.start, preferences.timeZone),
      timeZone: preferences.timeZone,
    },
    end: {
      dateTime: formatInZone(occurrence.end, preferences.timeZone),
      timeZone: preferences.timeZone,
    },
    location: { displayName: event.location },
    recurrence: occurrence.instanceId ? null : event.recurrence,
    attendees: event.attendees.map(attendee),
    organizer: { emailAddress: { name: organizer.name, address: organizer.email } },
  } satisfies Event & { "@odata.etag": string }
}
