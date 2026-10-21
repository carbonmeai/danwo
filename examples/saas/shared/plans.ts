/**
 * Relay's plans. Each is a recurring Stripe price found by its lookup key; the limits are what the
 * usage meters on the billing page count against.
 */
export interface Plan {
  readonly key: string
  readonly name: string
  readonly priceCents: number
  readonly blurb: string
  readonly members: number
  readonly notesPerMonth: number
  readonly features: readonly string[]
}

export const PLANS: readonly Plan[] = [
  {
    key: "starter_monthly",
    name: "Starter",
    priceCents: 900,
    blurb: "For a small team getting started.",
    members: 3,
    notesPerMonth: 50,
    features: ["3 members", "50 notes a month", "Slack posts"],
  },
  {
    key: "team_monthly",
    name: "Team",
    priceCents: 2900,
    blurb: "For teams that write every day.",
    members: 10,
    notesPerMonth: 500,
    features: ["10 members", "500 notes a month", "Slack and Google Calendar"],
  },
  {
    key: "business_monthly",
    name: "Business",
    priceCents: 7900,
    blurb: "For the whole company.",
    members: 50,
    notesPerMonth: 5000,
    features: ["50 members", "5,000 notes a month", "Priority support"],
  },
]

/** The plan every trial starts on. */
export const TRIAL_PLAN = "team_monthly"

/** How long a trial runs. */
export const TRIAL_DAYS = 14

/** The plan with lookup key `key`; the trial plan when it is unknown. */
export function planOf(key: string): Plan {
  return PLANS.find((plan) => plan.key === key) ?? PLANS[1]!
}

/** `2900` as `$29`. */
export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}
