/** What the API answers with, as the pages use it. */

export interface Me {
  readonly id: string
  readonly email: string
  readonly name: string | null
}

export interface WorkspaceSummary {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: string | null
  readonly ready: boolean
}

export interface Session {
  readonly me: Me
  readonly workspaces: readonly WorkspaceSummary[]
  readonly invites: readonly { readonly token: string; readonly workspace: string }[]
}

export interface Meter {
  readonly used: number
  readonly limit: number
}

export interface Integration {
  readonly provider: "slack" | "google"
  readonly status: "connected" | "needs_attention"
  readonly account: string
  readonly channel: string | null
}

export interface Workspace {
  readonly workspace: {
    readonly id: string
    readonly name: string
    readonly plan: string
    readonly status: string | null
    readonly trialEndsAt: string | null
    readonly currentPeriodEnd: string | null
    readonly hasPaymentMethod: boolean
    readonly ready: boolean
  }
  readonly role: string
  readonly members: readonly {
    readonly id: string
    readonly name: string | null
    readonly email: string
    readonly role: string
  }[]
  readonly invites: readonly { readonly email: string }[]
  readonly integrations: readonly Integration[]
  readonly usage: { readonly members: Meter; readonly notes: Meter }
}

export interface Note {
  readonly id: number
  readonly title: string
  readonly body: string
  readonly publishedAt: string | null
  readonly createdAt: string
  readonly author: string | null
  readonly authorEmail: string
}

export interface Plan {
  readonly key: string
  readonly name: string
  readonly priceCents: number
  readonly blurb: string
  readonly features: readonly string[]
}

export interface Billing {
  readonly plans: readonly Plan[]
  readonly plan: string
  readonly status: string | null
  readonly trialEndsAt: string | null
  readonly currentPeriodEnd: string | null
  readonly card: string | null
  readonly invoices: readonly {
    readonly id: string
    readonly number: string | null
    readonly status: string | null
    readonly total: number
    readonly currency: string
    readonly created: number
    readonly url: string | null
  }[]
}

export interface Invite {
  readonly workspace: { readonly id: string; readonly name: string }
  readonly email: string
  readonly accepted: boolean
  readonly forYou: boolean
}

export interface CalendarEvent {
  readonly id: string
  readonly title: string
  readonly start: string | null
}

/** A mutation's answer: what it returned, or the message to show. */
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string }
