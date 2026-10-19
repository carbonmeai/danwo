/** What the Novu emulator stores: its environment, subscribers, topics, workflows and messages. */

/** The environment the API key belongs to (`NOVU_API_KEY`), and how it runs code-first workflows. */
export interface NovuEnvironment {
  id: string
  organization_id: string
  /** The secret key server SDKs authorise with (`ApiKey <key>`) and bridge requests are signed with. */
  api_key: string
  /** The public identifier the Inbox starts a session with (`applicationIdentifier`). */
  application_identifier: string
  /** The app's bridge endpoint for `@novu/framework` workflows, or none. */
  bridge_url: string | null
  /** When set, the Inbox must prove the subscriber with `subscriberHash` (HMAC of its id). */
  hmac: boolean
}

/** A subscriber, as the v2 API answers for one. */
export interface NovuSubscriber {
  id: string
  subscriber_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  avatar: string | null
  locale: string | null
  timezone: string | null
  data: Record<string, unknown> | null
  /** Push and chat credentials by provider (`credentials.update`). */
  channels: {
    providerId: string
    integrationIdentifier?: string
    credentials: Record<string, unknown>
  }[]
  created: string
  updated: string
}

export interface NovuTopic {
  id: string
  key: string
  name: string | null
  /** Subscriber ids (`subscriber_id`) subscribed to it. */
  subscribers: string[]
  created: string
  updated: string
}

/** One step of a workflow defined in the dashboard rather than in code. */
export interface NovuStepTemplate {
  stepId: string
  type: NovuChannel | "delay" | "digest" | "custom"
  subject?: string
  body?: string
  data?: Record<string, unknown>
  redirectUrl?: string
}

/** A workflow defined in the dashboard (seeded); code-first workflows come from the bridge. */
export interface NovuWorkflow {
  id: string
  name: string
  tags: string[]
  steps: NovuStepTemplate[]
}

/** The channels a step delivers on. */
export type NovuChannel = "in_app" | "email" | "sms" | "push" | "chat"

/** One message a step sent: an Inbox notification, an email, a text, a push or a chat message. */
export interface NovuMessage {
  id: string
  transaction_id: string
  workflow_id: string
  step_id: string
  channel: NovuChannel
  subscriber_id: string
  subject: string | null
  content: string
  data: Record<string, unknown> | null
  redirect_url: string | null
  /** For email: who it went to. For SMS: the phone number. For push: the device tokens. */
  to: string | null
  tags: string[]
  read: boolean
  seen: boolean
  archived: boolean
  read_at: string | null
  seen_at: string | null
  archived_at: string | null
  created: string
}

/** One triggered workflow run for one subscriber, with what each step did. */
export interface NovuExecution {
  id: string
  transaction_id: string
  workflow_id: string
  subscriber_id: string
  payload: Record<string, unknown>
  /** `bridge` for code-first workflows run through the app's endpoint, `seeded` for templates. */
  source: "bridge" | "seeded"
  status: "pending" | "completed" | "failed" | "canceled"
  error: string | null
  steps: {
    stepId: string
    type: string
    status: "completed" | "skipped" | "failed"
    outputs: Record<string, unknown>
  }[]
  created: string
}

/** An Inbox session: the token a browser got for one subscriber. */
export interface NovuSession {
  id: string
  subscriber_id: string
}
