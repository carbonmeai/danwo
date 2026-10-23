import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { resendInbox } from "@danwo/emulators"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { appEnvironment, startApp } from "../src/runner/app-environment.ts"
import { clerkService } from "../src/runner/clerk.ts"
import { resendService } from "../src/runner/resend.ts"
import { stackEnvironment } from "../src/runner/stack-environment.ts"
import { freePort } from "../src/support/ports.ts"

const APP = fileURLToPath(new URL("./fixtures/mail-app.ts", import.meta.url))
const PYTHON_APP = fileURLToPath(new URL("./fixtures/mail_app.py", import.meta.url))

/** Whether `python3` runs here, for the app outside Node. */
function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" })

    return true
  } catch {
    return false
  }
}

const COMPOSE = fileURLToPath(new URL("./fixtures/compose-stand-in.ts", import.meta.url))

/** The stand-in for `docker compose`, run as `mode` (`up`, `down` or `hang`). */
const compose = (mode: string) => `"${process.execPath}" "${COMPOSE}" ${mode}`

async function appCommand(env: Record<string, string> = {}) {
  const port = await freePort()

  return {
    command: `"${process.execPath}" "${APP}"`,
    url: `http://127.0.0.1:${port}`,
    env,
    timeoutMs: 20_000,
  }
}

describe("freePort", () => {
  it("names a port on 127.0.0.1 that a server can listen on", async () => {
    const port = await freePort()
    const server = createServer()

    expect(port).toBeGreaterThan(0)
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolve)
    })
    await new Promise((resolve) => server.close(resolve))
  })
})

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

    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    /* `cat`, in Node, so it runs on Windows too: it waits for its input to end. */
    const cat = `"${process.execPath}" -e "process.stdin.on('data', () => {}).on('end', () => process.exit(0))"`
    const app = await startApp(await returning(cat))

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
    const sleep = `"${process.execPath}" -e "setTimeout(() => {}, 30000)"`

    await expect(startApp(await returning(sleep, 1_000))).rejects.toThrow(
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
      /* A Node app's own check ran in its preload: nothing to note. */
      expect(env.notes?.()).toEqual([])

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

  it("starts the app without the proxy's variables, shim or preload with proxy: false", async () => {
    const command = await appCommand({ OWN: "yes" })
    const env = await appEnvironment({ app: command, proxy: false })

    try {
      const seen = await appEnv(env.baseUrl)

      expect(env.baseUrl).toBe(command.url)
      expect(env.proxy).toBeUndefined()
      expect(await (await fetch(command.url)).text()).toBe("proxied: no")
      expect(seen).toMatchObject({ OWN: "yes", PORT: new URL(command.url).port })
      expect(seen.NODE_OPTIONS ?? "").not.toContain("--import=")
      expect(
        Object.keys(seen).filter((name) => /^(HTTPS?_PROXY|NODE_EXTRA_CA_CERTS)$/i.test(name)),
      ).toEqual([])
      expect(env.logs?.()["app"]?.lines).toContain("listening")
    } finally {
      await env.close()
    }

    await expect(fetch(command.url)).rejects.toThrow("fetch failed")
  }, 30_000)

  it("refuses services with proxy: false, which would have no proxy to sit behind", async () => {
    await expect(appEnvironment({ proxy: false, services: [resendService()] })).rejects.toThrow(
      /proxy: false.*no services/,
    )
  })

  it("closes the services when the app fails to start", async () => {
    await expect(
      appEnvironment({
        app: await appCommand({ MAIL_APP_CRASH: "1" }),
        services: [resendService()],
      }),
    ).rejects.toThrow("exited with code 3")
  })
})

describe.runIf(hasPython())("an app outside Node", () => {
  it("reaches the emulators through the standard variables, under block and secrets: fail", async () => {
    const url = `http://127.0.0.1:${await freePort()}`
    const resend = resendService()
    const env = await stackEnvironment({
      unmatched: "block",
      secrets: "fail",
      services: [resend],
      apps: [{ name: "mailer", command: `python3 "${PYTHON_APP}"`, url, timeoutMs: 20_000 }],
    })

    try {
      expect(await (await fetch(url)).text()).toBe("proxied: yes")
      expect((await fetch(`${url}/signup`, { method: "POST" })).status).toBe(200)
      expect(resendInbox(resend.emulator).latest("ada@example.com")).toMatchObject({
        subject: "Welcome",
      })
      /* A host no route answers is refused at the proxy, Python or not. */
      expect(await (await fetch(`${url}/outside`)).text()).toBe("502")
      /* No preload ran in it, so its routing check is a note, never a refusal. */
      expect(env.notes?.()).toEqual([
        expect.stringMatching(/^mailer runs no Node process \(.*python.*\), so danwo's check/i),
      ])
    } finally {
      await env.close()
    }
  }, 30_000)
})

/** The environment the app at `url` started with, read from its `/env`. */
async function appEnv(url: string | undefined) {
  return z.record(z.string(), z.string()).parse(await (await fetch(`${url ?? ""}/env`)).json())
}

describe("what the app inherits of danwo's environment", () => {
  /* A runner's secrets: the CI's token and danwo's own model key. */
  const planted = {
    AI_GATEWAY_API_KEY: "vck_planted_for_the_test",
    GITHUB_TOKEN: "ghp_planted_for_the_test",
    NEXT_PUBLIC_SITE: "shop",
  }

  beforeAll(() => {
    Object.assign(process.env, planted)
  })

  afterAll(() => {
    for (const name of Object.keys(planted)) Reflect.deleteProperty(process.env, name)
  })

  it("is all of it by default, as before", async () => {
    const env = await appEnvironment({ app: await appCommand() })

    try {
      expect(await appEnv(env.baseUrl)).toMatchObject(planted)
    } finally {
      await env.close()
    }
  }, 30_000)

  it("is only what a command needs to run when off, with the proxy's variables and its own on top", async () => {
    const command = await appCommand({ OWN: "yes" })
    const env = await appEnvironment({ app: { ...command, inheritEnv: false } })

    try {
      const seen = await appEnv(env.baseUrl)

      expect(seen).not.toHaveProperty("AI_GATEWAY_API_KEY")
      expect(seen).not.toHaveProperty("GITHUB_TOKEN")
      expect(seen).not.toHaveProperty("NEXT_PUBLIC_SITE")
      expect(seen).toMatchObject({ OWN: "yes", PORT: new URL(command.url).port })
      /* Windows names it `Path`, and keeps that case in the app's environment. */
      const path = Object.entries(seen).find(([name]) => name.toUpperCase() === "PATH")?.[1]

      expect(path).toContain(process.env.PATH ?? "")
      expect(seen.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+/)
      expect(seen.NODE_OPTIONS).toContain("--import=")
    } finally {
      await env.close()
    }
  }, 30_000)

  it("keeps the names a stack app lists, a prefix with *", async () => {
    const command = await appCommand()
    const env = await stackEnvironment({
      apps: [{ name: "web", ...command, inheritEnv: ["NEXT_PUBLIC_*"] }],
    })

    try {
      const seen = await appEnv(env.baseUrl)

      expect(seen.NEXT_PUBLIC_SITE).toBe("shop")
      expect(seen).not.toHaveProperty("AI_GATEWAY_API_KEY")
    } finally {
      await env.close()
    }
  }, 30_000)
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
