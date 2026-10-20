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
 * `sign`, stamping each attempt with the apps' time (`wall`) instead of the emulator's (`clock`),
 * so a delivery made while time travels or a test holds the clock still verifies against the
 * app's own clock. An attempt signed in the past (the `stale` fault) stays that far in the past.
 */
export function signedOnWallClock(clock: Clock, wall: Clock, sign: WebhookSigner): WebhookSigner {
  return ({ endpoint, body, timestamp }) => {
    const pastBy = Math.max(0, Math.floor(clock().getTime() / 1000) - timestamp)

    return sign({ endpoint, body, timestamp: Math.floor(wall().getTime() / 1000) - pastBy })
  }
}

/**
 * The request body POSTed for one message, from its JSON. Providers whose notifications carry their
 * meaning in headers send less than the message, e.g. nothing at all.
 */
export type WebhookPayload = (endpoint: WebhookEndpoint, body: string) => string

/** What an endpoint answered to one delivered webhook. */
export interface WebhookAnswer {
  readonly status: number
  readonly contentType: string
  readonly body: string
}

/** Called with what an endpoint answered to each delivered attempt. */
export type WebhookAnswerHandler = (
  message: OutboxMessage,
  endpoint: WebhookEndpoint,
  answer: WebhookAnswer,
) => void

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
 * - `stale`: sign the first attempt as if made `seconds` ago; retries are signed normally;
 * - `after`: hold it back until a message on `topic` has been delivered to the same endpoint, so
 *   two events arrive in the opposite order to the one they were sent in. A message held for a
 *   topic that never comes is never sent.
 */
export type WebhookFault =
  | { readonly kind: "duplicate" }
  | { readonly kind: "delay"; readonly ms: number }
  | { readonly kind: "forged" }
  | { readonly kind: "stale"; readonly seconds: number }
  | { readonly kind: "after"; readonly topic: string }

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
    case "after":
      return `after ${fault.topic}`
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

/** The first attempts a message gets under `fault`: when each is sent, and how. */
function firstAttempts(
  fault: Exclude<WebhookFault, { kind: "after" }> | undefined,
): readonly { readonly delayMs: number; readonly mode: AttemptMode }[] {
  const label = fault ? describeWebhookFault(fault) : null

  switch (fault?.kind) {
    case "duplicate":
      return [
        { delayMs: 0, mode: NORMAL },
        { delayMs: 0, mode: { ...NORMAL, fault: label } },
      ]
    case "delay":
      return [{ delayMs: fault.ms, mode: { ...NORMAL, fault: label } }]
    case "forged":
      return [
        { delayMs: 0, mode: { signing: "forged", retry: false, fault: label } },
        { delayMs: 0, mode: NORMAL },
      ]
    case "stale":
      return [{ delayMs: 0, mode: { signing: fault.seconds, retry: true, fault: label } }]
    default:
      return [{ delayMs: 0, mode: NORMAL }]
  }
}

/** A message an `after` fault holds back until `topic` has been delivered to its endpoint. */
interface Held {
  readonly message: OutboxMessage
  readonly endpoint: WebhookEndpoint
  readonly topic: string
  readonly label: string
}

export interface DeliveryAttempt {
  readonly messageId: number
  readonly topic: string
  readonly endpointId: string
  /** 1 for the first attempt. */
  readonly attempt: number
  /** When it was sent by the emulator's clock (which a test may hold or move). */
  readonly at: string
  /** When it was sent by the wall clock: what lines it up with the run's steps and calls. */
  readonly sentAt?: string
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
  /** Reads the answer to every delivered attempt; without it, answers are dropped unread. */
  readonly onAnswer?: WebhookAnswerHandler
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

/** A letter or digit turned into another of its kind (`a`↔`z`, `A`↔`Z`, `0`↔`9`). */
function flipped(char: string): string {
  const code = char.charCodeAt(0)
  const [first, last] = code <= 57 ? [48, 57] : code <= 90 ? [65, 90] : [97, 122]

  return String.fromCharCode(first + last - code)
}

/**
 * A wrong secret of the same shape: every letter and digit after the secret's prefix (`whsec_`)
 * turned into another, so the key differs however a provider reads it, as text, base64 or hex,
 * then `_forged`, which marks the copy. Appending alone is not enough: a base64 decoder stops at
 * the padding, so `whsec_…XQ=_forged` decodes to the real key.
 */
export function forgedSecret(secret: string): string {
  const prefix = /^(?:[a-z]+_)*/.exec(secret)?.[0] ?? ""

  return `${prefix}${secret.slice(prefix.length).replace(/[0-9A-Za-z]/g, flipped)}_forged`
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
  private held: Held[] = []

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
    this.held = []
    this.log.length = 0
  }

  /** Resolves once no attempt is in flight. Scheduled retries do not count. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)
  }

  attempts(): readonly DeliveryAttempt[] {
    return [...this.log]
  }

  /**
   * The id of the newest message the emulator has emitted, 0 for none. Every delivery of a message
   * up to it, however late it is sent, was set off by what happened before this was read.
   */
  lastMessageId(): number {
    return this.options.outbox.all().at(-1)?.id ?? 0
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

    if (fault?.kind === "after") {
      const label = describeWebhookFault(fault)

      this.held = [...this.held, { message, endpoint, topic: fault.topic, label }]

      return
    }

    for (const { delayMs, mode } of firstAttempts(fault))
      this.schedule(message, endpoint, 1, delayMs, mode)
  }

  /** Sends every message held back for `topic` at `endpoint`, now that `topic` was delivered there. */
  private release(topic: string, endpoint: WebhookEndpoint): void {
    const due = this.held.filter((h) => h.topic === topic && h.endpoint.id === endpoint.id)

    if (due.length === 0) return

    this.held = this.held.filter((h) => !due.includes(h))
    for (const h of due) this.schedule(h.message, h.endpoint, 1, 0, { ...NORMAL, fault: h.label })
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
        endpoint: { ...endpoint, secret: forgedSecret(endpoint.secret) },
        body,
        timestamp: now,
      })

    return sign({ endpoint, body, timestamp: mode.signing === "normal" ? now : now - mode.signing })
  }

  /** What is POSTed for a message whose JSON is `body`. */
  private posted(endpoint: WebhookEndpoint, body: string): string {
    return this.options.payload ? this.options.payload(endpoint, body) : body
  }

  /** The endpoint's answer when someone reads answers; otherwise its body is dropped unread. */
  private async answerOf(response: Response): Promise<WebhookAnswer | undefined> {
    if (!this.options.onAnswer) {
      await response.body?.cancel()

      return undefined
    }

    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    }
  }

  /** POSTs one attempt: its status (null when the request did not complete) and the answer. */
  private async post(
    endpoint: WebhookEndpoint,
    headers: Record<string, string>,
    body: string,
    policy: DeliveryPolicy,
  ): Promise<{ status: number | null; error: string | null; answer?: WebhookAnswer }> {
    try {
      const response = await (this.options.fetch ?? fetch)(endpoint.url, {
        method: "POST",
        headers,
        body: this.posted(endpoint, body),
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(policy.timeoutMs)]),
      })
      const answer = await this.answerOf(response)

      return { status: response.status, error: null, ...(answer && { answer }) }
    } catch (err) {
      return { status: null, error: err instanceof Error ? err.message : String(err) }
    }
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
    const sentAt = new Date().toISOString()
    const body = encodeBody(message.body)
    const headers = this.signed(endpoint, body, Math.floor(at.getTime() / 1000), mode)
    const started = performance.now()
    const { status, error, answer } = await this.post(endpoint, headers, body, policy)
    const delivered = status !== null && status >= 200 && status < 300

    if (generation !== this.generation) return delivered
    if (delivered && answer) this.options.onAnswer?.(message, endpoint, answer)
    this.log.push({
      messageId: message.id,
      topic: message.topic,
      endpointId: endpoint.id,
      attempt,
      at: at.toISOString(),
      sentAt,
      status,
      error,
      durationMs: Math.round(performance.now() - started),
      delivered,
      fault: mode.fault,
    })
    if (delivered) this.release(message.topic, endpoint)

    return delivered
  }
}
