/**
 * Realtime providers as services: Pusher (Channels and Beams), Novu (notifications and its
 * Inbox) and Tiptap Cloud collaboration. Each answers its real hosts for the app's server calls
 * and the browser's sockets alike: the proxy sends WebSocket upgrades to a local port the
 * emulator serves, so `pusher-js`, Novu's Inbox and Tiptap's provider connect unchanged.
 */
import {
  connectNovuEmail,
  type Emulator,
  NOVU_HOSTS,
  novu,
  novuProject,
  type NovuSeedConfig,
  PUSHER_HOSTS,
  pusher,
  type PusherSeedConfig,
  seedNovu,
  seedPusher,
  seedTiptap,
  TIPTAP_HOSTS,
  tiptap,
  type TiptapSeedConfig,
} from "@danwo/emulators"

import {
  type OAuthEnvironment,
  oauthEnvironment,
  type OAuthService,
  oauthService,
  type Seed,
} from "./oauth.ts"

/** Options of `pusherService()` and `pusherEnvironment()`. */
export interface PusherOptions {
  /** The app (id, key, secret, cluster) the app's env holds, its webhooks, and Beams instances. */
  readonly seed?: Seed<PusherSeedConfig>
}

/** Options of `novuService()` and `novuEnvironment()`. */
export interface NovuOptions {
  /** The API key and application identifier, the app's bridge URL, subscribers and workflows. */
  readonly seed?: Seed<NovuSeedConfig>
  /** A Resend service to send the workflows' emails through, so they land in its inbox. */
  readonly email?: OAuthService
}

/** Options of `tiptapService()` and `tiptapEnvironment()`. */
export interface TiptapOptions {
  /** Collaboration apps (id, token secret, API key) and documents to start with. */
  readonly seed?: Seed<TiptapSeedConfig>
}

/**
 * Pusher for `startServices`: the Channels API the app's server triggers events on, the socket
 * `pusher-js` connects to from the browser, signed webhooks and Beams; gives tests the `pusher`
 * fixture. Read what was published and who it reached with `pusherChannels(pusher)`.
 */
export function pusherService(options: PusherOptions = {}): OAuthService {
  return oauthService(
    {
      name: "pusher",
      definition: pusher,
      hosts: PUSHER_HOSTS,
      apply: (emulator, config) => seedPusher(emulator.store, config),
    },
    options.seed,
  )
}

/** Plays the workflow runs a trigger started to the end, then the usual pending deliveries. */
function settledWithRuns(service: OAuthService, emulator: Emulator): OAuthService {
  const settle = service.settle?.bind(service)

  return Object.assign(service, {
    async settle() {
      const project = novuProject(emulator)
      /* Runs already over before the wait are not what it waited for. */
      const before = new Set(
        project
          .executions()
          .filter((run) => run.status !== "pending")
          .map((run) => run.id),
      )

      await project.idle()

      const runs = project
        .executions()
        .filter((run) => !before.has(run.id))
        .map((run) => `workflow ${run.workflow_id} ${run.status}`)

      return [...runs, ...((await settle?.()) ?? [])]
    },
  })
}

/**
 * Novu for `startServices`: the server API the app's backend triggers workflows and manages
 * subscribers with, code-first workflows run through the app's bridge (`seed.bridgeUrl`), and
 * the Inbox's API and socket the browser uses; gives tests the `novu` fixture. `settle` waits
 * for the workflow runs. Read runs and messages with `novuProject(novu)`.
 */
export function novuService(options: NovuOptions = {}): OAuthService {
  const service = oauthService(
    {
      name: "novu",
      definition: novu,
      hosts: NOVU_HOSTS,
      apply: (emulator, config) => seedNovu(emulator.store, config),
    },
    options.seed,
  )

  if (options.email) connectNovuEmail(service.emulator, options.email.emulator)

  return settledWithRuns(service, service.emulator)
}

/**
 * Tiptap Cloud collaboration for `startServices`: the socket editors sync documents over and the
 * documents REST API on `<appId>.collab.tiptap.cloud`; gives tests the `tiptap` fixture. Read a
 * document with `tiptapCollab(tiptap).text(name)`.
 */
export function tiptapService(options: TiptapOptions = {}): OAuthService {
  return oauthService(
    {
      name: "tiptap",
      definition: tiptap,
      hosts: TIPTAP_HOSTS,
      apply: (emulator, config) => seedTiptap(emulator, config),
    },
    options.seed,
  )
}

/** What `pusherEnvironment()` starts: the Pusher emulator behind its own proxy. */
export type PusherEnvironment = OAuthEnvironment<"pusher">
/** What `novuEnvironment()` starts: the Novu emulator behind its own proxy. */
export type NovuEnvironment = OAuthEnvironment<"novu">
/** What `tiptapEnvironment()` starts: the Tiptap emulator behind its own proxy. */
export type TiptapEnvironment = OAuthEnvironment<"tiptap">

type Unrouted = { readonly unmatched?: "passthrough" | "block" }

/** A worker-scoped Pusher emulator behind its own proxy; combine services with `startServices`. */
export function pusherEnvironment(
  options: PusherOptions & Unrouted = {},
): Promise<PusherEnvironment> {
  return oauthEnvironment("pusher", pusherService(options), options)
}

/** A worker-scoped Novu emulator behind its own proxy; combine services with `startServices`. */
export function novuEnvironment(options: NovuOptions & Unrouted = {}): Promise<NovuEnvironment> {
  return oauthEnvironment("novu", novuService(options), options)
}

/** A worker-scoped Tiptap emulator behind its own proxy; combine services with `startServices`. */
export function tiptapEnvironment(
  options: TiptapOptions & Unrouted = {},
): Promise<TiptapEnvironment> {
  return oauthEnvironment("tiptap", tiptapService(options), options)
}
