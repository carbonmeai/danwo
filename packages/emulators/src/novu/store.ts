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

/** The fields of a subscriber a request or a seed can set, by their stored names. */
export type SubscriberFields = Partial<
  Pick<
    NovuSubscriber,
    "first_name" | "last_name" | "email" | "phone" | "avatar" | "locale" | "timezone" | "data"
  >
>

/** A new subscriber with nothing set but `fields`. */
export function newSubscriber(
  subscriberId: string,
  now: string,
  fields: SubscriberFields,
): NovuSubscriber {
  return {
    id: objectId(),
    subscriber_id: subscriberId,
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    avatar: null,
    locale: null,
    timezone: null,
    data: null,
    channels: [],
    created: now,
    updated: now,
    ...fields,
  }
}

/** `values` without the keys whose value is undefined. */
export function defined<T extends object>(
  values: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the entries kept are T's own keys, without the undefined values the result type removes
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}

/** A Mongo-style object id, as Novu's ids are. */
export function objectId(): string {
  return randomBytes(12).toString("hex")
}
