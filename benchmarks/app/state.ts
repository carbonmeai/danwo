/**
 * Everything the benchmark app remembers, in memory. `/__state` serves it as the ground truth the
 * benchmark's tests judge against, and `/__test/reset` puts it back to how it starts.
 */

export interface Order {
  readonly id: string
  readonly seats: number
  /** Cents. */
  readonly amount: number
  status: "pending" | "paid"
  /** How the order came to be paid: the provider's signed event, or the browser coming back. */
  paidBy: "webhook" | "redirect" | null
  sessionId: string | null
}

export interface Project {
  readonly id: string
  readonly name: string
}

export interface AppState {
  readonly accounts: { email: string; verified: boolean }[]
  /** Codes mailed for sign-up, by email. */
  readonly codes: Map<string, string>
  settings: { name: string; email: string; age: number }
  projects: Project[]
  readonly uploads: { name: string; bytes: number }[]
  subscribers: string[]
  approved: boolean
  notified: number
  readonly orders: Order[]
  credits: number
  /** Provider event ids already handled, so a delivery sent twice is handled once. */
  readonly events: Set<string>
  /** Error messages the app showed to a user, as rendered. */
  readonly errorsShown: string[]
}

const PROJECTS: readonly Project[] = [
  { id: "p1", name: "Atlas" },
  { id: "p2", name: "Borealis" },
  { id: "p3", name: "Cirrus" },
]

export function freshState(): AppState {
  return {
    accounts: [],
    codes: new Map(),
    settings: { name: "Ada Lovelace", email: "ada@bench.test", age: 36 },
    projects: [...PROJECTS],
    uploads: [],
    subscribers: [],
    approved: false,
    notified: 0,
    orders: [],
    credits: 0,
    events: new Set(),
    errorsShown: [],
  }
}

/** What `/__state` answers: the state as plain JSON. */
export function stateJson(state: AppState): string {
  return JSON.stringify({
    ...state,
    codes: Object.fromEntries(state.codes),
    events: [...state.events],
  })
}

/** The products the table page lists: 30 of them, the same every run. */
export const PRODUCTS = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1

  return {
    id: n,
    name: `Product ${String(n).padStart(2, "0")}`,
    category: ["Hardware", "Software", "Services"][n % 3] ?? "Hardware",
    price: ((n * 37) % 90) + 10,
  }
})
