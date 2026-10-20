import {
  AUTH0_HOSTS,
  auth0,
  type Auth0SeedConfig,
  BACHS_HOSTS,
  bachs,
  type BachsSeedConfig,
  connectAuth0Upstream,
  createEmulator,
  type Emulator,
  type EmulatorDefinition,
  FLUTTERWAVE_HOSTS,
  flutterwave,
  type FlutterwaveSeedConfig,
  GITHUB_HOSTS,
  github,
  type GithubSeedConfig,
  GOOGLE_HOSTS,
  google,
  type GoogleSeedConfig,
  ManualClock,
  MICROSOFT_HOSTS,
  microsoft,
  type MicrosoftSeedConfig,
  seedFlutterwave,
  PAYSTACK_HOSTS,
  paystack,
  type PaystackSeedConfig,
  seedAuth0,
  seedBachs,
  seedGithub,
  seedGoogle,
  seedMicrosoft,
  seedPaystack,
  seedSlack,
  seedTwilio,
  serveSockets,
  SLACK_HOSTS,
  type SocketServer,
  slack,
  type SlackSeedConfig,
  twilio,
  TWILIO_HOSTS,
  type TwilioSeedConfig,
} from "@danwo/emulators"
import { hostMatches, type Proxy } from "@danwo/proxy"

import {
  emulatorLifecycle,
  type Service,
  type Services,
  servicesLifecycle,
  startServices,
} from "./services.ts"

/**
 * Seed data applied on start and after every reset. A function runs each time, so it can use
 * values only known once the app is up, such as its push or notification URL.
 */
export type Seed<Config> = Config | (() => Config | undefined)

/** Options of `googleService()` and `googleEnvironment()`. */
export interface GoogleOptions {
  /** OAuth clients, users, and their Gmail, Calendar, Drive and Pub/Sub push data. */
  readonly seed?: Seed<GoogleSeedConfig>
}

/** Options of `microsoftService()` and `microsoftEnvironment()`. */
export interface MicrosoftOptions {
  /** Registrations, users, and their Outlook mail, calendar events and OneDrive files. */
  readonly seed?: Seed<MicrosoftSeedConfig>
}

/** Options of `slackService()` and `slackEnvironment()`. */
export interface SlackOptions {
  /** The team, users, channels, apps and installs; app URLs for events, commands and interactivity. */
  readonly seed?: Seed<SlackSeedConfig>
}

/** Options of `githubService()` and `githubEnvironment()`. */
export interface GithubOptions {
  /** Users, orgs, repos, OAuth and GitHub Apps, installations and repository webhooks. */
  readonly seed?: Seed<GithubSeedConfig>
}

/** Options of `paystackService()` and `paystackEnvironment()`. */
export interface PaystackOptions {
  /** Integrations (secret key, webhook and callback URLs, balance), bank accounts, customers and plans. */
  readonly seed?: Seed<PaystackSeedConfig>
}

/** Options of `twilioService()` and `twilioEnvironment()`. */
export interface TwilioOptions {
  /** Accounts, API keys, numbers (with the app's SMS URL), Verify services and unreachable phones. */
  readonly seed?: Seed<TwilioSeedConfig>
}

/** Options of `flutterwaveService()` and `flutterwaveEnvironment()`. */
export interface FlutterwaveOptions {
  /** The dashboard's webhook (the app's URL and secret hash), balances, accounts and plans. */
  readonly seed?: Seed<FlutterwaveSeedConfig>
}

/** Options of `auth0Service()` and `auth0Environment()`. */
export interface Auth0Options {
  /** Tenants with their applications, APIs, roles, organizations, users and social connections. */
  readonly seed?: Seed<Auth0SeedConfig>
  /**
   * Custom domains to answer besides `*.auth0.com` and the regional domains. A seed given as a
   * value adds its tenants' `custom_domains` on its own; list them here when the seed is a function.
   */
  readonly customDomains?: readonly string[]
  /**
   * The Google, GitHub or Microsoft services the login page's social buttons hand off to: the
   * tenant exchanges the code and reads the profile on their emulators.
   */
  readonly social?: readonly OAuthService[]
}

/** Options of `bachsService()` and `bachsEnvironment()`. */
export interface BachsOptions {
  /** Products, customers, webhook endpoints (the app's URL), balances, payout destinations. */
  readonly seed?: Seed<BachsSeedConfig>
}

export interface OAuthService extends Service {
  readonly emulator: Emulator
  /** The emulator's clock; push deliveries and their retries run on it. */
  readonly clock: ManualClock
}

/** A Google, Microsoft, Slack or GitHub emulator behind its own danwo proxy. */
export interface OAuthEnvironment<Name extends string> {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** Its push notifications, by service name, for `danwo matrix` to fault. */
  readonly webhooks: Services["webhooks"]
  /** Where the mail it sends lands, for the `mail` fixture (Clerk's codes). */
  readonly mail?: Services["mail"]
  /** Plays every pending push notification and retry to the end. */
  readonly settle: () => Promise<void>
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  readonly travel: (ms: number) => Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Keeps the emulator's state now (right after a reset), for `restore`. */
  snapshot(slot?: string): Promise<void>
  /** Emulator back to the kept state, faster than a reset; proxy log and fault rules cleared. */
  restore(slot?: string): Promise<void>
  /** Whether `snapshot` and `restore` keep a state per slot. */
  readonly snapshotSlots: boolean
  /** Fixtures for tests: the emulator under `Name` (`google`, `microsoft`), `proxy`, `settle`. */
  readonly fixtures: { readonly proxy: Proxy; readonly settle: () => Promise<void> } & {
    readonly [K in Name]: Emulator
  }
  close(): Promise<void>
}

/** What `googleEnvironment()` starts: the Google emulator behind its own proxy. */
export type GoogleEnvironment = OAuthEnvironment<"google">
/** What `microsoftEnvironment()` starts: the Microsoft emulator behind its own proxy. */
export type MicrosoftEnvironment = OAuthEnvironment<"microsoft">
/** What `slackEnvironment()` starts: the Slack emulator behind its own proxy. */
export type SlackEnvironment = OAuthEnvironment<"slack">
/** What `githubEnvironment()` starts: the GitHub emulator behind its own proxy. */
export type GithubEnvironment = OAuthEnvironment<"github">
/** What `paystackEnvironment()` starts: the Paystack emulator behind its own proxy. */
export type PaystackEnvironment = OAuthEnvironment<"paystack">
/** What `auth0Environment()` starts: the Auth0 emulator behind its own proxy. */
export type Auth0Environment = OAuthEnvironment<"auth0">
/** What `bachsEnvironment()` starts: the Bachs emulator behind its own proxy. */
export type BachsEnvironment = OAuthEnvironment<"bachs">
/** What `twilioEnvironment()` starts: the Twilio emulator behind its own proxy. */
export type TwilioEnvironment = OAuthEnvironment<"twilio">
/** What `flutterwaveEnvironment()` starts: the Flutterwave emulator behind its own proxy. */
export type FlutterwaveEnvironment = OAuthEnvironment<"flutterwave">

/** A provider's emulator, the hosts it answers and how a seed is applied to it. */
export interface Provider<Config> {
  readonly name: string
  readonly definition: EmulatorDefinition
  readonly hosts: readonly string[]
  readonly apply: (emulator: Emulator, config: Config) => void
}

/** Whether a seed is given as a function to run on every apply. */
function isDeferred<Config>(seed: Seed<Config>): seed is () => Config | undefined {
  return typeof seed === "function"
}

/** The seed's config right now: the value itself, or what its function returns. */
function seedNow<Config>(seed: Seed<Config> | undefined): Config | undefined {
  if (seed === undefined) return undefined

  return isDeferred(seed) ? seed() : seed
}

/**
 * A provider's emulator for `startServices`. It answers the provider's real hosts for the app's
 * server calls and the browser's sign-in or consent page alike (the browser goes through the same
 * proxy). Its pushes, events and webhooks go out on a manual clock, so `settle` plays them to the
 * end and `danwo matrix` can fault them.
 */
export function oauthService<Config>(
  provider: Provider<Config>,
  seed: Seed<Config> | undefined,
): OAuthService {
  const clock = new ManualClock(new Date())
  const emulator = createEmulator(provider.definition, {
    clock: clock.clock,
    timer: clock.timer,
    wallClock: clock.wall,
  })

  const apply = () => {
    const config = seedNow(seed)

    if (config) provider.apply(emulator, config)
  }

  apply()

  const lifecycle = emulatorLifecycle(emulator, clock, apply)
  const { connect } = emulator
  let sockets: SocketServer | undefined

  return {
    name: provider.name,
    emulator,
    clock,
    /* An emulator that answers WebSockets gets them on a local port the proxy sends upgrades to. */
    get routes() {
      return [
        {
          hosts: provider.hosts,
          handler: emulator.fetch,
          ...(sockets && { webSocket: sockets.url }),
        },
      ]
    },
    ...(connect && {
      async start() {
        sockets ??= await serveSockets(connect)
      },
    }),
    fixtures: { [provider.name]: emulator },
    webhooks: emulator.webhooks,
    ...lifecycle,
    async close() {
      await sockets?.close()
      await lifecycle.close()
    },
  }
}

/**
 * A provider's service started on its own proxy, with its emulator under `name` in the fixtures.
 * `backends` are the services it acts on (Google, Slack and the like), started behind the same
 * proxy with their own fixtures alongside.
 */
export async function oauthEnvironment<Name extends string>(
  name: Name,
  service: OAuthService,
  options: { readonly unmatched?: "passthrough" | "block" },
  backends: readonly Service[] = [],
): Promise<OAuthEnvironment<Name>> {
  const services = await startServices([...backends, service], options)
  const { proxy } = services
  const lifecycle = servicesLifecycle(services)
  const { settle } = lifecycle
  const own = backends.length === 0 ? {} : services.fixtures
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mapped key is `name` itself, which TypeScript can't see through a computed property
  const fixtures = {
    ...own,
    [name]: service.emulator,
    proxy,
    settle,
  } as OAuthEnvironment<Name>["fixtures"]

  return {
    emulator: service.emulator,
    proxy,
    webhooks: services.webhooks,
    ...(services.mail && { mail: services.mail }),
    ...lifecycle,
    fixtures,
  }
}

const GOOGLE: Provider<GoogleSeedConfig> = {
  name: "google",
  definition: google,
  hosts: GOOGLE_HOSTS,
  apply: (emulator, config) => seedGoogle(emulator.store, config),
}

const MICROSOFT: Provider<MicrosoftSeedConfig> = {
  name: "microsoft",
  definition: microsoft,
  hosts: MICROSOFT_HOSTS,
  apply: (emulator, config) => seedMicrosoft(emulator, config),
}

const SLACK: Provider<SlackSeedConfig> = {
  name: "slack",
  definition: slack,
  hosts: SLACK_HOSTS,
  apply: (emulator, config) => seedSlack(emulator.store, config),
}

const GITHUB: Provider<GithubSeedConfig> = {
  name: "github",
  definition: github,
  hosts: GITHUB_HOSTS,
  apply: (emulator, config) => seedGithub(emulator.store, config),
}

/** Google for `startServices`: sign-in, Gmail, Calendar and Drive on Google's real hosts; gives tests the `google` fixture. */
export function googleService(options: GoogleOptions = {}): OAuthService {
  return oauthService(GOOGLE, options.seed)
}

/** Microsoft for `startServices`: sign-in and Graph mail, calendar, OneDrive and subscriptions; gives tests the `microsoft` fixture. */
export function microsoftService(options: MicrosoftOptions = {}): OAuthService {
  return oauthService(MICROSOFT, options.seed)
}

/** A worker-scoped Google emulator behind its own proxy; combine services with `startServices`. */
export function googleEnvironment(
  options: GoogleOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<GoogleEnvironment> {
  return oauthEnvironment("google", googleService(options), options)
}

/** A worker-scoped Microsoft emulator behind its own proxy; combine services with `startServices`. */
export function microsoftEnvironment(
  options: MicrosoftOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<MicrosoftEnvironment> {
  return oauthEnvironment("microsoft", microsoftService(options), options)
}

/** Slack for `startServices`: OAuth installs, the Web API, incoming webhooks and signed events; gives tests the `slack` fixture. */
export function slackService(options: SlackOptions = {}): OAuthService {
  return oauthService(SLACK, options.seed)
}

/** GitHub for `startServices`: sign-in, GitHub Apps, the REST API and signed webhooks; gives tests the `github` fixture. */
export function githubService(options: GithubOptions = {}): OAuthService {
  return oauthService(GITHUB, options.seed)
}

/** A worker-scoped Slack emulator behind its own proxy; combine services with `startServices`. */
export function slackEnvironment(
  options: SlackOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<SlackEnvironment> {
  return oauthEnvironment("slack", slackService(options), options)
}

/** A worker-scoped GitHub emulator behind its own proxy; combine services with `startServices`. */
export function githubEnvironment(
  options: GithubOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<GithubEnvironment> {
  return oauthEnvironment("github", githubService(options), options)
}

const TWILIO: Provider<TwilioSeedConfig> = {
  name: "twilio",
  definition: twilio,
  hosts: TWILIO_HOSTS,
  apply: (emulator, config) => seedTwilio(emulator.store, config),
}

/**
 * Twilio for `startServices`: messages with status callbacks, texts to the app's numbers and Verify,
 * with message statuses moving on a manual clock that `settle` plays to the end; gives tests the
 * `twilio` fixture. Read texts and codes with `twilioInbox(twilio)`, or with `twilioSms(twilio)`
 * as a session's message source.
 */
export function twilioService(options: TwilioOptions = {}): OAuthService {
  return oauthService(TWILIO, options.seed)
}

/** A worker-scoped Twilio emulator behind its own proxy; combine services with `startServices`. */
export function twilioEnvironment(
  options: TwilioOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<TwilioEnvironment> {
  return oauthEnvironment("twilio", twilioService(options), options)
}

const FLUTTERWAVE: Provider<FlutterwaveSeedConfig> = {
  name: "flutterwave",
  definition: flutterwave,
  hosts: FLUTTERWAVE_HOSTS,
  apply: (emulator, config) => seedFlutterwave(emulator.store, config),
}

/**
 * Flutterwave for `startServices`: Standard payment links with their hosted checkout (the browser
 * pays on `checkout.flutterwave.com` through the same proxy), verification, refunds, plans and
 * subscriptions, transfers and virtual accounts, with webhooks and transfer settlements on a manual
 * clock that `settle` plays to the end; gives tests the `flutterwave` fixture. Read the books with
 * `flutterwaveLedger(flutterwave)`.
 */
export function flutterwaveService(options: FlutterwaveOptions = {}): OAuthService {
  return oauthService(FLUTTERWAVE, options.seed)
}

/** A worker-scoped Flutterwave emulator behind its own proxy; combine services with `startServices`. */
export function flutterwaveEnvironment(
  options: FlutterwaveOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<FlutterwaveEnvironment> {
  return oauthEnvironment("flutterwave", flutterwaveService(options), options)
}

const PAYSTACK: Provider<PaystackSeedConfig> = {
  name: "paystack",
  definition: paystack,
  hosts: PAYSTACK_HOSTS,
  apply: (emulator, config) => seedPaystack(emulator.store, config),
}

/**
 * Paystack for `startServices`: the API and the hosted payment page the customer's browser opens,
 * with events, transfers, refunds and subscription renewals on a manual clock that `settle` plays
 * to the end; gives tests the `paystack` fixture. Read what was paid with `paystackLedger(paystack)`.
 */
export function paystackService(options: PaystackOptions = {}): OAuthService {
  return oauthService(PAYSTACK, options.seed)
}

/** A worker-scoped Paystack emulator behind its own proxy; combine services with `startServices`. */
export function paystackEnvironment(
  options: PaystackOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<PaystackEnvironment> {
  return oauthEnvironment("paystack", paystackService(options), options)
}

const BACHS: Provider<BachsSeedConfig> = {
  name: "bachs",
  definition: bachs,
  hosts: BACHS_HOSTS,
  apply: (emulator, config) => seedBachs(emulator.store, config),
}

/**
 * Bachs for `startServices`: the API on its live and sandbox hosts, the hosted checkout, overlay
 * script, recovery page and customer portal, with payments settling, subscriptions renewing and
 * payouts completing on a manual clock that `settle` plays to the end; gives tests the `bachs`
 * fixture. Read what happened with `bachsLedger(bachs)`.
 */
export function bachsService(options: BachsOptions = {}): OAuthService {
  return oauthService(BACHS, options.seed)
}

/** A worker-scoped Bachs emulator behind its own proxy; combine services with `startServices`. */
export function bachsEnvironment(
  options: BachsOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<BachsEnvironment> {
  return oauthEnvironment("bachs", bachsService(options), options)
}

/** The custom domains a seed's tenants answer on, when the seed is a value. */
function customDomainsOf(seed: Seed<Auth0SeedConfig> | undefined): string[] {
  if (seed === undefined || isDeferred(seed)) return []

  return (seed.tenants ?? []).flatMap((tenant) => tenant.custom_domains ?? [])
}

/** Sends a tenant's call to a social provider to whichever of `services` answers its host. */
function socialUpstream(services: readonly OAuthService[]) {
  return async (request: Request): Promise<Response> => {
    const host = new URL(request.url).hostname
    const route = services
      .flatMap((service) => service.routes)
      .find((found) => found.hosts.some((pattern) => hostMatches(pattern, host)))

    if (route && "handler" in route) return route.handler(request)

    return new Response(`no social service answers ${host}`, { status: 502 })
  }
}

/**
 * Auth0 for `startServices`: Universal Login (the browser logs in, signs up and passes MFA on the
 * tenant's domain through the same proxy), the authentication API's grants, OIDC discovery and
 * keys, logout and the Management API v2; gives tests the `auth0` fixture. Read users, logins and
 * verification emails with `auth0Tenant(auth0)`.
 */
export function auth0Service(options: Auth0Options = {}): OAuthService {
  const service = oauthService(
    {
      name: "auth0",
      definition: auth0,
      hosts: [...AUTH0_HOSTS, ...(options.customDomains ?? []), ...customDomainsOf(options.seed)],
      apply: (emulator, config) => seedAuth0(emulator.store, config),
    },
    options.seed,
  )

  if (options.social?.length) connectAuth0Upstream(service.emulator, socialUpstream(options.social))

  return service
}

/** A worker-scoped Auth0 emulator behind its own proxy; combine services with `startServices`. */
export function auth0Environment(
  options: Auth0Options & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<Auth0Environment> {
  return oauthEnvironment("auth0", auth0Service(options), options)
}
