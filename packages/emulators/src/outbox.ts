import type { Clock } from "./store.ts"

/** A webhook an emulator wants delivered. Delivery (retries, faults, ordering) is handled elsewhere. */
export interface OutboxMessage {
  readonly id: number
  readonly topic: string
  readonly body: unknown
  readonly createdAt: string
}

/** Collects outgoing webhooks in emission order, so the API response never waits on delivery. */
export class Outbox {
  private messages: OutboxMessage[] = []
  private nextId = 1
  private readonly listeners = new Set<(message: OutboxMessage) => void>()

  private readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  push(topic: string, body: unknown): OutboxMessage {
    const message = { id: this.nextId++, topic, body, createdAt: this.clock().toISOString() }

    this.messages.push(message)
    for (const listener of this.listeners) listener(message)

    return message
  }

  /** Calls `listener` for every message pushed from now on. Returns an unsubscribe function. */
  subscribe(listener: (message: OutboxMessage) => void): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  all(): readonly OutboxMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
    this.nextId = 1
  }
}
