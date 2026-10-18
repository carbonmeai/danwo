import { objectTable, sidTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  Account,
  ApiKey,
  Message,
  MessageExtra,
  PhoneNumber,
  Unreachable,
  Verification,
  VerificationExtra,
  VerifyService,
} from "./entities.ts"

/** The Twilio objects held in an emulator's store; API objects are addressed by their sids. */
export function twilioStore(store: Store) {
  return {
    accounts: objectTable<Account>(store, "twilio.accounts"),
    keys: objectTable<ApiKey>(store, "twilio.api_keys"),
    numbers: objectTable<PhoneNumber>(store, "twilio.numbers"),
    unreachable: objectTable<Unreachable>(store, "twilio.unreachable"),
    messages: sidTable<Message, MessageExtra>(store, "twilio.messages"),
    services: sidTable<VerifyService>(store, "twilio.verify_services"),
    verifications: sidTable<Verification, VerificationExtra>(store, "twilio.verifications"),
  }
}

export type TwilioStore = ReturnType<typeof twilioStore>
