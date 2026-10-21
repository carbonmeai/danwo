/**
 * The benchmark's danwo project: the benchmark app behind Stripe, Resend and Slack emulators.
 *
 * - `BENCH_BUGS` (comma separated) starts the app with planted bugs.
 * - `BENCH_MODEL` names the agent's model (a Vercel AI Gateway id) for live runs that record. Without it the
 *   agent gets a model that refuses every call, so agent tests can only pass by replaying their
 *   committed recordings with no model calls.
 */
import { createEmulator, resend } from "@danwo/emulators"
import {
  defineConfig,
  resendMail,
  type Service,
  slackService,
  startServices,
  stripeService,
} from "@danwo/sdk"
import { MockLanguageModelV4 } from "ai/test"

import { type BenchApp, launchBenchApp } from "./app/launch.ts"

const WEBHOOK_SECRET = "whsec_bench"
const BOT_TOKEN = ["xoxb-", "bench-bot"].join("")

/** A model that fails any call: replays that would need the model fail instead of spending. */
const replayOnly = new MockLanguageModelV4({
  provider: "bench",
  modelId: "replay-only",
  doGenerate: () => {
    throw new Error("the benchmark replays recordings: a model call means a recording diverged")
  },
})

/** The Resend emulator as a service: mail lands in its inbox for the `mail` fixture to read. */
function resendService(): Service & { readonly emulator: ReturnType<typeof createEmulator> } {
  const emulator = createEmulator(resend)

  return {
    name: "resend",
    emulator,
    routes: [{ hosts: ["api.resend.com"], handler: emulator.fetch }],
    fixtures: { resend: emulator },
    state: () => emulator.snapshot(),
    reset: () => Promise.resolve(emulator.reset()),
    close: () => emulator.close(),
  }
}

export default defineConfig({
  testDir: "tests",
  workers: 2,
  timeout: 120_000,
  model: process.env.BENCH_MODEL || replayOnly,
  cache: { dir: "recordings" },
  files: { notes: "fixtures/notes.txt" },
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    let app: BenchApp | undefined
    const mail = resendService()
    const services = await startServices([
      stripeService({
        seed: () =>
          app && {
            webhookEndpoints: [
              {
                url: `${app.url}/webhooks/stripe`,
                events: ["checkout.session.completed"],
                secret: WEBHOOK_SECRET,
              },
            ],
          },
      }),
      mail,
      slackService({
        seed: {
          users: [{ name: "ada", real_name: "Ada Lovelace" }],
          apps: [
            {
              name: "Bench Bot",
              app_id: "A0BENCHBOT",
              client_id: "3003.4004",
              client_secret: "bench-bot-client-secret",
              signing_secret: "bench-bot-signing-secret",
              bot_scopes: ["chat:write"],
            },
          ],
          installations: [{ app: "Bench Bot", bot_token: BOT_TOKEN, channels: ["general"] }],
        },
      }),
    ])

    const start = async () => {
      app = await launchBenchApp(
        services.proxy.env({
          ...process.env,
          STRIPE_SECRET_KEY: "sk_test_bench",
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
          RESEND_API_KEY: "re_bench",
          SLACK_BOT_TOKEN: BOT_TOKEN,
        }),
      )
      await services.reset()
    }

    await start()

    return {
      get baseUrl() {
        return app?.url
      },
      proxy: services.proxy,
      webhooks: services.webhooks,
      fixtures: services.fixtures,
      settle: () => services.settle(),
      mail: [resendMail(mail.emulator)],
      state: () => services.state(),
      async reset() {
        await app?.stop()
        await start()
      },
      snapshot: () => services.snapshot(),
      async restore() {
        await services.restore()
        await fetch(`${app?.url ?? ""}/__test/reset`, { method: "POST" })
      },
      async close() {
        await app?.stop()
        await services.close()
      },
    }
  },
})
