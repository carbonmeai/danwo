import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createEmulator,
  type Emulator,
  google,
  microsoft,
  seedGoogle,
  seedMicrosoft,
} from "@danwo/emulators"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { chooseAccount } from "../src/account-target.ts"
import { withEnvValue } from "../src/env-file.ts"
import { loginCommand, type LoginOptions } from "../src/login.ts"

const CLIENT = { id: "fidelity-login-client", secret: "fidelity-login-secret" }

let root: string
let emulator: Emulator | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-login-"))
})

afterEach(async () => {
  await emulator?.close()
  emulator = undefined
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** A port nothing listens on yet. */
async function freePort(): Promise<number> {
  const server = createServer()

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))

  const address = server.address()

  await new Promise<void>((resolve) => server.close(() => resolve()))

  return typeof address === "object" && address !== null ? address.port : 0
}

function googleEmulator(redirect: string, email = "tester@gmail.com"): Emulator {
  const created = createEmulator(google)

  seedGoogle(created.store, {
    users: [{ email, name: "Tester" }],
    oauth_clients: [
      {
        client_id: CLIENT.id,
        client_secret: CLIENT.secret,
        name: "Login",
        redirect_uris: [redirect],
      },
    ],
  })

  return created
}

/** A browser that picks `email` on the emulator's consent page and follows it back home. */
function browserChoosing(
  target: Emulator,
  email: string,
  rewrite: (location: URL) => URL = (location) => location,
): (url: string) => Promise<void> {
  return async (url) => {
    const location = rewrite(
      new URL(await chooseAccount((request) => target.fetch(request), url, email)),
    )

    await fetch(location)
  }
}

async function run(options: Partial<LoginOptions> & Pick<LoginOptions, "provider" | "env">) {
  const lines: string[] = []
  const code = await loginCommand({
    root,
    write: (line) => lines.push(line),
    timeoutMs: 10_000,
    ...(emulator !== undefined && { fetch: (request: Request) => emulator!.fetch(request) }),
    ...options,
  })

  return { code, output: lines.join("\n") }
}

describe("danwo fidelity login", () => {
  it("signs a Google account in and keeps only its refresh token, the rest of the file as it was", async () => {
    const redirect = `http://localhost:${await freePort()}/settings/integrations/google-verify`

    emulator = googleEmulator(redirect)
    await writeFile(
      join(root, ".env.fidelity"),
      "# sandbox keys\nDANWO_FIDELITY_STRIPE_KEY=sk_test_kept\n",
    )

    const { code, output } = await run({
      provider: "google",
      env: {
        DANWO_FIDELITY_GOOGLE_CLIENT_ID: CLIENT.id,
        DANWO_FIDELITY_GOOGLE_CLIENT_SECRET: CLIENT.secret,
        DANWO_FIDELITY_GOOGLE_REDIRECT_URI: redirect,
      },
      openBrowser: browserChoosing(emulator, "tester@gmail.com"),
    })
    const file = await readFile(join(root, ".env.fidelity"), "utf8")
    const token = /^DANWO_FIDELITY_GOOGLE_REFRESH_TOKEN=(.+)$/m.exec(file)?.[1] ?? ""

    expect(code).toBe(0)
    expect(file.startsWith("# sandbox keys\nDANWO_FIDELITY_STRIPE_KEY=sk_test_kept\n")).toBe(true)
    expect(token).not.toBe("")
    expect(output).toContain("for tester@gmail.com")
    expect(output).toContain("https://www.googleapis.com/auth/drive.file")
    expect(output).not.toContain(token)
    /* Windows keeps no POSIX permission bits: every writable file reads as 0o666 there. */
    expect((await stat(join(root, ".env.fidelity"))).mode & 0o777).toBe(
      process.platform === "win32" ? 0o666 : 0o600,
    )
  })

  it("signs a Microsoft account in through its tenant", async () => {
    const redirect = `http://127.0.0.1:${await freePort()}/callback`

    emulator = createEmulator(microsoft)
    seedMicrosoft(emulator, {
      users: [{ email: "tester@outlook.com", name: "Tester" }],
      oauth_clients: [
        {
          client_id: CLIENT.id,
          client_secret: CLIENT.secret,
          name: "Login",
          redirect_uris: [redirect],
        },
      ],
    })

    const { code, output } = await run({
      provider: "microsoft",
      redirectUri: redirect,
      env: {
        DANWO_FIDELITY_MICROSOFT_CLIENT_ID: CLIENT.id,
        DANWO_FIDELITY_MICROSOFT_CLIENT_SECRET: CLIENT.secret,
      },
      openBrowser: browserChoosing(emulator, "tester@outlook.com"),
    })

    expect(output).toContain("for tester@outlook.com")
    expect(code).toBe(0)
    expect(await readFile(join(root, ".env.fidelity"), "utf8")).toMatch(
      /^DANWO_FIDELITY_MICROSOFT_REFRESH_TOKEN=\S+$/m,
    )
  })

  it("refuses a redirect whose state is not this sign-in's, and writes nothing", async () => {
    const redirect = `http://127.0.0.1:${await freePort()}/callback`

    emulator = googleEmulator(redirect)

    const { code, output } = await run({
      provider: "google",
      redirectUri: redirect,
      env: {
        DANWO_FIDELITY_GOOGLE_CLIENT_ID: CLIENT.id,
        DANWO_FIDELITY_GOOGLE_CLIENT_SECRET: CLIENT.secret,
      },
      openBrowser: browserChoosing(emulator, "tester@gmail.com", (location) => {
        location.searchParams.set("state", "forged")

        return location
      }),
    })

    expect(code).toBe(1)
    expect(output).toContain("state does not match")
    await expect(readFile(join(root, ".env.fidelity"), "utf8")).rejects.toThrow("ENOENT")
  })

  it("says the sign-in was cancelled when the person chose Cancel", async () => {
    const port = await freePort()

    const { code, output } = await run({
      provider: "google",
      port,
      env: {
        DANWO_FIDELITY_GOOGLE_CLIENT_ID: CLIENT.id,
        DANWO_FIDELITY_GOOGLE_CLIENT_SECRET: CLIENT.secret,
      },
      openBrowser: async () => {
        await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
      },
    })

    expect(code).toBe(1)
    expect(output).toContain("cancelled")
  })

  it("asks for the app's port to be freed when its dev server holds it", async () => {
    const port = await freePort()
    const app: Server = createServer((_, response) => response.end("the app"))

    await new Promise<void>((resolve) => app.listen(port, "127.0.0.1", () => resolve()))

    try {
      const { code, output } = await run({
        provider: "google",
        redirectUri: `http://localhost:${port}/settings/integrations/google-verify`,
        env: {
          DANWO_FIDELITY_GOOGLE_CLIENT_ID: CLIENT.id,
          DANWO_FIDELITY_GOOGLE_CLIENT_SECRET: CLIENT.secret,
        },
        openBrowser: () => {},
      })

      expect(code).toBe(1)
      expect(output).toContain(`stop the app on :${port} first`)
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()))
    }
  })

  it("names the variables to set when the OAuth client is missing", async () => {
    const { code, output } = await run({ provider: "microsoft", env: {}, openBrowser: () => {} })

    expect(code).toBe(1)
    expect(output).toContain("DANWO_FIDELITY_MICROSOFT_CLIENT_ID")
  })
})

describe("writing .env.fidelity", () => {
  it("replaces a value where it stands and keeps comments and other lines", () => {
    const text = "# keys\nA=1\nDANWO_FIDELITY_GOOGLE_REFRESH_TOKEN=old # minted\nB=2\n"

    expect(withEnvValue(text, "DANWO_FIDELITY_GOOGLE_REFRESH_TOKEN", "new")).toBe(
      "# keys\nA=1\nDANWO_FIDELITY_GOOGLE_REFRESH_TOKEN=new\nB=2\n",
    )
    expect(withEnvValue("A=1", "C", "a b")).toBe('A=1\nC="a b"\n')
  })
})
