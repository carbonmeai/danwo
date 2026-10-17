import { defineEmulator } from "../define.ts"
import { apiRoutes, slackErrors } from "./api.ts"
import type { Methods, SlackRouteContext } from "./context.ts"
import { SlackEvents } from "./events.ts"
import { chatMethods } from "./routes/chat.ts"
import { conversationMethods } from "./routes/conversations.ts"
import { fileMethods, fileRoutes } from "./routes/files.ts"
import { authMethods, oauthRoutes } from "./routes/oauth.ts"
import { reactionMethods } from "./routes/reactions.ts"
import { userMethods } from "./routes/users.ts"
import { viewMethods } from "./routes/views.ts"
import { webhookRoutes } from "./routes/webhooks.ts"
import { deliveryEndpoints, SLACK_DELIVERY, slackSigner } from "./signature.ts"
import { slackStore } from "./store.ts"

export { slackOutboundFaults } from "./faults.ts"
export { SLACK_HOSTS } from "./helpers.ts"
export type { Action as SlackAction } from "./interactions.ts"
export {
  type SlackSeedApp,
  type SlackSeedChannel,
  type SlackSeedConfig,
  type SlackSeedInstall,
  type SlackSeedUser,
  seedSlack,
} from "./seed.ts"
export { slackSignature } from "./signature.ts"
export {
  type SlackEphemeral,
  type SlackMessage,
  type SlackWorkspace,
  slackWorkspace,
  type UrlVerification,
} from "./workspace.ts"

/** Every Web API method the emulator answers. */
const METHODS: Methods = {
  ...authMethods,
  ...chatMethods,
  ...conversationMethods,
  ...userMethods,
  ...reactionMethods,
  ...viewMethods,
  ...fileMethods,
}

function routes(context: SlackRouteContext): void {
  oauthRoutes(context)
  webhookRoutes(context)
  fileRoutes(context)
  apiRoutes(context, METHODS)
}

/**
 * Slack on its real hostnames: app installs through OAuth v2 (the consent page, `oauth.v2.access`,
 * token rotation), the Web API with Slack's scope checks and `{ ok: false, error }` answers,
 * incoming webhooks, `response_url`s and file uploads. Events API callbacks, slash commands and
 * interactive payloads go to each installed app through the webhook dispatcher, signed with the
 * app's signing secret.
 */
export const slack = defineEmulator({
  name: "slack",
  setup({ app, store, outbox, clock }) {
    const state = slackStore(store)

    app.onError(slackErrors())
    routes({ app, store, clock, slack: state, events: new SlackEvents(state, outbox, clock) })
  },
  webhooks: ({ store }) => ({
    endpoints: () => deliveryEndpoints(slackStore(store)),
    sign: slackSigner(),
    policy: SLACK_DELIVERY,
  }),
})
