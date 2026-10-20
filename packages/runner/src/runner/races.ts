/**
 * Race faults from the browser's side of a matrix trial. The clean trial watches the test's
 * browser for the app requests that change something and for each return to the app from another
 * site; those become planned races. A faulted trial routes the app's requests to set its race up:
 * the planned request sent twice at once, or the browser held on its way back to the app until
 * the provider's webhooks have landed.
 */
import { setTimeout as sleep } from "node:timers/promises"

import {
  appRoute,
  deliveriesOf,
  type PlannedFault,
  type RaceCall,
  type RaceEvidence,
  type RacePlanOptions,
  type RaceReturn,
  routeOf,
  type RunWebhooks,
} from "@danwo/matrix"
import type { Proxy } from "@danwo/proxy"
import type { BrowserContext, Request, Route } from "playwright-core"

import { movesStripeMoney } from "../lint/rules/stripe.ts"
import { providerOfHost } from "../lint/subject.ts"
import type { CatalogEntry } from "./catalog.ts"
import type { DanwoConfig, RaceSettings } from "./config.ts"

/** How long `slow-then-retry` holds a call by default: past most apps' own short timeouts. */
const SLOW_MS = 3_000

/** How long a held redirect waits for the provider's webhooks before it goes on anyway. */
const WEBHOOK_WAIT_MS = 3_000

/** Methods that only read: a page sending them twice changes nothing. */
const READS = new Set(["GET", "HEAD", "OPTIONS"])

/** Providers where a second create made by a retry costs a customer money. */
const PAYMENT_PROVIDERS = new Set(["paystack", "flutterwave", "bachs"])

/** A call whose duplicate moves money twice: a payment provider's create, sent by the app's server. */
function paymentCreate(call: RaceCall): boolean {
  if (call.client !== "server" || call.method !== "POST") return false
  if (call.host === "api.stripe.com") return movesStripeMoney(call)

  return PAYMENT_PROVIDERS.has(providerOfHost(call.host) ?? "")
}

/** The config's race settings, with every race on unless it says otherwise. */
function raceSwitches(races: RaceSettings): Required<Omit<RaceSettings, "slowThenRetry">> {
  return {
    doubleSubmit: races.doubleSubmit !== false,
    beforeRedirect: races.beforeRedirect !== false,
    webhookOrder: races.webhookOrder !== false,
  }
}

/** `slow-then-retry` as the planner takes it, unless the config turned it off. */
function slowSetting(races: RaceSettings): Pick<RacePlanOptions, "slowThenRetry"> {
  const slow = races.slowThenRetry

  return slow === false
    ? {}
    : { slowThenRetry: { ms: slow?.ms ?? SLOW_MS, applies: paymentCreate } }
}

/** The races a matrix plans for `test`, from the config and what the clean trial showed. */
export function racePlan(
  matrix: DanwoConfig["matrix"],
  test: CatalogEntry,
  evidence: RaceEvidence | undefined,
): RacePlanOptions {
  const races = matrix?.races
  const users = test.concurrent === undefined ? {} : { users: test.concurrent }

  if (races === false)
    return { ...users, doubleSubmit: false, beforeRedirect: false, webhookOrder: false }

  return { ...users, evidence, ...raceSwitches(races ?? {}), ...slowSetting(races ?? {}) }
}

/** The origin of a URL, or undefined when it is not one a browser loads pages from. */
function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** A main-frame navigation to the app, coming back from another site. */
function returnFrom(request: Request, app: string): RaceReturn | undefined {
  try {
    const frame = request.frame()

    if (!request.isNavigationRequest() || frame.parentFrame() !== null) return undefined
    if (originOf(request.url()) !== app) return undefined

    const hop = request.redirectedFrom()

    if (hop !== null && originOf(hop.url()) !== app) {
      const url = new URL(hop.url())

      return {
        site: url.host,
        via: routeOf({ method: hop.method(), host: url.host, path: url.pathname }),
      }
    }

    const from = originOf(frame.url())

    return from !== undefined && from !== app ? { site: new URL(from).host } : undefined
  } catch {
    return undefined
  }
}

/** A change-making request to the app, as the matrix names it (`POST /checkout`). */
function submitOf(request: Request, app: string): string | undefined {
  if (READS.has(request.method()) || originOf(request.url()) !== app) return undefined

  return appRoute(request.method(), new URL(request.url()).pathname)
}

/** What a trial sets up in its browser, and what it learned there. */
export interface TrialRace {
  /** Given to the trial's attempt: called with its browser context. */
  readonly onContext: (context: BrowserContext) => Promise<void>
  /** The clean trial's evidence, or a faulted trial's whether-it-fired and notes. */
  report(): { readonly races?: RaceEvidence; readonly fired?: boolean; readonly notes: string[] }
}

/** Watches the clean trial's browser for the requests and returns races can be planned on. */
function watchRaces(app: string): TrialRace {
  const submits: string[] = []
  const returns: RaceReturn[] = []

  return {
    onContext: async (context) => {
      context.on("request", (request) => {
        const back = returnFrom(request, app)
        const submit = submitOf(request, app)

        if (back !== undefined) returns.push(back)
        if (submit !== undefined) submits.push(submit)
      })
    },
    report: () => ({ races: { submits, returns }, notes: [] }),
  }
}

/** Routes every request the browser makes to the app through `handle`. */
function routeApp(
  app: string,
  handle: (route: Route) => Promise<void>,
): (context: BrowserContext) => Promise<void> {
  return async (context) => {
    await context.route((url) => url.origin === app, handle)
  }
}

/** Sends the routed request twice at once: the browser gets the first answer, the twin is dropped. */
async function sendTwice(route: Route): Promise<string> {
  const twin = route.fetch({ maxRedirects: 0 }).then(
    (response) => String(response.status()),
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  const response = await route.fetch({ maxRedirects: 0 })

  await route.fulfill({ response })

  return `sent twice at once: ${response.status()} and ${await twin}`
}

/** The page race: the planned app request sent twice at once. */
function doubleSubmit(fault: Extract<PlannedFault, { target: "page" }>, app: string): TrialRace {
  const notes: string[] = []
  let seen = 0
  let fired = false

  const handle = async (route: Route) => {
    const request = route.request()
    const hit = submitOf(request, app) === fault.route && seen++ === fault.occurrence

    if (!hit) return route.continue()

    try {
      notes.push(`${fault.route} ${await sendTwice(route)}`)
      fired = true
    } catch (error) {
      notes.push(`could not send ${fault.route} twice: ${String(error)}`)
      await route.continue().catch(() => undefined)
    }
  }

  return {
    onContext: routeApp(app, handle),
    report: () => ({ fired, notes }),
  }
}

/** Counts every delivery attempt so far, across the environment's webhook senders. */
function deliveryCount(webhooks: RunWebhooks | undefined): number {
  return deliveriesOf(webhooks).length
}

/** Delivers what the provider has queued, waiting up to `WEBHOOK_WAIT_MS` for one to land. */
async function deliverPending(
  settle: (() => Promise<unknown>) | undefined,
  webhooks: RunWebhooks | undefined,
): Promise<number> {
  const before = deliveryCount(webhooks)
  const until = Date.now() + WEBHOOK_WAIT_MS

  do {
    await settle?.()
    if (deliveryCount(webhooks) > before) break
    await sleep(100)
  } while (Date.now() < until)

  return deliveryCount(webhooks) - before
}

/** Whether a redirect from `host` to `location` lands on the app. */
function redirectsTo(location: string, host: string, app: string): boolean {
  return originOf(new URL(location, `https://${host}`).href) === app
}

/** What a redirect race needs of the trial's environment. */
interface Backend {
  readonly proxy: Proxy
  readonly settle?: (() => Promise<void | readonly string[]>) | undefined
  readonly webhooks?: RunWebhooks | undefined
}

/**
 * The redirect race: the browser kept from landing back on the app until the provider's webhooks
 * were delivered. A redirect answer is held at the proxy, after the provider processed the call
 * (so its webhook is queued); a link the browser follows is held in the browser.
 */
function beforeRedirect(
  fault: Extract<PlannedFault, { target: "redirect" }>,
  app: string,
  backend: Backend,
): TrialRace {
  const notes: string[] = []
  let fired = false

  const deliverFirst = async (site: string) => {
    const delivered = await deliverPending(backend.settle, backend.webhooks)

    fired = delivered > 0
    notes.push(
      fired
        ? `held the return from ${site} until ${delivered} webhook ${delivered === 1 ? "delivery" : "deliveries"} landed`
        : `held the return from ${site}, but no webhook was waiting to be delivered`,
    )
  }

  const { via } = fault

  if (via !== undefined) {
    const [method, rest = ""] = via.route.split(" ")
    const host = rest.split("/")[0]
    let returns = 0

    backend.proxy.setFault((call) =>
      call.method === method && call.host === host
        ? {
            kind: "hold",
            until: async (answer) => {
              const back = answer.location !== undefined && redirectsTo(answer.location, host, app)

              if (back && returns++ === via.occurrence) await deliverFirst(host)
            },
          }
        : undefined,
    )

    return { onContext: async () => {}, report: () => ({ fired, notes }) }
  }

  let seen = 0

  const handle = async (route: Route) => {
    const back = returnFrom(route.request(), app)

    if (back !== undefined && seen++ === fault.occurrence) await deliverFirst(back.site)

    await route.continue()
  }

  return { onContext: routeApp(app, handle), report: () => ({ fired, notes }) }
}

/**
 * What a trial does in its browser: the clean trial watches, a page or redirect race routes the
 * app's requests, and every other fault leaves the browser alone.
 */
export function trialRace(
  fault: PlannedFault | null,
  baseUrl: string | undefined,
  backend: Backend,
): TrialRace | undefined {
  const app = baseUrl === undefined ? undefined : originOf(baseUrl)

  if (app === undefined) return undefined
  if (fault === null) return watchRaces(app)
  if (fault.target === "page") return doubleSubmit(fault, app)
  if (fault.target === "redirect") return beforeRedirect(fault, app, backend)

  return undefined
}
