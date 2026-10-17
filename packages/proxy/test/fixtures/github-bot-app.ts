/*
 * An app under test: a GitHub App bot written the way bots usually are, with plain fetches to
 * api.github.com. It verifies each webhook's X-Hub-Signature-256, and when an issue is opened it
 * signs an app JWT, trades it for an installation token and thanks the reporter in a comment.
 * It prints "ready" once listening, then, after its first comment, what it saw as JSON.
 */
import { createHmac, createSign, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"

import { z } from "zod"

const appId = process.env["APP_ID"] ?? ""
const privateKey = process.env["PRIVATE_KEY"] ?? ""
const secret = process.env["WEBHOOK_SECRET"] ?? ""
const api = "https://api.github.com"

const IssueOpened = z.object({
  action: z.string(),
  issue: z.object({ number: z.number() }),
  repository: z.object({ full_name: z.string() }),
  installation: z.object({ id: z.number() }),
})
const InstallationToken = z.object({ token: z.string() })
const Comment = z.object({ id: z.number() })

const seen = { rejected: 0, events: [] as string[], comments: [] as number[] }

function signedCorrectly(body: string, signature: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`)
  const given = Buffer.from(signature)

  return expected.length === given.length && timingSafeEqual(expected, given)
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`

  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`
}

async function call(url: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    body: JSON.stringify(body),
  })

  return response.json()
}

async function thank(payload: z.infer<typeof IssueOpened>): Promise<void> {
  const installation = InstallationToken.parse(
    await call(`${api}/app/installations/${payload.installation.id}/access_tokens`, appJwt(), {}),
  )
  const comment = Comment.parse(
    await call(
      `${api}/repos/${payload.repository.full_name}/issues/${payload.issue.number}/comments`,
      installation.token,
      { body: "Thanks for the report!" },
    ),
  )

  seen.comments.push(comment.id)
  process.stdout.write(`${JSON.stringify(seen)}\n`)
  server.close()
}

const server = createServer((req, res) => {
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    if (!signedCorrectly(body, String(req.headers["x-hub-signature-256"] ?? ""))) {
      seen.rejected++
      res.statusCode = 401
      res.end()

      return
    }

    seen.events.push(String(req.headers["x-github-event"]))
    res.statusCode = 202
    res.end()

    const parsed = IssueOpened.safeParse(JSON.parse(body))

    if (parsed.success && parsed.data.action === "opened") void thank(parsed.data)
  })
})

server.listen(Number(process.env["PORT"]), "127.0.0.1", () => process.stdout.write("ready\n"))
