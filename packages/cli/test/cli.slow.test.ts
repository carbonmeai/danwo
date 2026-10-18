import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import { type FakeGitHub, startFakeGitHub } from "../../github/test/fake-github.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))

let state: string

beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), "danwo-cli-"))
})

afterEach(async () => {
  await rm(state, { recursive: true, force: true })
})

// Failing runs leave flight records beside each fixture's config; they are the tests' own.
afterAll(async () => {
  for (const dir of [
    fixture("basic"),
    fixture("invariant"),
    fixture("uploads"),
    fixture("signin"),
    fixture("integration"),
    fixture("slack-bot"),
    fixture("github-bot"),
    fixture("sms-app"),
    fixture("flutterwave-shop"),
    fixture("naira-shop"),
    fixture("bachs-store"),
    fixture("sessions"),
    fixture("visual"),
    SHOP,
  ])
    await rm(join(dir, ".danwo"), { recursive: true, force: true })
  await rm(join(fixture("visual"), "tests", "__screenshots__"), { recursive: true, force: true })
})

/** Runs `danwo <args>` under Node in `cwd`; resolves to its exit code and output. */
function danwo(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", DANWO_FIXTURE_STATE: state, ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

/** An Actions job's environment for the GitHub reporter, against `fake`, checked out at `workspace`. */
function actionsEnv(fake: FakeGitHub, workspace: string): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_API_URL: fake.url,
    GITHUB_SERVER_URL: "https://github.example",
    GITHUB_REPOSITORY: "acme/app",
    GITHUB_SHA: "abc123",
    GITHUB_RUN_ID: "9",
    GITHUB_TOKEN: "ghs_cli_test",
    GITHUB_WORKSPACE: workspace,
    GITHUB_STEP_SUMMARY: join(state, "step-summary.md"),
  }
}

type CheckBody = {
  name?: string
  conclusion?: string
  output?: { title: string; summary: string; annotations: { path: string; title: string }[] }
}

const bodyOf = (fake: FakeGitHub, at: number) => fake.requests.at(at)?.body as CheckBody | undefined

describe("danwo spec and danwo guide", () => {
  it("prints the spec, one topic of it, and its JSON, with the CLI's own commands", async () => {
    const cwd = fixture("invariant")
    const cli = await danwo(cwd, ["spec", "--topic", "cli"])

    expect(cli.code).toBe(0)
    expect(cli.out).toContain("## Commands [cli]")
    expect(cli.out).toContain("matrix (command): danwo matrix <file>")
    expect(cli.out).toContain("-f, --faults <regexp>")

    const json = await danwo(cwd, ["spec", "--json"])
    const parsed: unknown = JSON.parse(json.out)

    expect(parsed).toHaveProperty("sections")

    const unknown = await danwo(cwd, ["spec", "--topic", "nope"])

    expect(unknown.code).toBe(1)
    expect(unknown.out).toContain('unknown spec topic "nope"')
  })

  it("lists the guides and prints one", async () => {
    const cwd = fixture("invariant")
    const list = await danwo(cwd, ["guide"])

    expect(list.code).toBe(0)
    expect(list.out).toMatch(/^first-test {2}/)
    expect((await danwo(cwd, ["guide", "secrets"])).out).toMatch(/^# Secrets/)
  })
})

describe("danwo test", () => {
  it("runs files across two workers, retries, reports, and exits 1 on a failure", async () => {
    const { code, out } = await danwo(fixture("basic"), [
      "test",
      "--workers",
      "2",
      "--retries",
      "1",
    ])

    expect(out).toContain("Running 4 tests with 2 workers")
    expect(out).toMatch(/✓ tests\/pass\.danwo\.ts › page › shows the heading \d+ ms, worker \d/)
    expect(out).toMatch(/✓ tests\/pass\.danwo\.ts › page › sees the worker's fixture/)
    expect(out).toMatch(/~ tests\/flaky\.danwo\.ts › passes on its retry \(2 attempts\)/)
    expect(out).toMatch(/✗ tests\/fail\.danwo\.ts › fails its assertion \(2 attempts\)/)
    expect(out).toContain("2 passed, 1 flaky, 1 failed")
    expect(out).toContain("worker 0")
    expect(out).toContain("worker 1")
    expect(code).toBe(1)
  }, 120_000)

  it("reports to GitHub as a check run with an annotation per failing or flaky test", async () => {
    const fake = await startFakeGitHub()

    try {
      const { code } = await danwo(
        fixture("basic"),
        ["test", "--retries", "1", "--reporter", "github"],
        actionsEnv(fake, fixture("basic")),
      )

      expect(code).toBe(1)
      expect(fake.requests.map((r) => r.method)).toEqual(["POST", "PATCH"])
      expect(bodyOf(fake, 0)?.name).toBe("danwo")
      expect(bodyOf(fake, -1)?.conclusion).toBe("failure")
      expect(bodyOf(fake, -1)?.output?.title).toBe("2 passed · 1 failed · 1 flaky · 0 skipped")
      expect(bodyOf(fake, -1)?.output?.annotations.map((a) => [a.path, a.title])).toEqual(
        expect.arrayContaining([
          ["tests/fail.danwo.ts", "tests/fail.danwo.ts › fails its assertion"],
          ["tests/flaky.danwo.ts", "flaky: tests/flaky.danwo.ts › passes on its retry"],
        ]),
      )
      expect(await readFile(join(state, "step-summary.md"), "utf8")).toContain(
        "### danwo test: 2 passed · 1 failed · 1 flaky · 0 skipped",
      )
    } finally {
      await fake.close()
    }
  }, 120_000)

  it("narrows with --grep and exits 0 when everything passes", async () => {
    const { code, out } = await danwo(fixture("basic"), ["test", "--grep", "heading"])

    expect(out).toContain("Running 1 test with 1 worker")
    expect(out).toContain("1 passed")
    expect(code).toBe(0)
  }, 60_000)

  it("runs two browser tests at the same time in different workers", async () => {
    const { code, out } = await danwo(fixture("concurrent"), ["test", "--workers", "2"])
    const workers = [...out.matchAll(/✓ .* worker (\d)/g)].map((match) => match[1])

    expect(out).toContain("2 passed")
    expect(new Set(workers)).toEqual(new Set(["0", "1"]))
    expect(code).toBe(0)
  }, 60_000)

  it("fails a test whose body passes but whose invariant does not", async () => {
    const { code, out } = await danwo(fixture("invariant"), ["test", "tests/invariant.danwo.ts"])

    expect(out).toContain("✗ tests/invariant.danwo.ts › passes its body but not its invariant")
    expect(out).toContain("invariant: expected 2 to be 3")
    expect(code).toBe(1)
  }, 60_000)

  it("runs the shop example against a Stripe emulator per worker", async () => {
    const { code, out } = await danwo(SHOP, ["test"])

    expect(out).toContain("✓ tests/buy-credits.danwo.ts › buys 500 credits through Stripe Checkout")
    expect(out).toContain("2 passed")
    expect(code).toBe(0)
  }, 120_000)
})

/** Every `record.json` under `dir`'s flight records, as text. */
async function recordsUnder(dir: string): Promise<string[]> {
  const runs = join(dir, ".danwo", "runs")
  const files = (await readdir(runs, { recursive: true })).filter((path) =>
    path.endsWith("record.json"),
  )

  return Promise.all(files.map((path) => readFile(join(runs, path), "utf8")))
}

describe("danwo test with saved sessions", () => {
  it("signs in once, reuses it, sets it up again when the app ends it, and never records it", async () => {
    const { code, out } = await danwo(fixture("sessions"), [
      "test",
      "tests/notes.danwo.ts",
      "--record",
      "always",
    ])

    expect(out).toContain("4 passed")
    expect(code).toBe(0)

    const records = (await recordsUnder(fixture("sessions"))).join("\n")

    expect(records).toMatch(/session ada: created \(\d+ steps\)/)
    expect(records).toContain("session ada: reused")
    expect(records).toMatch(/session ada: renewed \(\d+ steps\)/)

    // Neither a session id the app issued nor the password ever reaches a record.
    const sids = (await readFile(join(state, "sids.txt"), "utf8")).split("\n").filter(Boolean)

    expect(sids.length).toBe(2)
    for (const sid of sids) expect(records).not.toContain(sid)
    expect(records).not.toContain("pw-ada-fixture")
  }, 120_000)

  it("fails every test whose session cannot be set up, naming the session", async () => {
    const { code, out } = await danwo(fixture("sessions"), ["test", "tests/broken.danwo.ts"])

    expect(out.match(/session "intruder" could not be set up/g)).toHaveLength(2)
    expect(out).toContain("2 failed")
    expect(code).toBe(1)
  }, 120_000)

  it("signs in again in every matrix trial, since each starts a fresh app", async () => {
    const { code, out } = await danwo(fixture("sessions"), [
      "matrix",
      "tests/notes.danwo.ts",
      "--grep",
      "saves a note",
    ])

    // The invariant also checks the trial's fresh app was signed into exactly once.
    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  status 503 on PUT danwo-notes.t3.storage.dev/notes/:id")
    expect(out).toContain("faults: 4 passed")
    expect(code).toBe(0)
  }, 180_000)
})

describe("danwo test with screenshots", () => {
  it("writes a baseline, fails on a change with images in the report, and updates on request", async () => {
    const baseline = join(
      fixture("visual"),
      "tests/__screenshots__/badge.danwo.ts/badge-looks-right/badge.png",
    )

    await rm(join(fixture("visual"), "tests", "__screenshots__"), { recursive: true, force: true })

    const first = await danwo(fixture("visual"), ["test"])

    expect(first.out).toContain("1 passed")
    expect((await readFile(baseline)).length).toBeGreaterThan(0)

    const changed = await danwo(fixture("visual"), ["test"], { DANWO_BADGE_COLOUR: "#aa2255" })
    const report = /report: (.+\.html)/.exec(changed.out)?.[1]

    expect(changed.code).toBe(1)
    expect(changed.out).toMatch(
      /toHaveScreenshot\("badge"\) failed: \d+ pixels \(100\.00%\) differ/,
    )
    expect(report).toBeDefined()

    const html = await readFile(join(fixture("visual"), report ?? ""), "utf8")

    expect(html).toContain("compare-1-baseline.png")
    expect(html).toContain("compare-1-actual.png")
    expect(html).toContain("compare-1-diff.png")

    const updated = await danwo(fixture("visual"), ["test", "--update-snapshots"], {
      DANWO_BADGE_COLOUR: "#aa2255",
    })

    expect(updated.code).toBe(0)

    const after = await danwo(fixture("visual"), ["test"], { DANWO_BADGE_COLOUR: "#aa2255" })

    expect(after.code).toBe(0)
  }, 120_000)
})

describe("danwo matrix", () => {
  it("records a clean run, replays it once per fault, and judges broken bodies by the invariant", async () => {
    const { code, out } = await danwo(SHOP, ["matrix", "tests/buy-credits.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toMatch(/clean run passed; \d+ faults planned/)
    expect(out).toContain("the test's invariant judges them")
    // Checkout never opens: the body stops there, and no payment means no credits, as it should.
    expect(out).toMatch(
      /PASS {2}status 500 on GET checkout\.stripe\.com\/checkout\/:id\n {8}body stopped at tests\/buy-credits\.danwo\.ts:\d+: expect\(getByTestId\("checkout-total"\)\)\.toContainText\("\$5\.00"\) failed/,
    )
    expect(out).toContain("PASS  reset-after on POST checkout.stripe.com/checkout/:id/complete")
    expect(out).toContain("PASS  duplicate on webhook checkout.session.completed")
    expect(out).toMatch(/faults: \d+ passed\n/)
    expect(code).toBe(0)
  }, 300_000)

  it("catches a shop that grants credits twice for a duplicated webhook", async () => {
    const fake = await startFakeGitHub()
    const { code, out } = await danwo(
      SHOP,
      ["matrix", "tests/buy-credits.danwo.ts", "--reporter", "github"],
      { SHOP_BUG: "no-dedupe", ...actionsEnv(fake, join(SHOP, "..", "..")) },
    )

    await fake.close()

    expect(out).toContain("FAIL  duplicate on webhook checkout.session.completed")
    expect(out).toContain("invariant: expected 1000 to be 500")
    expect(out).toContain("faults: 14 passed, 1 failed")
    expect(code).toBe(1)

    // Only the failed run is kept, and the run's report shows why it failed.
    expect(out.match(/record: \.danwo\/runs\//g)).toHaveLength(1)
    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(SHOP, report), "utf8")

    expect(html).toContain("duplicate on webhook checkout.session.completed")
    expect(html).toContain("invariant: expected 1000 to be 500")
    expect(html).toContain("Webhook deliveries")
    expect(html).toMatch(
      /<code>checkout\.session\.completed<\/code>[^]*?<span class="fault">duplicate<\/span>/,
    )
    expect(html).toContain("POST api.stripe.com/v1/checkout/sessions")
    expect(html).not.toMatch(/sk_test_danwo_example|whsec_danwo_example/)

    // The GitHub check: failed, with the duplicate annotated in the test file, and no secrets.
    expect(bodyOf(fake, 0)?.name).toBe("danwo matrix")
    expect(bodyOf(fake, -1)?.conclusion).toBe("failure")
    expect(bodyOf(fake, -1)?.output?.title).toBe("faults: 14 passed · 1 failed")
    expect(bodyOf(fake, -1)?.output?.annotations).toEqual([
      expect.objectContaining({
        path: "examples/shop/tests/buy-credits.danwo.ts",
        title: "failed: duplicate on webhook checkout.session.completed",
      }),
    ])
    expect(bodyOf(fake, -1)?.output?.summary).toContain(
      "| ❌ | duplicate on webhook checkout.session.completed |",
    )
    expect(JSON.stringify(fake.requests)).not.toMatch(/sk_test_danwo_example|whsec_danwo_example/)
  }, 300_000)

  it("runs on an app with no webhook services, planning outbound faults only", async () => {
    const { code, out } = await danwo(fixture("uploads"), ["matrix", "tests/upload.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toMatch(/clean run passed; \d+ faults planned/)
    expect(out).toContain("PASS  status 503 on PUT danwo-uploads.t3.storage.dev/uploads/report.txt")
    expect(out).toContain(
      "PASS  reset-after on PUT danwo-uploads.t3.storage.dev/uploads/report.txt",
    )
    expect(out).not.toContain("webhook")
    expect(code).toBe(0)
  }, 120_000)

  it("signs in with Google through the emulator and judges token-endpoint faults by the invariant", async () => {
    const { code, out } = await danwo(fixture("signin"), ["matrix", "tests/sign-in.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  status 500 on POST oauth2.googleapis.com/token")
    expect(out).toContain("PASS  status 400 on POST oauth2.googleapis.com/token")
    expect(out).toContain("PASS  reset-after on POST oauth2.googleapis.com/token")
    // The browser's account chooser on accounts.google.com is never faulted.
    expect(out).not.toContain("accounts.google.com")
    expect(out).toContain("faults: 6 passed")
    expect(code).toBe(0)
  }, 180_000)

  it("faults Gmail's push like a webhook, and a deduplicating integration survives it", async () => {
    const { code, out } = await danwo(fixture("integration"), [
      "matrix",
      "tests/inbox-sync.danwo.ts",
    ])

    expect(out).toContain("PASS  clean run")
    // Only the test's own calls are planned: the app's watch at start-up is not.
    expect(out).not.toContain("users/me/watch")
    expect(out).toContain("PASS  status 404 on GET gmail.googleapis.com/gmail/v1/users/me/history")
    expect(out).toContain(
      "PASS  duplicate on google webhook pubsub:projects/inbox-sync/subscriptions/gmail-push",
    )
    expect(out).toContain(
      "PASS  forged on google webhook pubsub:projects/inbox-sync/subscriptions/gmail-push",
    )
    expect(out).toContain("faults: 24 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches an integration that lists a message twice when its push comes twice", async () => {
    const { code, out } = await danwo(
      fixture("integration"),
      ["matrix", "tests/inbox-sync.danwo.ts"],
      { INTEGRATION_BUG: "no-dedupe" },
    )

    expect(out).toContain(
      "FAIL  duplicate on google webhook pubsub:projects/inbox-sync/subscriptions/gmail-push",
    )
    expect(out).toContain(
      "FAIL  forged on google webhook pubsub:projects/inbox-sync/subscriptions/gmail-push",
    )
    expect(out).toContain("invariant: expected 2 to be 1")
    expect(out).toContain("faults: 22 passed, 2 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("integration"), report), "utf8")

    expect(html).toContain("POST gmail.googleapis.com/gmail/v1/users/me/messages/send")
    expect(html).not.toMatch(/GOCSPX-integration-fixture|ya29\.[A-Za-z0-9]/)
  }, 300_000)

  it("faults a Slack bot's mention event and a deduplicating bot replies at most once", async () => {
    const { code, out } = await danwo(fixture("slack-bot"), ["matrix", "tests/mention.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  status 429 on POST slack.com/api/chat.postMessage")
    expect(out).toContain("PASS  duplicate on slack webhook events:A0MENTIONBOT")
    expect(out).toContain("PASS  forged on slack webhook events:A0MENTIONBOT")
    expect(out).toContain("faults: 11 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a Slack bot that answers a mention twice when its event comes twice", async () => {
    const { code, out } = await danwo(fixture("slack-bot"), ["matrix", "tests/mention.danwo.ts"], {
      SLACK_BUG: "no-dedupe",
    })

    // A forged copy fails the bot's signature check, so only the duplicate gets through twice.
    expect(out).toContain("FAIL  duplicate on slack webhook events:A0MENTIONBOT")
    expect(out).toContain("PASS  forged on slack webhook events:A0MENTIONBOT")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(out).toContain("faults: 10 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("slack-bot"), report), "utf8")

    expect(html).toContain("POST slack.com/api/chat.postMessage")
    expect(html).not.toMatch(/REDACTED-TEST-VALUE|mention-bot-signing-secret/)
  }, 300_000)

  it("faults Twilio Verify, messages and status callbacks, and a careful app counts each welcome once", async () => {
    const { code, out } = await danwo(fixture("sms-app"), ["matrix", "tests/verify.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain(
      "PASS  status 429 on POST verify.twilio.com/v2/Services/:id/Verifications",
    )
    expect(out).toContain(
      "PASS  reset-after on POST api.twilio.com/2010-04-01/Accounts/:id/Messages.json",
    )
    expect(out).toContain("PASS  duplicate on twilio webhook message.status /twilio/status #2")
    expect(out).toContain("PASS  forged on twilio webhook message.status /twilio/status #2")
    expect(out).toContain("faults: 26 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches an app that counts a delivered status callback twice when Twilio sends it twice", async () => {
    const { code, out } = await danwo(fixture("sms-app"), ["matrix", "tests/verify.danwo.ts"], {
      SMS_BUG: "no-dedupe",
    })

    // A forged callback fails the app's signature check; only the repeated "delivered" double counts.
    expect(out).toContain("FAIL  duplicate on twilio webhook message.status /twilio/status #2")
    expect(out).toContain("PASS  forged on twilio webhook message.status /twilio/status #2")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(out).toContain("faults: 25 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("sms-app"), report), "utf8")

    expect(html).toContain("POST verify.twilio.com")
    expect(html).not.toContain("7e57ab1e7e57ab1e7e57ab1e7e57ab1e")
  }, 300_000)

  it("faults Flutterwave Standard end to end, and a careful shop credits each payment once", async () => {
    const { code, out } = await danwo(fixture("flutterwave-shop"), ["matrix", "tests/buy.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  reset-after on POST api.flutterwave.com/v3/payments")
    expect(out).toContain("PASS  status 500 on POST checkout.flutterwave.com/v3/hosted/pay/:id/otp")
    expect(out).toContain("PASS  status 200 on GET api.flutterwave.com/v3/transactions/:id/verify")
    expect(out).toContain("PASS  duplicate on flutterwave webhook charge.completed")
    expect(out).toContain("PASS  forged on flutterwave webhook charge.completed")
    expect(out).toContain("faults: 26 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a shop that credits a charge.completed webhook twice when Flutterwave sends it twice", async () => {
    const { code, out } = await danwo(
      fixture("flutterwave-shop"),
      ["matrix", "tests/buy.danwo.ts"],
      {
        FLW_BUG: "no-dedupe",
      },
    )

    // A forged webhook fails the verif-hash check; only the repeated real one credits twice.
    expect(out).toContain("FAIL  duplicate on flutterwave webhook charge.completed")
    expect(out).toContain("PASS  forged on flutterwave webhook charge.completed")
    expect(out).toContain("invariant: expected 1000 to be less than or equal to 500")
    expect(out).toContain("faults: 25 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("flutterwave-shop"), report), "utf8")

    expect(html).toContain("POST api.flutterwave.com/v3/payments")
    expect(html).not.toMatch(/5150515051505150515051505150|flutterwave-shop-hash/)
  }, 300_000)

  it("pays on Paystack's hosted page with a plain card and with a PIN and OTP card", async () => {
    const { code, out } = await danwo(fixture("naira-shop"), ["test"])

    expect(out).toContain(
      "✓ tests/buy-credits.danwo.ts › buys 500 credits with a card on Paystack's page",
    )
    expect(out).toContain(
      "✓ tests/pin-card.danwo.ts › pays with a card that asks for its PIN and then an OTP",
    )
    expect(code).toBe(0)
  }, 300_000)

  it("faults Paystack calls and charge.success, and a careful shop grants one pack per payment", async () => {
    const { code, out } = await danwo(fixture("naira-shop"), [
      "matrix",
      "tests/buy-credits.danwo.ts",
    ])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  reset-after on POST api.paystack.co/transaction/initialize")
    expect(out).toContain("PASS  status 200 on GET api.paystack.co/transaction/verify/:id")
    expect(out).toContain("PASS  duplicate on paystack webhook charge.success")
    expect(out).toContain("PASS  forged on paystack webhook charge.success")
    expect(out).toContain("faults: 14 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a shop that grants credits twice when Paystack sends charge.success twice", async () => {
    const { code, out } = await danwo(
      fixture("naira-shop"),
      ["matrix", "tests/buy-credits.danwo.ts"],
      { PAYSTACK_BUG: "no-dedupe" },
    )

    // A forged event fails the shop's signature check; only the repeated real one pays out twice.
    expect(out).toContain("FAIL  duplicate on paystack webhook charge.success")
    expect(out).toContain("PASS  forged on paystack webhook charge.success")
    expect(out).toContain(
      'invariant: expect(getByRole("status")).toHaveText("Credits: 500") failed',
    )
    expect(out).toContain("faults: 13 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("naira-shop"), report), "utf8")

    expect(html).toContain("POST api.paystack.co")
    expect(html).not.toContain("4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4a1ra4")
  }, 300_000)

  it("faults Bachs checkout creation and its signed webhooks, and a careful store grants each pack once", async () => {
    const { code, out } = await danwo(fixture("bachs-store"), ["matrix", "tests/credits.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  status 429 on POST sandbox-api.bachs.io/v1/checkout-sessions")
    expect(out).toContain("PASS  reset-after on POST sandbox-api.bachs.io/v1/checkout-sessions")
    expect(out).toContain("PASS  duplicate on bachs webhook collection.succeeded")
    expect(out).toContain("PASS  delay 600000ms on bachs webhook collection.succeeded")
    expect(out).toContain("PASS  forged on bachs webhook collection.succeeded")
    expect(out).toContain("faults: 10 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a store that grants credits twice when Bachs delivers collection.succeeded twice", async () => {
    const { code, out } = await danwo(
      fixture("bachs-store"),
      ["matrix", "tests/credits.danwo.ts"],
      {
        BACHS_BUG: "no-dedupe",
      },
    )

    // A forged delivery fails the SDK's signature check; only the repeated event grants twice.
    expect(out).toContain("FAIL  duplicate on bachs webhook collection.succeeded")
    expect(out).toContain("PASS  forged on bachs webhook collection.succeeded")
    expect(out).toContain(
      'invariant: expect(getByRole("status")).toHaveText("Credits: 500") failed',
    )
    expect(out).toContain("faults: 9 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("bachs-store"), report), "utf8")

    expect(html).toContain("POST sandbox-api.bachs.io/v1/checkout-sessions")
    expect(html).not.toMatch(/sk_sandbox_creditStore|REDACTED-TEST-VALUE/)
  }, 300_000)

  it("faults a GitHub bot's issues webhook and a deduplicating bot comments at most once", async () => {
    const { code, out } = await danwo(fixture("github-bot"), ["matrix", "tests/thanks.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain(
      "PASS  status 403 on POST api.github.com/repos/ada/widgets/issues/:id/comments",
    )
    expect(out).toContain("PASS  duplicate on github webhook issues@ada/widgets")
    expect(out).toContain("faults: 12 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a GitHub bot that comments twice when a webhook comes twice", async () => {
    const { code, out } = await danwo(fixture("github-bot"), ["matrix", "tests/thanks.danwo.ts"], {
      GITHUB_BUG: "no-dedupe",
    })

    expect(out).toContain("FAIL  duplicate on github webhook issues@ada/widgets")
    expect(out).toContain("PASS  forged on github webhook issues@ada/widgets")
    expect(out).toContain("faults: 11 passed, 1 failed")
    expect(code).toBe(1)

    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(fixture("github-bot"), report), "utf8")

    expect(html).not.toMatch(/ghp_thanksBot|ghp_adaLovelace|thanks-bot-webhook-secret/)
  }, 300_000)

  it("reports a run whose fault never fired as invalid", async () => {
    const { code, out } = await danwo(fixture("invariant"), ["matrix", "tests/unfired.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("no invariant: the body must pass under every fault")
    expect(out).toContain("INVALID  duplicate on webhook customer.created")
    expect(out).toContain("the fault never fired")
    expect(out).toContain("faults: 4 invalid (fault never fired)")
    expect(code).toBe(1)
  }, 120_000)
})
