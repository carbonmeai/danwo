import { describe, expect, it } from "vitest"

import { clerk, clerkInstance, seedClerk } from "../src/clerk/index.ts"
import { createEmulator } from "../src/define.ts"
import { ManualClock } from "../src/time.ts"
import { frontend } from "./clerk-client.ts"

describe("Clerk's client time in the browser", () => {
  it("never puts `__client_uat` after the session token, when the emulator's clock runs ahead", async () => {
    const time = new ManualClock(new Date())
    const emulator = createEmulator(clerk, { clock: time.clock, wallClock: time.wall })

    seedClerk(emulator.store, {
      instance: { password: false },
      users: [{ email: "ada@danwo.test" }],
    })

    /* `settle` played a webhook retry ten minutes out: the emulator's clock is ahead of the app's. */
    time.advance(10 * 60_000)

    const fapi = frontend(emulator, "http://127.0.0.1:4100")
    const dvb = await fapi.devBrowser()
    const started = await fapi.call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: dvb,
      form: { identifier: "ada@danwo.test", strategy: "email_code" },
    })
    const id = String(fapi.at(started.body, "response", "id"))
    const done = await fapi.call(`/v1/client/sign_ins/${id}/attempt_first_factor`, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "email_code", code: await clerkInstance(emulator).code("ada@danwo.test") },
    })
    const updatedAt = Number(fapi.at(done.body, "client", "updated_at"))
    const jwt = String(fapi.at(done.body, "client", "sessions", 0, "last_active_token", "jwt"))
    const claims: unknown = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString())
    const iat = Number(Reflect.get(Object(claims), "iat"))

    /* ClerkJS copies `updated_at` into `__client_uat`; a later value makes the token outdated. */
    expect(Math.floor(updatedAt / 1000)).toBeLessThanOrEqual(iat)
  })
})
