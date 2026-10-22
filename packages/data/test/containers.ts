/** Throwaway Docker containers for the slow tests that need a real data store. */
import { execFileSync } from "node:child_process"

import { Client } from "pg"

import { freePort } from "../../cli/test/fixtures/app-process.ts"

/**
 * Whether Docker can run the Linux images these tests use. Not on Windows: its runners' Docker
 * runs Windows containers, so `postgres` and `redis` would fail rather than skip.
 */
export function dockerAvailable(): boolean {
  if (process.platform === "win32") return false

  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 })

    return true
  } catch {
    return false
  }
}

/** Starts a throwaway container publishing `inner` on a free local port; its id and port. */
export async function container(image: string, inner: number, env: readonly string[] = []) {
  const port = await freePort()
  const args = ["run", "-d", "--rm", "-p", `127.0.0.1:${port}:${inner}`]

  for (const pair of env) args.push("-e", pair)

  const id = execFileSync("docker", [...args, image], { encoding: "utf8" }).trim()

  return { id, port, stop: () => execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" }) }
}

export async function waitFor(ready: () => Promise<unknown>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await ready()

      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`${what} did not start`)
}

/** A Postgres 17 server in a container, ready for connections; its `postgres` database URL. */
export async function startPostgres(): Promise<{ url: string; stop: () => void }> {
  const server = await container("postgres:17", 5432, ["POSTGRES_PASSWORD=danwo"])
  const url = `postgres://postgres:danwo@127.0.0.1:${server.port}/postgres`

  await waitFor(async () => {
    const client = new Client({ connectionString: url })

    await client.connect()
    await client.end()
  }, "postgres")

  return { url, stop: server.stop }
}
