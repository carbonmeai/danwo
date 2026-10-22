import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { resendInbox } from "@danwo/emulators"
import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { appEnvironment, startApp } from "../src/runner/app-environment.ts"
import { clerkService } from "../src/runner/clerk.ts"
import { resendService } from "../src/runner/resend.ts"
import { stackEnvironment } from "../src/runner/stack-environment.ts"

const APP = fileURLToPath(new URL("./fixtures/mail-app.ts", import.meta.url))
const COMPOSE = fileURLToPath(new URL("./fixtures/compose-stand-in.ts", import.meta.url))

/** The stand-in for `docker compose`, run as `mode` (`up`, `down` or `hang`). */
const compose = (mode: string) => `"${process.execPath}" "${COMPOSE}" ${mode}`

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

  it("keeps the proxy's quoted Bun preload ahead of the app's own BUN_OPTIONS", async () => {
    const command = await appCommand({ BUN_OPTIONS: "--smol" })
    const app = await startApp(command, {
      ...process.env,
      BUN_OPTIONS: '"--preload=/Users/Jane Doe/preload.mjs"',
    })

    try {
      const env = z
        .record(z.string(), z.string())
        .parse(await (await fetch(`${command.url}/env`)).json())

      expect(env.BUN_OPTIONS).toBe('"--preload=/Users/Jane Doe/preload.mjs" --smol')
    } finally {
      await app.stop()
    }
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

describe("a command that starts a service and returns, as docker compose up --wait does", () => {
  const dir = mkdtempSync(join(tmpdir(), "danwo-compose-"))
  const pidFile = join(dir, "server.pid")

  afterAll(() => {
    try {
      process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL")
    } catch {
      /* Stopped by its test, as it should be. */
    }

    rmSync(dir, { recursive: true, force: true })
  })

  /** A command that is ready once it exits, with no stop command. */
  async function returning(command: string, timeoutMs = 20_000) {
    return {
      ...(await appCommand({ STAND_IN_PID_FILE: pidFile })),
      command,
      ready: { exit: true },
      timeoutMs,
    }
  }

  /** The stand-in for compose, run as `mode`, with `down` as its stop command. */
  async function service(mode: string, timeoutMs = 20_000) {
    return { ...(await returning(compose(mode), timeoutMs)), stop: compose("down") }
  }

  it("is ready once it exits 0, is not down for having exited, and its stop command runs", async () => {
    const command = await service("up")
    const app = await startApp(command)

    try {
      expect(await (await fetch(command.url)).text()).toBe("up")
      expect(app.exited()).toBeUndefined()
      expect(app.logs().lines).toContain("Container web Healthy")
    } finally {
      await app.stop()
    }

    expect(app.logs().lines).toContain("Container web Removed")
    await expect(fetch(command.url)).rejects.toThrow("fetch failed")
  })

  it("reads no input, so a command that would wait on stdin goes on", async () => {
    const app = await startApp(await returning("cat"))

    expect(app.exited()).toBeUndefined()
    await app.stop()
  })

  it("times out naming its last output, and still runs its stop command", async () => {
    const command = await service("hang", 1_500)

    await expect(startApp(command)).rejects.toThrow(
      "the app was not ready (its command exited with code 0) within 1.5 s; its last output:\nContainer web Creating\nContainer web Waiting",
    )
    expect(existsSync(pidFile)).toBe(false)
    await expect(fetch(command.url)).rejects.toThrow("fetch failed")
  })

  it("says when it printed nothing at all", async () => {
    await expect(startApp(await returning("sleep 30", 1_000))).rejects.toThrow(
      "within 1 s; its last output:\n(it printed nothing)",
    )
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

  it("hands Resend's mail on, so the mail fixture reads what the app sent", async () => {
    const env = await appEnvironment({ app: await appCommand(), services: [resendService()] })

    try {
      expect((await fetch(`${env.baseUrl}/signup`, { method: "POST" })).status).toBe(200)
      expect(env.mail).toHaveLength(1)
      expect(env.mail?.[0]?.latest("ada@example.com")).toMatchObject({ subject: "Welcome" })
    } finally {
      await env.close()
    }
  }, 30_000)

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

describe("an app process that misses the proxy", () => {
  /* NO_PROXY naming every host sends the app's calls around the proxy, as an old Node would. */
  const unrouted = { NO_PROXY: "*", no_proxy: "*" }

  it("refuses the run while unmatched hosts are blocked, naming the process and its Node", async () => {
    await expect(
      appEnvironment({ app: await appCommand(unrouted), unmatched: "block" }),
    ).rejects.toThrow(
      new RegExp(`danwo refuses the run.*\\nprocess \\d+ .*runs Node ${process.version}`),
    )
  }, 30_000)

  it("refuses a stack's run when live secrets fail it", async () => {
    await expect(
      stackEnvironment({
        apps: [{ name: "web", ...(await appCommand(unrouted)) }],
        secrets: "fail",
      }),
    ).rejects.toThrow(`runs Node ${process.version}`)
  }, 30_000)

  it("otherwise runs, with the problem in the run's notes", async () => {
    const env = await appEnvironment({ app: await appCommand(unrouted) })

    try {
      expect(env.notes?.()).toEqual([
        expect.stringMatching(/do not go through danwo's proxy .*would reach the real providers/),
      ])
    } finally {
      await env.close()
    }
  }, 30_000)
})
