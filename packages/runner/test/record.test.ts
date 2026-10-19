import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange, Proxy } from "@danwo/proxy"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import type { SessionFlight } from "../src/flight.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"
import {
  attemptDir,
  buildRecord,
  finishRecord,
  type FlightRecord,
  type RecordInput,
} from "../src/runner/record.ts"
import { createRedactor } from "../src/runner/redact.ts"
import { finishRun, findRun } from "../src/runner/report.ts"
import { SecretVault } from "../src/secrets/index.ts"

const PASSWORD = "correct-horse-battery-staple-7"

describe("flight recorder redaction", () => {
  const ledger = new SecretVault({ password: PASSWORD })
  const redactor = createRedactor(ledger.redact)

  it("blanks credential headers by name and by a telling word", () => {
    expect(
      redactor.headers({
        authorization: "Bearer REDACTED-TEST-VALUE",
        "stripe-signature": "t=1,v1=abc",
        cookie: "session=xyz",
        "x-custom-api-key": "k-123",
        "content-type": "application/json",
      }),
    ).toEqual({
      authorization: "[redacted]",
      "stripe-signature": "[redacted]",
      cookie: "[redacted]",
      "x-custom-api-key": "[redacted]",
      "content-type": "application/json",
    })
  })

  it("blanks credential fields of JSON and form bodies, card details included", () => {
    expect(
      JSON.parse(
        redactor.body(
          JSON.stringify({
            email: "qa@danwo.test",
            password: "hunter22",
            nested: { api_key: "x" },
          }),
          "application/json; charset=utf-8",
        ),
      ),
    ).toEqual({ email: "qa@danwo.test", password: "[redacted]", nested: { api_key: "[redacted]" } })
    expect(
      redactor.body(
        "amount=500&payment_method_data[card][number]=4242424242424242&card[cvc]=123&client_secret=pi_1_secret_2",
        "application/x-www-form-urlencoded",
      ),
    ).toBe(
      "amount=500&payment_method_data[card][number]=[redacted]&card[cvc]=[redacted]&client_secret=[redacted]",
    )
  })

  it("redacts known secret values and provider key shapes anywhere in text", () => {
    const text = redactor.text(
      `pw ${PASSWORD} key REDACTED-TEST-VALUE REDACTED-TEST-VALUE re_123456789abc Basic dXNlcjpwYXNz pi_3Mtw_secret_YrKJUK REDACTED-TEST-VALUE`,
    )

    expect(text).not.toContain(PASSWORD)
    expect(text).toBe(
      "pw [secret password] key sk_live_[redacted] whsec_[redacted] re_[redacted] Basic [redacted] pi_3Mtw_secret_[redacted] AKIA[redacted]",
    )
  })

  it("redacts Gemini, Perplexity and Bedrock keys, and a Gemini key in a URL", () => {
    const text = redactor.text(
      "REDACTED-TEST-VALUE pplx-danwoEmulatedKey000000 REDACTED-TEST-VALUE https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?alt=sse&key=abc123",
    )

    expect(text).toBe(
      "AIza[redacted] pplx-[redacted] ABSK[redacted] https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?alt=sse&key=[redacted]",
    )
  })

  it("redacts OAuth codes, tokens, verifiers and client secrets in URLs, forms and JSON", () => {
    const idToken = "REDACTED-TEST-VALUE"

    expect(
      redactor.text(
        "https://app.danwo.test/auth/google/callback?state=s1&code=4%2F0AbCdE&scope=openid",
      ),
    ).toBe("https://app.danwo.test/auth/google/callback?state=s1&code=[redacted]&scope=openid")
    expect(
      redactor.body(
        "grant_type=authorization_code&code=abc123&code_verifier=v3r1f1er&client_secret=GOCSPX-x&redirect_uri=https://app.danwo.test/cb",
        "application/x-www-form-urlencoded",
      ),
    ).toBe(
      "grant_type=authorization_code&code=[redacted]&code_verifier=[redacted]&client_secret=[redacted]&redirect_uri=https://app.danwo.test/cb",
    )
    expect(
      JSON.parse(
        redactor.body(
          JSON.stringify({
            access_token: "ya29.a0AfH6",
            refresh_token: "1//0gAbc",
            id_token: idToken,
            token_type: "Bearer",
          }),
          "application/json",
        ),
      ),
    ).toEqual({
      access_token: "[redacted]",
      refresh_token: "[redacted]",
      id_token: "[redacted]",
      token_type: "Bearer",
    })
    expect(
      redactor.text(`id ${idToken} at ya29.a0AfH6xyz rt 1//0gAbcDef ms EwA4Aa1b2c3d4e5f6g7h8i9j0k`),
    ).toBe("id [redacted] at ya29.[redacted] rt 1//[redacted] ms EwA[redacted]")
    // An error code in JSON stays readable.
    expect(redactor.body(JSON.stringify({ code: "card_declined" }), "application/json")).toBe(
      JSON.stringify({ code: "card_declined" }),
    )
  })

  it("redacts push channel tokens, Graph clientState and URLs that grant access on their own", () => {
    expect(
      redactor.headers({ "x-goog-channel-token": "tok-123", "x-goog-channel-id": "ch-1" }),
    ).toEqual({ "x-goog-channel-token": "[redacted]", "x-goog-channel-id": "ch-1" })
    expect(
      JSON.parse(
        redactor.body(
          JSON.stringify({
            value: [
              { subscriptionId: "s1", clientState: "app-secret-state", changeType: "created" },
            ],
          }),
          "application/json",
        ),
      ),
    ).toEqual({
      value: [{ subscriptionId: "s1", clientState: "[redacted]", changeType: "created" }],
    })
    expect(redactor.value({ downloadToken: "d0wnl0ad", channel: { token: "tok-123" } })).toEqual({
      downloadToken: "[redacted]",
      channel: { token: "[redacted]" },
    })
    expect(
      redactor.text(
        "uploadUrl https://graph.microsoft.com/up/AbC123 and https://graph.microsoft.com/download/XyZ789?x=1",
      ),
    ).toBe(
      "uploadUrl https://graph.microsoft.com/up/[redacted] and https://graph.microsoft.com/download/[redacted]?x=1",
    )
    expect(
      redactor.text(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ADPycd123",
      ),
    ).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=[redacted]",
    )
  })

  it("redacts Slack and GitHub tokens, signatures, webhook URLs and private keys", () => {
    expect(
      redactor.headers({
        "x-slack-signature": "v0=abc",
        "x-hub-signature-256": "sha256=def",
        "x-hub-signature": "sha1=ghi",
      }),
    ).toEqual({
      "x-slack-signature": "[redacted]",
      "x-hub-signature-256": "[redacted]",
      "x-hub-signature": "[redacted]",
    })
    expect(
      redactor.text(
        "bot REDACTED-TEST-VALUE user REDACTED-TEST-VALUE refresh xoxe.xoxp-1-ghi app xapp-1-A0-jkl",
      ),
    ).toBe(
      "bot xoxb-[redacted] user xoxp-[redacted] refresh xoxe.xoxp-[redacted] app xapp-[redacted]",
    )
    expect(
      redactor.text(
        "gho_aaaaaaaaaaaaaaaaaaaa ghs_bbbbbbbbbbbbbbbbbbbb ghu_cccccccccccccccccccc ghr_dddddddddddddddddddd REDACTED-TEST-VALUE github_pat_11AAAAAAAAAAAAAAAAAAAA_ffff",
      ),
    ).toBe(
      "gho_[redacted] ghs_[redacted] ghu_[redacted] ghr_[redacted] ghp_[redacted] github_pat_[redacted]",
    )
    expect(
      redactor.text(
        "post to https://REDACTED-TEST-VALUE or https://hooks.slack.com/actions/T1/9/abc",
      ),
    ).toBe("post to https://hooks.slack.com/[redacted] or https://hooks.slack.com/[redacted]")
    expect(
      redactor.text(
        "key sk_sandbox_abc123 live sk_live_9xz portal https://portal.bachs.io/s/6Yc0nQ recover https://checkout.bachs.io/recover/ab12",
      ),
    ).toBe(
      "key sk_sandbox_[redacted] live sk_live_[redacted] portal https://portal.bachs.io/s/[redacted] recover https://checkout.bachs.io/recover/[redacted]",
    )
    expect(
      redactor.headers({ "x-bachs-signature": "abc", "x-bachs-signature-v2": "t=1,v1=abc" }),
    ).toEqual({
      "x-bachs-signature": "[redacted]",
      "x-bachs-signature-v2": "[redacted]",
    })
    expect(
      redactor.text(
        'key "REDACTED-TEST-VALUE\\nMIIEow\\nIBAAK\\n-----END RSA PRIVATE KEY-----\\n" end',
      ),
    ).toBe('key "[redacted]\\n" end')
    expect(
      redactor.value({
        signingSecret: "s3cret",
        clientSecret: "c1ient",
        webhookSecret: "w3bhook",
        privateKey: "pem",
        token: "verification",
        botToken: "bot",
        name: "kept",
      }),
    ).toEqual({
      signingSecret: "[redacted]",
      clientSecret: "[redacted]",
      webhookSecret: "[redacted]",
      privateKey: "[redacted]",
      token: "[redacted]",
      botToken: "[redacted]",
      name: "kept",
    })
  })

  it("hides Auth0 client secrets, refresh tokens, verification tickets and logout hints", () => {
    expect(redactor.text("https://acme.us.auth0.com/u/email-verification?ticket=Tk-123abc#")).toBe(
      "https://acme.us.auth0.com/u/email-verification?ticket=[redacted]#",
    )
    expect(
      redactor.text("https://acme.us.auth0.com/oidc/logout?id_token_hint=abc.def&state=s1"),
    ).toBe("https://acme.us.auth0.com/oidc/logout?id_token_hint=[redacted]&state=s1")
    expect(
      redactor.body(
        "grant_type=refresh_token&client_id=web&client_secret=shh&refresh_token=v1.opaque",
        "application/x-www-form-urlencoded",
      ),
    ).toBe(
      "grant_type=refresh_token&client_id=web&client_secret=[redacted]&refresh_token=[redacted]",
    )
  })

  it("hides Clerk keys, session tokens, dev browsers and handshake nonces", () => {
    expect(
      redactor.text(
        "keys sk_test_AbC123 pk_test_ZGFud28k dvb_2x-Yz_9 https://app.test/?__clerk_handshake_nonce=hsn_1&x=1#__clerk_ticket=t0k",
      ),
    ).toBe(
      "keys sk_test_[redacted] pk_test_[redacted] dvb_[redacted] https://app.test/?__clerk_handshake_nonce=[redacted]&x=1#__clerk_ticket=[redacted]",
    )
    expect(redactor.text("__session=REDACTED-TEST-VALUE; Path=/")).toBe(
      "__session=[redacted]; Path=/",
    )
    expect(redactor.headers({ cookie: "__client_uat=1", "set-cookie": "__session=x" })).toEqual({
      cookie: "[redacted]",
      "set-cookie": "[redacted]",
    })
  })

  it("hides Flutterwave keys, the webhook secret hash and its signature", () => {
    expect(
      redactor.text(
        "secret REDACTED-TEST-VALUE public REDACTED-TEST-VALUE live REDACTED-TEST-VALUE encryption REDACTED-TEST-VALUE",
      ),
    ).toBe(
      "secret FLWSECK_TEST-[redacted] public FLWPUBK_TEST-[redacted] live FLWSECK-[redacted] encryption FLWSECK_TEST[redacted]",
    )
    expect(
      redactor.headers({
        "verif-hash": "hash-123",
        "flutterwave-signature": "c2ln",
        accept: "*/*",
      }),
    ).toEqual({ "verif-hash": "[redacted]", "flutterwave-signature": "[redacted]", accept: "*/*" })
    expect(redactor.value({ secretHash: "hash-123", url: "http://app.test/hook" })).toEqual({
      secretHash: "[redacted]",
      url: "http://app.test/hook",
    })
  })

  it("hides Twilio auth tokens, API key secrets and request signatures", () => {
    expect(
      redactor.value({
        id: "AC1",
        authToken: "f00d",
        auth_token: "f00d",
        secret: "sk",
        name: "kept",
      }),
    ).toEqual({
      id: "AC1",
      authToken: "[redacted]",
      auth_token: "[redacted]",
      secret: "[redacted]",
      name: "kept",
    })
    expect(redactor.headers({ "x-twilio-signature": "abc=", accept: "*/*" })).toEqual({
      "x-twilio-signature": "[redacted]",
      accept: "*/*",
    })
  })

  it("hides Paystack secret and public keys, wherever they sit, and event signatures", () => {
    expect(
      redactor.value({
        id: "REDACTED-TEST-VALUE",
        publicKey: "pk_test_0123456789abcdef",
        authorization: { authorization_code: "AUTH_reusable" },
        reference: "order-1",
      }),
    ).toEqual({
      id: "sk_test_[redacted]",
      publicKey: "pk_test_[redacted]",
      // A saved card's authorization charges it again, so the whole object is hidden.
      authorization: "[redacted]",
      reference: "order-1",
    })
    expect(redactor.headers({ "x-paystack-signature": "9f86d0", accept: "*/*" })).toEqual({
      "x-paystack-signature": "[redacted]",
      accept: "*/*",
    })
  })

  it("clips long strings and long lists in recorded state", () => {
    const value = z.object({ blob: z.string(), items: z.array(z.unknown()) }).parse(
      redactor.value({
        blob: "x".repeat(2_000),
        items: Array.from({ length: 150 }, (_, i) => i),
      }),
    )

    expect(value.blob).toMatch(/^x{500}… \(2000 chars\)$/)
    expect(value.items).toHaveLength(101)
    expect(value.items.at(-1)).toBe("… 50 more")
  })
})

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-record-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A session's flight with one failed step, as `runAttempt` hands it over. */
function flight(): SessionFlight {
  const ledger = new SecretVault({ password: PASSWORD })

  return {
    steps: () => [
      {
        id: "s0",
        index: 0,
        kind: "locator",
        api: "locator.fill",
        label: `getByLabel("Password") ${PASSWORD}`,
        status: "failed",
        startedAt: "2026-10-17T00:00:00.000Z",
        durationMs: 10,
        events: [],
      },
    ],
    appLog: () => [],
    screenshots: () => new Map([[0, "screenshots/001-step-0.png"]]),
    redact: ledger.redact,
    captureFailure: () => Promise.resolve(undefined),
    settle: () => Promise.resolve(),
  }
}

function exchange(over: Partial<Exchange>): Exchange {
  return {
    id: "e1",
    host: "api.stripe.com",
    method: "POST",
    path: "/v1/customers",
    disposition: "routed",
    startedAt: "2026-10-17T00:00:00.000Z",
    status: 200,
    durationMs: 3,
    aborted: false,
    fault: null,
    ...over,
  }
}

/** A record of a run that made no exchanges. */
function buildEmptyRecord() {
  return buildRecord(input(environment([])))
}

function environment(exchanges: Exchange[]): WorkerEnvironment {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the recorder reads only the exchange log
  const proxy = { exchanges: () => exchanges, sockets: () => [] } as unknown as Proxy

  return {
    proxy,
    state: () => ({ stripe: { customers: [{ email: "qa@danwo.test", secret: PASSWORD }] } }),
    close: () => Promise.resolve(),
  }
}

function input(env: WorkerEnvironment, mark = { exchanges: 0, deliveries: 0 }): RecordInput {
  return {
    test: "tests/sign-in.danwo.ts › signs in",
    run: { kind: "test", attempt: 1 },
    status: "failed",
    error: { code: "EXPECTATION_FAILED", class: "test", name: "AssertionError", message: "nope" },
    stopped: undefined,
    divergence: undefined,
    notes: [`saw ${PASSWORD}`],
    durationMs: 10,
    flight: { session: flight(), failure: undefined, startedAt: "2026-10-17T00:00:00.000Z" },
    env,
    mark,
  }
}

describe("flight records", () => {
  it("keeps a run's own calls, redacted in headers, bodies, paths, notes and state", () => {
    const env = environment([
      exchange({ id: "before", path: "/v1/earlier" }),
      exchange({
        path: `/v1/customers?token=${PASSWORD}`,
        request: {
          headers: {
            authorization: "Bearer sk_test_123456",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `email=qa%40danwo.test&password=${PASSWORD}`,
          bytes: 60,
          truncated: false,
        },
        response: {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "cus_1", note: `pw ${PASSWORD}` }),
          bytes: 40,
          truncated: false,
        },
      }),
    ])
    const record = buildRecord(input(env, { exchanges: 1, deliveries: 0 }))
    const text = JSON.stringify(record)

    expect(record.exchanges.map((e) => e.id)).toEqual(["e1"])
    expect(record.exchanges[0]?.request?.headers.authorization).toBe("[redacted]")
    expect(record.exchanges[0]?.request?.body).toBe("email=qa@danwo.test&password=[redacted]")
    expect(record.steps[0]?.screenshot).toBe("screenshots/001-step-0.png")
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain("sk_test_123456")
  })

  it("redacts a Graph download link in an exchange path, which only names it with its host", () => {
    const env = environment([
      exchange({ host: "graph.microsoft.com", path: "/download/Gr4ntT0ken?alt=1" }),
    ])
    const record = buildRecord(input(env, { exchanges: 0, deliveries: 0 }))

    expect(record.exchanges[0]?.path).toBe("/download/[redacted]?alt=1")
  })

  it("deletes a passing run's directory under on-failure and keeps it under always", async () => {
    const settings = { runDir: join(root, "run-1"), mode: "on-failure" as const }
    const dir = attemptDir(settings, "tests/a.danwo.ts › passes", "attempt-1")

    await mkdir(join(dir, "screenshots"), { recursive: true })
    await writeFile(join(dir, "screenshots", "001-step-0.png"), "")

    expect(await finishRecord(dir, "on-failure", false, buildEmptyRecord)).toBeUndefined()
    expect(existsSync(dir)).toBe(false)

    expect(await finishRecord(dir, "always", false, buildEmptyRecord)).toBeDefined()
    expect(await readdir(dir)).toEqual(expect.arrayContaining(["record.json", "timeline.jsonl"]))

    const timeline = (await readFile(join(dir, "timeline.jsonl"), "utf8")).trim().split("\n")

    expect(JSON.parse(timeline[0] ?? "{}")).toMatchObject({ type: "step", api: "locator.fill" })
  })

  it("writes a run's HTML report over its records, and removes a run that kept nothing", async () => {
    const runs = join(root, ".danwo", "runs")
    const kept = join(runs, "20261017-000001-aaaa")
    const empty = join(runs, "20261017-000002-bbbb")
    const record: FlightRecord = buildRecord(input(environment([exchange({})])))

    await finishRecord(join(kept, "test", "attempt-1"), "on-failure", true, () => record)
    await mkdir(empty, { recursive: true })

    const report = await finishRun(kept)
    const html = await readFile(report ?? "", "utf8")

    expect(html).toContain("tests/sign-in.danwo.ts › signs in")
    expect(html).toContain("POST api.stripe.com/v1/customers")
    expect(html).toContain('src="test/attempt-1/screenshots/001-step-0.png"')
    expect(html).not.toContain(PASSWORD)
    expect(await finishRun(empty)).toBeUndefined()
    expect(existsSync(empty)).toBe(false)
    expect(await findRun(runs)).toBe(kept)
  })
})
