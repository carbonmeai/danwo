import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import { apiRoutes } from "./api.ts"
import { NovuEngine } from "./engine.ts"
import { novuError } from "./formatters.ts"
import { inboxRoutes } from "./inbox.ts"
import { novuServer, registerNovu } from "./inspect.ts"
import { NovuRealtime } from "./realtime.ts"
import { NOVU_DEFAULTS, seedNovu } from "./seed.ts"
import { novuStore } from "./store.ts"

export type { NovuChannel, NovuExecution, NovuMessage, NovuSubscriber } from "./entities.ts"
export type { NovuEmail } from "./engine.ts"
export { novuOutboundFaults } from "./faults.ts"
export { type NovuProject, novuProject } from "./inspect.ts"
export {
  NOVU_DEFAULTS,
  type NovuSeedConfig,
  type NovuSeedSubscriber,
  type NovuSeedWorkflow,
  seedNovu,
} from "./seed.ts"

/** The hosts the Novu emulator answers: the API and the Inbox's realtime socket, US and EU. */
export const NOVU_HOSTS: readonly string[] = [
  "api.novu.co",
  "eu.api.novu.co",
  "socket.novu.co",
  "eu.socket.novu.co",
]

/**
 * Sends the emails Novu's workflows produce through the Resend emulator, so they land in its inbox
 * (`resendInbox(resend)`) as if a Resend integration were set up in Novu; `from` is the sender.
 */
export function connectNovuEmail(
  novu: Emulator,
  resend: Emulator,
  from = "Novu <no-reply@novu.danwo.test>",
): void {
  novuServer(novu.store).engine.email = async (email) => {
    const response = await resend.fetch(
      new Request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: "Bearer re_novu_integration",
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html }),
      }),
    )

    if (!response.ok)
      throw new Error(`Resend refused Novu's email: ${response.status} ${await response.text()}`)
  }
}

/**
 * Novu: the server API `@novu/api` calls (triggers, subscribers, topics, notifications), workflow
 * runs (code-first ones through the app's `@novu/framework` bridge, dashboard ones from seeded
 * templates), the Inbox API and realtime socket `@novu/react` uses, and each step's message. Read
 * runs and messages with `novuProject(novu)`.
 */
export const novu = defineEmulator({
  name: "novu",
  setup({ app, store, clock, wallClock }) {
    const objects = novuStore(store)
    const realtime = new NovuRealtime(objects)
    const engine = new NovuEngine(objects, clock, wallClock, realtime)

    registerNovu(store, engine, realtime)
    store.whenReset(() => realtime.closeAll())

    app.onError((error, c) => {
      const status = error instanceof HttpError ? error.status : 500

      return novuError(c, status, error instanceof Error ? error.message : "Internal server error")
    })
    inboxRoutes({ app, objects, clock, engine, realtime })
    apiRoutes({ app, objects, clock, engine, realtime }, store)
  },
  seed({ store }) {
    seedNovu(store, {
      apiKey: NOVU_DEFAULTS.apiKey,
      applicationIdentifier: NOVU_DEFAULTS.applicationIdentifier,
    })
  },
  sockets: ({ store }) => {
    const { realtime } = novuServer(store)

    return (socket, upgrade) => realtime.open(socket, upgrade)
  },
})
