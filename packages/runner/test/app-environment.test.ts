import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

import { resendInbox } from "@danwo/emulators"
import { describe, expect, it } from "vitest"

import { appEnvironment, startApp } from "../src/runner/app-environment.ts"
import { clerkService } from "../src/runner/clerk.ts"
import { resendService } from "../src/runner/resend.ts"
import { stackEnvironment } from "../src/runner/stack-environment.ts"

const APP = fileURLToPath(new URL("./fixtures/mail-app.ts", import.meta.url))

/** A port nothing listens on. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address()

      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

async function appCommand(env: Record<string, string> = {}) {
  const port = await freePort()

  return {
    command: `"${process.execPath}" "${APP}"`,
    url: `http://127.0.0.1:${port}`,
    env,
    timeoutMs: 20_000,
  }
}

describe("startApp", () => {
  it("starts the command on the URL's port and stops it", async () => {
    const command = await appCommand()
    const app = await startApp(command)

    expect(await (await fetch(command.url)).text()).toBe("proxied: no")
    await app.stop()
    await expect(fetch(command.url)).rejects.toThrow("fetch failed")
  })

  it("says how the app died, with its output, when it exits before answering", async () => {
    await expect(startApp(await appCommand({ MAIL_APP_CRASH: "1" }))).rejects.toThrow(
      /exited with code 3 before .* answered\nmail app: missing configuration/,
    )
  })

  it("refuses to start when something already answers at the URL", async () => {
    const command = await appCommand()
    const running = await startApp(command)

    try {
      await expect(startApp(command)).rejects.toThrow(
        `something already answers at ${command.url}: stop it`,
      )
    } finally {
      await running.stop()
    }
  })
})

describe("appEnvironment", () => {
  it("starts the app through the proxy, so its calls to Resend reach the emulator", async () => {
    const command = await appCommand()
    const resend = resendService()
    const env = await appEnvironment({ app: command, services: [resend] })
    const inbox = resendInbox(resend.emulator)

    try {
      expect(env.baseUrl).toBe(command.url)
      expect(env.fixtures?.["resend"]).toBe(resend.emulator)
      expect(await (await fetch(command.url)).text()).toBe("proxied: yes")
      expect((await fetch(`${command.url}/signup`, { method: "POST" })).status).toBe(200)
      expect(inbox.latest("ada@example.com")).toMatchObject({ subject: "Welcome" })

      await env.reset?.()
      expect(inbox.list()).toEqual([])
    } finally {
      await env.close()
    }

    await expect(fetch(command.url)).rejects.toThrow("fetch failed")
  }, 30_000)

  it("tests an app that already runs at a URL, starting nothing", async () => {
    const env = await appEnvironment({ app: "http://127.0.0.1:9", services: [] })

    try {
      expect(env.baseUrl).toBe("http://127.0.0.1:9")
      expect(env.proxy).toBeDefined()
    } finally {
      await env.close()
    }
  })

  it("hands the services' mail sources on, so the mail fixture reads Clerk's codes", async () => {
    const env = await appEnvironment({ services: [clerkService()] })

    try {
      expect(env.mail).toHaveLength(1)
    } finally {
      await env.close()
    }
  })

  it("hands a stack's services' mail sources on too", async () => {
    const command = await appCommand()
    const env = await stackEnvironment({
      apps: [{ name: "web", ...command }],
      services: [clerkService()],
    })

    try {
      expect(env.mail).toHaveLength(1)
      expect(env.fixtures?.["apps"]).toEqual({ web: command.url })
    } finally {
      await env.close()
    }
  }, 30_000)

  it("closes the services when the app fails to start", async () => {
    await expect(
      appEnvironment({
        app: await appCommand({ MAIL_APP_CRASH: "1" }),
        services: [resendService()],
      }),
    ).rejects.toThrow("exited with code 3")
  })
})
