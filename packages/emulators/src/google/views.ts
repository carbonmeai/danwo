/**
 * Calendar events and Drive files as a test reads and adds them: the fields of the API's own
 * objects that tests set and check, with the API's optional and nullable fields kept as they are.
 * The emulator stores the full objects; these name what is shown of them.
 */

/** When an event starts or ends: a `date` for an all-day event, else a `dateTime`. */
export interface CalendarEventTime {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}

/** Someone invited to an event, and how they answered (`needsAction`, `accepted`, …). */
export interface CalendarAttendee {
  id?: string | null
  email?: string | null
  displayName?: string | null
  responseStatus?: string | null
  optional?: boolean | null
  organizer?: boolean | null
  self?: boolean | null
  comment?: string | null
}

/** Who made or organizes an event. */
export interface CalendarPerson {
  id?: string
  email?: string
  displayName?: string
  self?: boolean
}

/** A Calendar event as the API answers it. */
export interface CalendarEvent {
  id?: string | null
  /** `confirmed`, `tentative` or `cancelled`. */
  status?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  start?: CalendarEventTime
  end?: CalendarEventTime
  /** RRULE, EXRULE, RDATE and EXDATE lines, for a recurring event. */
  recurrence?: string[] | null
  recurringEventId?: string | null
  originalStartTime?: CalendarEventTime
  attendees?: CalendarAttendee[]
  organizer?: CalendarPerson | null
  creator?: CalendarPerson | null
  iCalUID?: string | null
  htmlLink?: string | null
  hangoutLink?: string | null
  colorId?: string | null
  eventType?: string | null
  transparency?: string | null
  visibility?: string | null
  sequence?: number | null
  created?: string | null
  updated?: string | null
  etag?: string | null
  kind?: string | null
}

/** A Drive file (or folder) as the API answers it; `size` is a decimal string of bytes. */
export interface DriveFile {
  id?: string | null
  name?: string | null
  mimeType?: string | null
  description?: string | null
  parents?: string[] | null
  size?: string | null
  md5Checksum?: string | null
  version?: string | null
  starred?: boolean | null
  trashed?: boolean | null
  explicitlyTrashed?: boolean | null
  createdTime?: string | null
  modifiedTime?: string | null
  webViewLink?: string | null
  webContentLink?: string | null
  iconLink?: string | null
  ownedByMe?: boolean | null
  shared?: boolean | null
  driveId?: string | null
  kind?: string | null
}
