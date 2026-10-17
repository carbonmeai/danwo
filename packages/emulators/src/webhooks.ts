import type { Outbox, OutboxMessage } from "./outbox.ts"
import type { Clock } from "./store.ts"
import type { Timer } from "./time.ts"

/** Where an emulator sends webhooks. `events` may contain `"*"` for every event. */
export interface WebhookEndpoint {
  readonly id: string
  readonly url: string
  readonly events: readonly string[]
  readonly secret: string
  readonly enabled: boolean
}

/** Headers for one delivery attempt: content type plus the provider's signature. */
export type WebhookSigner = (input: {
  endpoint: WebhookEndpoint
  body: string
  /** Unix seconds at the time of this attempt. */
  timestamp: number
}) => Record<string, string>

/**
 * The request body POSTed for one message, from its JSON. Providers whose notifications carry their
 * meaning in headers send less than the message, e.g. nothing at all.
 */
export type WebhookPayload = (endpoint: WebhookEndpoint, body: string) => string

export interface DeliveryPolicy {
  /** Delay before each retry after a failed attempt; its length is the number of retries. */
  readonly retryDelaysMs: readonly number[]
  /** An attempt that takes longer than this counts as failed. */
  readonly timeoutMs: number
}

/**
 * What to do to one webhook instead of delivering it normally:
 * - `duplicate`: deliver it twice;
 * - `delay`: hold the first attempt back (which also reorders it after later events);
 * - `forged`: also send a copy signed with the wrong secret, as an attacker would;
 * - `stale`: sign the first attempt as if made `seconds` ago; retries are signed normally.
 */
export type WebhookFault =
  | { readonly kind: "duplicate" }
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "forged" }
  | { readonly kind: "stale"; readonly seconds: number }

export type WebhookFaultRule = (
  message: OutboxMessage,
  endpoint: WebhookEndpoint,
) => WebhookFault | undefined

/** A short label for a fault, for logs and reports. */
export function describeWebhookFault(fault: WebhookFault): string {
  switch (fault.kind) {
    case "delay":
      return `delay ${fault.ms}ms`
    case "stale":
      return `stale ${fault.seconds}s`
    default:
      return fault.kind
  }
}

interface AttemptMode {
  /** `forged` signs with a wrong secret; a number signs that many seconds in the past. */
  readonly signing: "normal" | "forged" | number
  readonly retry: boolean
  readonly fault: string | null
}

const NORMAL: AttemptMode = { signing: "normal", retry: true, fault: null }

export interface DeliveryAttempt {
  readonly messageId: number
  readonly topic: string
  readonly endpointId: string
  /** 1 for the first attempt. */
  readonly attempt: number
  readonly at: string
  /** HTTP status, or null when the request did not complete (refused, timed out). */
  readonly status: number | null
  readonly error: string | null
  readonly durationMs: number
  readonly delivered: boolean
  /** The fault injected into this attempt, if any. */
  readonly fault: string | null
}

export interface WebhookDispatcherOptions {
  readonly outbox: Outbox
  readonly endpoints: () => readonly WebhookEndpoint[]
  readonly sign: WebhookSigner
  /** What is POSTed; the message's JSON when absent. Signing always sees the JSON. */
  readonly payload?: WebhookPayload
  readonly policy: DeliveryPolicy
  readonly clock: Clock
  readonly timer: Timer
  readonly fetch?: typeof fetch
}

/** A message body as sent: a string is already encoded (a form, say) and goes as it is; anything else as JSON. */
function encodeBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body)
}

function matches(endpoint: WebhookEndpoint, topic: string): boolean {
  return endpoint.enabled && (endpoint.events.includes("*") || endpoint.events.includes(topic))
}

/**
 * Delivers every outbox message to each matching endpoint, after the request that produced it has
 * returned. A non-2xx response, a network error or a timeout is retried after the next delay in
 * the policy; each attempt is signed with the time it is made and recorded.
 */
export class WebhookDispatcher {
  private readonly options: WebhookDispatcherOptions
  private readonly log: DeliveryAttempt[] = []
  private readonly timers = new Set<unknown>()
  private readonly inFlight = new Set<Promise<void>>()
  private unsubscribe: (() => void) | undefined
  private readonly controller = new AbortController()
  /** Bumped on reset, so attempts already in flight do not schedule retries for old messages. */
  private generation = 0
  private faultRule: WebhookFaultRule | undefined

  constructor(options: WebhookDispatcherOptions) {
    this.options = options
  }

  start(): void {
    this.unsubscribe ??= this.options.outbox.subscribe((message) => {
      for (const endpoint of this.options.endpoints()) {
        if (matches(endpoint, message.topic)) this.enqueue(message, endpoint)
      }
    })
  }

  /** Stops scheduling, cancels pending retries and aborts requests in flight. */
  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.cancelPending()
    this.controller.abort()
    await this.idle()
  }

  /** Sets the rule that picks a fault for each new webhook; `undefined` removes it. */
  setFault(rule: WebhookFaultRule | undefined): void {
    this.faultRule = rule
  }

  /** Cancels every scheduled delivery and forgets the log, as an emulator reset does. */
  reset(): void {
    this.generation++
    this.cancelPending()
    this.log.length = 0
  }

  /** Resolves once no attempt is in flight. Scheduled retries do not count. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)
  }

  attempts(): readonly DeliveryAttempt[] {
    return [...this.log]
  }

  /** Sends a message again to one endpoint now, outside the retry schedule. */
  redeliver(message: OutboxMessage, endpoint: WebhookEndpoint): Promise<void> {
    const mode = { ...NORMAL, retry: false }

    return this.attempt(message, endpoint, this.attemptsFor(message, endpoint) + 1, mode)
  }

  private attemptsFor(message: OutboxMessage, endpoint: WebhookEndpoint): number {
    return this.log.filter((a) => a.messageId === message.id && a.endpointId === endpoint.id).length
  }

  private cancelPending(): void {
    for (const handle of this.timers) this.options.timer.clearTimeout(handle)
    this.timers.clear()
  }

  private enqueue(message: OutboxMessage, endpoint: WebhookEndpoint): void {
    const fault = this.faultRule?.(message, endpoint)
    const label = fault ? describeWebhookFault(fault) : null

    switch (fault?.kind) {
      case "duplicate":
        this.schedule(message, endpoint, 1, 0, NORMAL)
        this.schedule(message, endpoint, 1, 0, { ...NORMAL, fault: label })

        return
      case "delay":
        this.schedule(message, endpoint, 1, fault.ms, { ...NORMAL, fault: label })

        return
      case "forged":
        this.schedule(message, endpoint, 1, 0, { signing: "forged", retry: false, fault: label })
        this.schedule(message, endpoint, 1, 0, NORMAL)

        return
      case "stale":
        this.schedule(message, endpoint, 1, 0, {
          signing: fault.seconds,
          retry: true,
          fault: label,
        })

        return
      default:
        this.schedule(message, endpoint, 1, 0, NORMAL)
    }
  }

  private schedule(
    message: OutboxMessage,
    endpoint: WebhookEndpoint,
    attempt: number,
    delayMs: number,
    mode: AttemptMode,
  ): void {
    const handle = this.options.timer.setTimeout(() => {
      this.timers.delete(handle)
      void this.attempt(message, endpoint, attempt, mode)
    }, delayMs)

    this.timers.add(handle)
  }

  private attempt(
    message: OutboxMessage,
    endpoint: WebhookEndpoint,
    attempt: number,
    mode: AttemptMode,
  ): Promise<void> {
    const generation = this.generation
    const task = this.send(message, endpoint, attempt, mode).then((delivered) => {
      const delay = this.options.policy.retryDelaysMs[attempt - 1]
      const current = generation === this.generation && this.unsubscribe !== undefined

      if (!delivered && mode.retry && delay !== undefined && current)
        this.schedule(message, endpoint, attempt + 1, delay, NORMAL)
    })

    this.inFlight.add(task)
    void task.finally(() => this.inFlight.delete(task))

    return task
  }

  /** The attempt's headers: signed now, signed in the past, or signed with the wrong secret. */
  private signed(
    endpoint: WebhookEndpoint,
    body: string,
    now: number,
    mode: AttemptMode,
  ): Record<string, string> {
    const { sign } = this.options

    if (mode.signing === "forged")
      return sign({
        endpoint: { ...endpoint, secret: `${endpoint.secret}_forged` },
        body,
        timestamp: now,
      })

    return sign({ endpoint, body, timestamp: mode.signing === "normal" ? now : now - mode.signing })
  }

  /** What is POSTed for a message whose JSON is `body`. */
  private posted(endpoint: WebhookEndpoint, body: string): string {
    return this.options.payload ? this.options.payload(endpoint, body) : body
  }

  private async send(
    message: OutboxMessage,
    endpoint: WebhookEndpoint,
    attempt: number,
    mode: AttemptMode,
  ): Promise<boolean> {
    const { clock, policy } = this.options
    const generation = this.generation
    const at = clock()
    const body = encodeBody(message.body)
    const headers = this.signed(endpoint, body, Math.floor(at.getTime() / 1000), mode)
    const started = performance.now()
    let status: number | null = null
    let error: string | null = null

    try {
      const response = await (this.options.fetch ?? fetch)(endpoint.url, {
        method: "POST",
        headers,
        body: this.posted(endpoint, body),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(policy.timeoutMs)]),
      })

      status = response.status
      await response.body?.cancel()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }

    const delivered = status !== null && status >= 200 && status < 300

    if (generation !== this.generation) return delivered
    this.log.push({
      messageId: message.id,
      topic: message.topic,
      endpointId: endpoint.id,
      attempt,
      at: at.toISOString(),
      status,
      error,
      durationMs: Math.round(performance.now() - started),
      delivered,
      fault: mode.fault,
    })

    return delivered
  }
}
