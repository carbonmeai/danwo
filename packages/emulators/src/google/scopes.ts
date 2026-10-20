/**
 * Which OAuth scopes each kind of Gmail, Calendar and Drive call accepts, as Google documents them
 * per method. A token needs at least one of a call's scopes.
 */

const AUTH = "https://www.googleapis.com/auth/"
const FULL_MAIL = "https://mail.google.com/"

const gmail = (...names: string[]) => [FULL_MAIL, ...names.map((name) => `${AUTH}gmail.${name}`)]
const calendar = (...names: string[]) => names.map((name) => `${AUTH}${name}`)
const drive = (...names: string[]) => names.map((name) => `${AUTH}${name}`)

export const SCOPES = {
  gmailRead: gmail("readonly", "modify"),
  gmailSend: gmail("send", "compose", "modify"),
  gmailInsert: gmail("insert", "modify"),
  gmailModify: gmail("modify"),
  gmailLabels: gmail("labels", "modify"),
  gmailCompose: gmail("compose", "modify"),
  gmailDelete: [FULL_MAIL],
  gmailWatch: gmail("readonly", "modify", "metadata"),
  calendarRead: calendar(
    "calendar",
    "calendar.readonly",
    "calendar.events",
    "calendar.events.readonly",
  ),
  calendarWrite: calendar("calendar", "calendar.events"),
  calendarManage: calendar("calendar"),
  /** The calendar list: a token for events alone cannot list the calendars it may use. */
  calendarList: calendar(
    "calendar",
    "calendar.calendarlist",
    "calendar.calendarlist.readonly",
    "calendar.readonly",
  ),
  calendarFreeBusy: calendar("calendar", "calendar.readonly", "calendar.freebusy"),
  driveRead: drive("drive", "drive.readonly", "drive.file", "drive.metadata.readonly"),
  driveContent: drive("drive", "drive.readonly", "drive.file"),
  driveWrite: drive("drive", "drive.file"),
} as const

const WHOLE_DRIVE = new Set(drive("drive", "drive.readonly", "drive.metadata.readonly"))

/** Whether the only Drive access a token has is to files the app itself created. */
export function driveFileOnly(scope: readonly string[]): boolean {
  return !scope.some((granted) => WHOLE_DRIVE.has(granted))
}
