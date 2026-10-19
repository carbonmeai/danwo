import { randomBytes } from "node:crypto"

import { objectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  NovuEnvironment,
  NovuExecution,
  NovuMessage,
  NovuSession,
  NovuSubscriber,
  NovuTopic,
  NovuWorkflow,
} from "./entities.ts"

/** The Novu objects held in an emulator's store. */
export function novuStore(store: Store) {
  const environments = objectTable<NovuEnvironment>(store, "novu.environments")

  return {
    environments,
    subscribers: objectTable<NovuSubscriber>(store, "novu.subscribers"),
    topics: objectTable<NovuTopic>(store, "novu.topics"),
    workflows: objectTable<NovuWorkflow>(store, "novu.workflows"),
    messages: objectTable<NovuMessage>(store, "novu.messages"),
    executions: objectTable<NovuExecution>(store, "novu.executions"),
    sessions: objectTable<NovuSession>(store, "novu.sessions"),
    /** The one environment; the first seeded, or the default. */
    environment: () => environments.all()[0],
  }
}

export type NovuStore = ReturnType<typeof novuStore>

/** A Mongo-style object id, as Novu's ids are. */
export function objectId(): string {
  return randomBytes(12).toString("hex")
}
