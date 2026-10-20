/**
 * Nylas v3 objects as the API returns them (snake_case, Unix-second times). The SDK turns them
 * into camelCase on its side; raw HTTP callers see them as they are here.
 */

/** A participant of a message or an event, or a contact's email. */
export interface NylasEmailName {
  email: string
  name?: string
}

/** The provider a grant authenticates against. */
export type NylasProvider =
  | "google"
  | "microsoft"
  | "imap"
  | "icloud"
  | "yahoo"
  | "ews"
  | "virtual-calendar"

export interface NylasGrant {
  id: string
  provider: NylasProvider
  grant_status: "valid" | "invalid"
  email: string
  name: string | null
  scope: string[]
  user_agent: string | null
  ip: string | null
  state: string | null
  provider_user_id: string
  /** The connector credential the grant was made with. */
  credential_id: string
  blocked: boolean
  settings: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface NylasFolder {
  id: string
  grant_id: string
  object: "folder"
  name: string
  system_folder: boolean
  attributes: string[]
  parent_id: string | null
  background_color: string | null
  text_color: string | null
  total_count: number
  unread_count: number
}

export interface NylasAttachment {
  id: string
  grant_id: string
  filename: string
  content_type: string
  size: number
  is_inline: boolean
  content_id?: string
}

export interface NylasMessage {
  id: string
  grant_id: string
  object: "message"
  thread_id: string
  subject: string
  snippet: string
  body: string
  from: NylasEmailName[]
  to: NylasEmailName[]
  cc: NylasEmailName[]
  bcc: NylasEmailName[]
  reply_to: NylasEmailName[]
  date: number
  unread: boolean
  starred: boolean
  folders: string[]
  attachments: NylasAttachment[]
  headers?: { name: string; value: string }[]
  metadata: Record<string, string>
  created_at: number
}

export interface NylasThread {
  id: string
  grant_id: string
  object: "thread"
  subject: string
  snippet: string
  participants: NylasEmailName[]
  message_ids: string[]
  draft_ids: string[]
  folders: string[]
  has_attachments: boolean
  has_drafts: boolean
  starred: boolean
  unread: boolean
  earliest_message_date: number
  latest_message_received_date: number | null
  latest_message_sent_date: number | null
  latest_draft_or_message: NylasMessage | null
}

export interface NylasDraft extends Omit<NylasMessage, "object"> {
  object: "draft"
}

export interface NylasCalendar {
  id: string
  grant_id: string
  object: "calendar"
  name: string
  description: string | null
  location: string | null
  timezone: string
  is_primary: boolean
  is_owned_by_user: boolean
  read_only: boolean
  hex_color: string
  metadata: Record<string, string>
}

/** When an event happens: a span of time, or a whole day. */
export type NylasWhen =
  | {
      object: "timespan"
      start_time: number
      end_time: number
      start_timezone?: string
      end_timezone?: string
    }
  | { object: "date"; date: string }
  | { object: "datespan"; start_date: string; end_date: string }

export interface NylasParticipant extends NylasEmailName {
  status: "yes" | "no" | "maybe" | "noreply"
  comment?: string
}

export interface NylasEvent {
  id: string
  grant_id: string
  calendar_id: string
  object: "event"
  title: string
  description: string | null
  location: string | null
  when: NylasWhen
  participants: NylasParticipant[]
  organizer: NylasEmailName
  busy: boolean
  status: "confirmed" | "tentative" | "cancelled"
  visibility: "default" | "public" | "private"
  conferencing?: Record<string, unknown>
  reminders?: Record<string, unknown>
  recurrence?: string[]
  metadata: Record<string, string>
  html_link: string
  read_only: boolean
  hide_participants: boolean
  ical_uid: string
  created_at: number
  updated_at: number
}

export interface NylasContact {
  id: string
  grant_id: string
  object: "contact"
  given_name: string | null
  middle_name: string | null
  surname: string | null
  nickname: string | null
  company_name: string | null
  job_title: string | null
  notes: string | null
  birthday: string | null
  emails: { email: string; type?: string }[]
  phone_numbers: { number: string; type?: string }[]
  web_pages: { url: string; type?: string }[]
  im_addresses: { im_address: string; type?: string }[]
  physical_addresses: Record<string, unknown>[]
  groups: { id: string }[]
  picture_url: string | null
  source: "address_book" | "inbox" | "domain"
}

/** A scheduler configuration: whose calendars to book, how long, and when. */
export interface NylasConfiguration {
  id: string
  grant_id: string
  name: string
  slug: string | null
  requires_session_auth: boolean
  participants: {
    email: string
    name?: string
    is_organizer?: boolean
    availability?: { calendar_ids?: string[] }
    booking?: { calendar_id?: string }
  }[]
  availability: {
    duration_minutes: number
    interval_minutes?: number
    availability_rules?: Record<string, unknown>
  }
  event_booking: { title: string; description?: string; location?: string; timezone?: string }
  scheduler: Record<string, unknown>
  appearance?: Record<string, unknown>
}

export interface NylasBooking {
  booking_id: string
  configuration_id: string
  event_id: string
  calendar_id: string
  grant_id: string
  title: string
  description: string | null
  start_time: number
  end_time: number
  organizer: NylasEmailName
  guest: NylasEmailName
  additional_guests: NylasEmailName[]
  status: "booked" | "pending" | "cancelled"
}

export interface NylasWebhook {
  id: string
  description: string | null
  trigger_types: string[]
  webhook_url: string
  webhook_secret: string
  status: "active" | "inactive" | "failing" | "failed" | "pause"
  notification_email_addresses: string[]
  status_updated_at: number
  created_at: number
  updated_at: number
}

/** A code the hosted auth page handed back, waiting to be exchanged for a grant's token. */
export interface NylasCode {
  id: string
  grant_id: string
  client_id: string
  redirect_uri: string
  challenge: string | null
  challenge_method: string | null
  used: boolean
}

/** An access or refresh token handed out for a grant. */
export interface NylasToken {
  id: string
  grant_id: string
  kind: "access" | "refresh" | "id"
  expires_at: number
}
