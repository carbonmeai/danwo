import { defineEmulator, type EmulatorContext } from "../define.ts"
import { providerErrors } from "../errors.ts"
import { twilioAuth } from "./auth.ts"
import type { TwilioRouteContext } from "./context.ts"
import { deliveryEndpoints, TwilioMessaging } from "./events.ts"
import { twilioError } from "./helpers.ts"
import { accountRoutes } from "./routes/accounts.ts"
import { messageRoutes } from "./routes/messages.ts"
import { verifyRoutes } from "./routes/verify.ts"
import { TWILIO_DELIVERY, twilioSigner } from "./signature.ts"
import { twilioStore } from "./store.ts"

export { twilioOutboundFaults } from "./faults.ts"
export { TWILIO_HOSTS } from "./helpers.ts"
export {
  type PhoneMessage,
  type TwilioInbox,
  twilioInbox,
  type TwilioPhone,
  twilioPhone,
} from "./inbox.ts"
export {
  seedTwilio,
  type TwilioSeedAccount,
  type TwilioSeedApiKey,
  type TwilioSeedConfig,
  type TwilioSeedNumber,
  type TwilioSeedService,
  type TwilioSeedUnreachable,
} from "./seed.ts"
export { twilioSignature } from "./signature.ts"

/**
 * Twilio on its real hostnames: sending messages (`api.twilio.com`), their status moving on the
 * emulator's clock with status callbacks, messages to the account's numbers POSTed to their SMS
 * URLs (with `<Message>` replies in the app's TwiML sent back), and Verify v2 services,
 * verifications that text a code, and checks. Everything POSTed to the app is signed with
 * `X-Twilio-Signature` under the account's auth token.
 */
export const twilio = defineEmulator({
  name: "twilio",
  setup(emulator) {
    const context = routeContext(emulator)
    const messaging = new TwilioMessaging(context)

    emulator.app.onError(
      providerErrors((c, status, message) =>
        twilioError(c, status, status === 500 ? 20500 : status, message),
      ),
    )
    emulator.app.use(twilioAuth(context.twilio))
    accountRoutes(context)
    messageRoutes(context, messaging)
    verifyRoutes(context, messaging)
  },
  webhooks: (emulator) => {
    const context = routeContext(emulator)
    const messaging = new TwilioMessaging(context)

    return {
      endpoints: () => deliveryEndpoints(context),
      sign: twilioSigner,
      policy: TWILIO_DELIVERY,
      onAnswer: (message, _endpoint, answer) => messaging.answer(message, answer),
    }
  },
})

function routeContext(emulator: EmulatorContext): TwilioRouteContext {
  return { ...emulator, twilio: twilioStore(emulator.store) }
}
