import type { ServiceDelivery } from "@danwo/matrix"
import { describe, expect, it } from "vitest"

import { lint, lintReport, withLint } from "../src/lint/index.ts"
import type { LintSubject } from "../src/lint/types.ts"
import type { RecordedExchange, RecordedStep } from "../src/runner/record.ts"
import { credentialKind, sentByBrowser } from "../src/secrets/index.ts"

const T0 = Date.parse("2026-10-18T10:00:00.000Z")

/** An ISO time `ms` after the run began. */
function at(ms: number): string {
  return new Date(T0 + ms).toISOString()
}

let nextId = 0

/** A recorded call through the proxy; headers are names to values, as the record keeps them. */
function call(
  method: string,
  url: string,
  options: {
    readonly ms?: number
    readonly status?: number | null
    readonly fault?: string | null
    readonly headers?: Record<string, string>
    readonly responseHeaders?: Record<string, string>
    readonly body?: string
    readonly origin?: "page" | "server"
    readonly credential?: RecordedExchange["credential"]
  } = {},
): RecordedExchange {
  const { host, pathname, search } = new URL(url)

  return {
    disposition: "routed",
    method,
    host,
    path: `${pathname}${search}`,
    startedAt: at(options.ms ?? 0),
    id: String(nextId++),
    fault: options.fault ?? null,
    status: options.status === undefined ? 200 : options.status,
    durationMs: 5,
    aborted: false,
    origin: options.origin ?? "server",
    ...(options.credential && { credential: options.credential }),
    request: {
      headers: options.headers ?? {},
      body: options.body ?? null,
      bytes: 0,
      truncated: false,
    },
    response: { headers: options.responseHeaders ?? {}, body: null, bytes: 0, truncated: false },
  }
}

/** A webhook attempt the app answered. */
function delivery(
  topic: string,
  options: {
    readonly ms?: number
    readonly status?: number | null
    readonly fault?: string | null
    readonly service?: string
    readonly error?: string | null
  } = {},
): ServiceDelivery {
  return {
    messageId: 1,
    topic,
    endpointId: "we_1",
    attempt: 1,
    at: at(options.ms ?? 0),
    sentAt: at(options.ms ?? 0),
    status: options.status === undefined ? 200 : options.status,
    error: options.error ?? null,
    durationMs: 3,
    delivered: true,
    fault: options.fault ?? null,
    ...(options.service !== undefined && { service: options.service }),
  }
}

/** A step from `ms` for `durationMs`, at a test line. */
function step(index: number, ms: number, durationMs: number): RecordedStep {
  return {
    id: `s${index}`,
    index,
    kind: "locator",
    api: "locator.click",
    label: `step ${index}`,
    status: "passed",
    startedAt: at(ms),
    durationMs,
    source: { file: "tests/x.danwo.ts", line: 10 + index },
    events: [],
  }
}

function subject(parts: Partial<LintSubject>): LintSubject {
  return {
    run: { kind: "test", attempt: 1 },
    status: "passed",
    stopped: undefined,
    steps: [step(0, 0, 10_000)],
    exchanges: [],
    deliveries: [],
    ...parts,
  }
}

const rules = (s: LintSubject) => lint(s).map((finding) => finding.rule)

const SECRET = { kind: "secret", shape: "sk_test_" } as const

describe("stripe/idempotency-key", () => {
  it("flags a money-moving POST without a key, once per route", () => {
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/refunds"),
        call("POST", "https://api.stripe.com/v1/refunds", { ms: 10 }),
      ],
    })

    expect(rules(s).filter((r) => r === "stripe/idempotency-key")).toHaveLength(1)
  })

  it("is quiet for keyed calls, reads and calls that move no money", () => {
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/refunds", {
          headers: { "Idempotency-Key": "order-1" },
        }),
        call("GET", "https://api.stripe.com/v1/refunds"),
        call("POST", "https://api.stripe.com/v1/customers"),
      ],
    })

    expect(rules(s)).not.toContain("stripe/idempotency-key")
  })
})

describe("webhooks/accepts-forged", () => {
  it("flags a forged copy the app answered 2xx", () => {
    const s = subject({ deliveries: [delivery("checkout.session.completed", { fault: "forged" })] })

    expect(rules(s)).toContain("webhooks/accepts-forged")
  })

  it("is quiet when the app refused the forged copy", () => {
    const s = subject({
      deliveries: [
        delivery("checkout.session.completed", { fault: "forged", status: 400 }),
        delivery("checkout.session.completed"),
      ],
    })

    expect(rules(s)).not.toContain("webhooks/accepts-forged")
  })
})

describe("webhooks/accepts-stale", () => {
  it("flags an old signature accepted from a provider that dates its signatures", () => {
    const s = subject({
      deliveries: [delivery("checkout.session.completed", { fault: "stale 3600s" })],
    })

    expect(rules(s)).toContain("webhooks/accepts-stale")
  })

  it("is quiet for providers whose signatures carry no time", () => {
    const s = subject({
      deliveries: [delivery("issues", { fault: "stale 3600s", service: "github" })],
    })

    expect(rules(s)).not.toContain("webhooks/accepts-stale")
  })
})

describe("webhooks/rejects-valid", () => {
  it("flags a 4xx to a genuine delivery, and a 5xx in a run without faults", () => {
    const s = subject({
      deliveries: [
        delivery("checkout.session.completed", { status: 404 }),
        delivery("invoice.paid", { status: 500 }),
      ],
    })

    expect(lint(s).filter((f) => f.rule === "webhooks/rejects-valid")).toHaveLength(2)
  })

  it("is quiet for a 5xx while a fault is injected, and for refused forgeries", () => {
    const s = subject({
      run: { kind: "matrix", fault: { label: "status 500 on POST api.stripe.com/v1/refunds" } },
      deliveries: [
        delivery("invoice.paid", { status: 500 }),
        delivery("invoice.paid", { status: 400, fault: "forged" }),
      ],
    })

    expect(rules(s)).not.toContain("webhooks/rejects-valid")
  })
})

describe("webhooks/slow-answer", () => {
  it("flags a delivery the provider timed out on", () => {
    const s = subject({
      deliveries: [
        delivery("checkout.session.completed", {
          status: null,
          error: "The operation was aborted due to timeout",
        }),
      ],
    })

    expect(rules(s)).toContain("webhooks/slow-answer")
  })

  it("is quiet for a refused connection", () => {
    const s = subject({
      deliveries: [
        delivery("checkout.session.completed", { status: null, error: "connect ECONNREFUSED" }),
      ],
    })

    expect(rules(s)).not.toContain("webhooks/slow-answer")
  })
})

describe("payments/unconfirmed", () => {
  const paid = call("POST", "https://checkout.stripe.com/checkout/cs_test_a1b2c3d4e5/complete", {
    ms: 100,
    origin: "page",
  })

  it("flags a passing body after a payment the app never confirmed", () => {
    expect(rules(subject({ exchanges: [paid] }))).toContain("payments/unconfirmed")
  })

  it("is quiet when a confirming webhook came, or the app verified the payment", () => {
    const heard = subject({
      exchanges: [paid],
      deliveries: [delivery("checkout.session.completed", { ms: 500 })],
    })
    const verified = subject({
      exchanges: [
        paid,
        call("GET", "https://api.stripe.com/v1/checkout/sessions/cs_test_a1b2c3d4e5", { ms: 300 }),
      ],
    })

    expect(rules(heard)).not.toContain("payments/unconfirmed")
    expect(rules(verified)).not.toContain("payments/unconfirmed")
  })

  it("flags a webhook that only came after the body's checks were done", () => {
    const s = subject({
      steps: [step(0, 0, 1000)],
      exchanges: [paid],
      deliveries: [delivery("checkout.session.completed", { ms: 600_000 })],
    })

    expect(rules(s)).toContain("payments/unconfirmed")
  })

  it("is quiet when the body stopped early", () => {
    expect(rules(subject({ exchanges: [paid], stopped: "body stopped at x" }))).not.toContain(
      "payments/unconfirmed",
    )
  })
})

describe("flutterwave/verify-transaction", () => {
  const paid = call("POST", "https://checkout.flutterwave.com/v3/hosted/pay/FLW-1/card", {
    ms: 100,
    origin: "page",
  })

  it("flags a Flutterwave payment given value without the verify call", () => {
    const s = subject({
      exchanges: [paid],
      deliveries: [delivery("charge.completed", { ms: 200, service: "flutterwave" })],
    })

    expect(rules(s)).toContain("flutterwave/verify-transaction")
  })

  it("is quiet when the app verified the transaction", () => {
    const s = subject({
      exchanges: [
        paid,
        call("GET", "https://api.flutterwave.com/v3/transactions/123/verify", { ms: 300 }),
      ],
    })

    expect(rules(s)).not.toContain("flutterwave/verify-transaction")
  })
})

describe("resilience/duplicate-create", () => {
  it("flags a create sent again without the key after its answer was lost", () => {
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/payment_intents", {
          fault: "reset-after",
          status: null,
        }),
        call("POST", "https://api.stripe.com/v1/payment_intents", { ms: 50 }),
      ],
    })

    expect(rules(s)).toContain("resilience/duplicate-create")
  })

  it("is quiet when the retry reused the first call's key", () => {
    const key = { "Idempotency-Key": "pi-order-7" }
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/payment_intents", {
          fault: "reset-after",
          status: null,
          headers: key,
        }),
        call("POST", "https://api.stripe.com/v1/payment_intents", { ms: 50, headers: key }),
      ],
    })

    expect(rules(s)).not.toContain("resilience/duplicate-create")
  })
})

describe("resilience/retry-after-ignored", () => {
  const limited = call("GET", "https://api.stripe.com/v1/customers/cus_a1b2c3d4e5f6", {
    status: 429,
    responseHeaders: { "retry-after": "2" },
  })

  it("flags a retry before Retry-After allowed", () => {
    const s = subject({
      exchanges: [
        limited,
        call("GET", "https://api.stripe.com/v1/customers/cus_a1b2c3d4e5f6", { ms: 300 }),
      ],
    })

    expect(rules(s)).toContain("resilience/retry-after-ignored")
  })

  it("is quiet for a retry after the wait", () => {
    const s = subject({
      exchanges: [
        limited,
        call("GET", "https://api.stripe.com/v1/customers/cus_a1b2c3d4e5f6", { ms: 2500 }),
      ],
    })

    expect(rules(s)).not.toContain("resilience/retry-after-ignored")
  })
})

describe("resilience/no-retry-on-read", () => {
  it("flags a transiently failed read that was never tried again", () => {
    const s = subject({
      exchanges: [call("GET", "https://api.paystack.co/transaction/verify/ref1", { status: 503 })],
    })

    expect(rules(s)).toContain("resilience/no-retry-on-read")
  })

  it("is quiet when the read was tried again", () => {
    const s = subject({
      exchanges: [
        call("GET", "https://api.paystack.co/transaction/verify/ref1", { status: 503 }),
        call("GET", "https://api.paystack.co/transaction/verify/ref1", { ms: 500 }),
      ],
    })

    expect(rules(s)).not.toContain("resilience/no-retry-on-read")
  })
})

describe("secrets/key-in-browser", () => {
  it("flags a secret key the browser sent", () => {
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/customers", { origin: "page", credential: SECRET }),
      ],
    })

    expect(rules(s)).toContain("secrets/key-in-browser")
  })

  it("is quiet for the server's secret key and the browser's publishable key", () => {
    const s = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/customers", { credential: SECRET }),
        call("POST", "https://api.stripe.com/v1/tokens", {
          origin: "page",
          credential: { kind: "publishable", shape: "pk_test_" },
        }),
      ],
    })

    expect(rules(s)).not.toContain("secrets/key-in-browser")
  })
})

describe("secrets/key-in-url", () => {
  it("flags a server-only key in a query string, as the record keeps it redacted", () => {
    const s = subject({
      exchanges: [call("GET", "https://api.paystack.co/bank?key=sk_test_[redacted]")],
    })

    expect(rules(s)).toContain("secrets/key-in-url")
  })

  it("is quiet for ordinary query parameters", () => {
    const s = subject({ exchanges: [call("GET", "https://api.paystack.co/bank?country=nigeria")] })

    expect(rules(s)).not.toContain("secrets/key-in-url")
  })
})

describe("secrets/publishable-on-server", () => {
  it("flags a server call with a publishable key, and not the browser's", () => {
    const publishable = { kind: "publishable", shape: "pk_test_" } as const
    const server = subject({
      exchanges: [call("POST", "https://api.stripe.com/v1/customers", { credential: publishable })],
    })
    const page = subject({
      exchanges: [
        call("POST", "https://api.stripe.com/v1/tokens", {
          origin: "page",
          credential: publishable,
        }),
      ],
    })

    expect(rules(server)).toContain("secrets/publishable-on-server")
    expect(rules(page)).not.toContain("secrets/publishable-on-server")
  })
})

describe("oauth rules", () => {
  it("flags a sign-in without state, and one without PKCE", () => {
    const s = subject({
      exchanges: [
        call("GET", "https://accounts.google.com/o/oauth2/v2/auth?client_id=a&response_type=code"),
      ],
    })

    expect(rules(s)).toEqual(expect.arrayContaining(["oauth/missing-state", "oauth/missing-pkce"]))
  })

  it("is quiet when the sign-in sends state and a code challenge", () => {
    const s = subject({
      exchanges: [
        call(
          "GET",
          "https://accounts.google.com/o/oauth2/v2/auth?client_id=a&state=x1&code_challenge=c&code_challenge_method=S256",
        ),
      ],
    })

    expect(rules(s)).not.toContain("oauth/missing-state")
    expect(rules(s)).not.toContain("oauth/missing-pkce")
  })
})

/** The same sign-in email, sent at `ms`. */
const send = (ms: number) =>
  call("POST", "https://api.resend.com/emails", {
    ms,
    body: '{"to":"ada@x.test","subject":"Code"}',
  })

describe("messages/duplicate-send", () => {
  it("flags the same email sent twice in one step", () => {
    expect(rules(subject({ exchanges: [send(10), send(20)] }))).toContain("messages/duplicate-send")
  })

  it("is quiet for the same email in two steps", () => {
    const s = subject({
      steps: [step(0, 0, 100), step(1, 200, 100)],
      exchanges: [send(10), send(250)],
    })

    expect(rules(s)).not.toContain("messages/duplicate-send")
  })
})

describe("the engine", () => {
  const sloppy = subject({
    exchanges: [call("POST", "https://api.stripe.com/v1/refunds")],
  })

  it("runs a rule only when the run used its provider", () => {
    const quiet = subject({
      exchanges: [
        call("GET", "https://accounts.google.com/o/oauth2/v2/auth?state=1&code_challenge=c"),
      ],
    })

    expect(lint(quiet)).toEqual([])
  })

  it("applies config levels and turns rules off", () => {
    expect(lint(sloppy, { rules: { "stripe/idempotency-key": "error" } })[0]?.severity).toBe(
      "error",
    )
    expect(lint(sloppy, { rules: { "stripe/idempotency-key": "off" } })).toEqual([])
  })

  it("fails a run only when failOn says so", () => {
    const findings = lint(sloppy)

    expect(withLint(0, findings, undefined)).toBe(0)
    expect(withLint(0, findings, { failOn: "warning" })).toBe(1)
    expect(withLint(0, findings, { failOn: "error" })).toBe(0)
    expect(withLint(2, findings, { failOn: "warning" })).toBe(2)
  })

  it("prints a summary line and each finding once", () => {
    const twice = [...lint(sloppy), ...lint(sloppy)]
    const lines = lintReport(twice)

    expect(lines[0]).toBe("integration lint: 1 warning")
    expect(lines.filter((line) => line.includes("stripe/idempotency-key"))).toHaveLength(1)
  })

  it("carries a hint, docs and the step's test line in every finding", () => {
    const [finding] = lint(sloppy)

    expect(finding?.docs).toBe("danwo guide lint#stripe-idempotency-key")
    expect(finding?.hint).toMatch(/Idempotency-Key|key/)
    expect(finding?.evidence.source).toEqual({ file: "tests/x.danwo.ts", line: 10 })
  })
})

describe("what a recorded call keeps about its credential", () => {
  it("tells a secret key from a publishable one, and Basic credentials", () => {
    expect(credentialKind({ Authorization: "Bearer sk_test_abc" })).toEqual(SECRET)
    expect(credentialKind({ authorization: "Bearer pk_live_abc" })?.kind).toBe("publishable")
    expect(credentialKind({ authorization: "Basic QUM6dG9rZW4=" })).toEqual({
      kind: "secret",
      shape: "Basic",
    })
    expect(credentialKind({ authorization: "Bearer eyJhbGciOi" })).toBeUndefined()
  })

  it("tells a browser's request from a server's", () => {
    expect(sentByBrowser({ "sec-fetch-mode": "cors", "user-agent": "Mozilla/5.0" })).toBe(true)
    expect(sentByBrowser({ "user-agent": "Stripe/v1 NodeBindings/18" })).toBe(false)
    // Node's fetch sends sec-fetch-mode too; it is not a browser.
    expect(sentByBrowser({ "sec-fetch-mode": "cors", "user-agent": "node" })).toBe(false)
  })
})
