/**
 * An app under test that rate-limits sign-in attempts: at most two per user a minute, counted in
 * Redis with INCR and EXPIRE. When Redis cannot count an attempt the app turns it away (fails
 * closed); with `DANWO_BUG=fail-open` it lets the attempt through uncounted instead.
 */
import { createServer, type ServerResponse } from "node:http"

import { Redis } from "ioredis"

const LIMIT = 2
const FAIL_OPEN = process.env.DANWO_BUG === "fail-open"
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: 1 })

redis.on("error", () => undefined)

/** Attempts the limiter let through since the app started. */
let allowed = 0

/** How many attempts `user` made this minute, or undefined when Redis could not say. */
async function counted(user: string): Promise<number | undefined> {
  try {
    const key = `rate:login:${user}`
    const count = await redis.incr(key)

    if (count === 1) await redis.expire(key, 60)

    return count
  } catch {
    return undefined
  }
}

/** What the limiter answers, by what it decided. */
const ANSWERS = {
  allow: [200, "checked"],
  deny: [429, "too many attempts"],
  unavailable: [503, "try again shortly"],
} as const

/** Whether an attempt with this count goes through; an uncounted one fails closed, or open. */
function decide(count: number | undefined): keyof typeof ANSWERS {
  if (count === undefined) return FAIL_OPEN ? "allow" : "unavailable"

  return count > LIMIT ? "deny" : "allow"
}

async function login(user: string, res: ServerResponse): Promise<void> {
  const decision = decide(await counted(user))
  const [status, text] = ANSWERS[decision]

  if (decision === "allow") allowed += 1
  res.writeHead(status).end(text)
}

/** POST /login makes an attempt as the `user` header; GET /audit shows how many got through. */
const server = createServer((req, res) => {
  if (req.method === "POST") {
    login(String(req.headers["user"] ?? "anyone"), res).catch(() => res.writeHead(500).end())

    return
  }

  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ allowed }))
})

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address()

  if (address !== null && typeof address === "object") console.log(`listening ${address.port}`)
})
