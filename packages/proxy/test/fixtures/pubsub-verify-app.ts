/*
 * An app under test that receives Gmail's Pub/Sub pushes and checks each one's OIDC token with
 * google-auth-library, the way Google documents it: the signature against Google's certificates,
 * the audience and the service account. It answers 204 to a push it trusts and 401 otherwise, says
 * `ready` once it listens, and prints what it decided as JSON after EXPECTED pushes.
 */
import { createServer } from "node:http"

import { OAuth2Client } from "google-auth-library"

const audience = process.env["PUSH_AUDIENCE"] ?? ""
const pusher = process.env["PUSHER"] ?? ""
const expected = Number(process.env["EXPECTED"] ?? "1")
const client = new OAuth2Client()

/** What the app decided about one push. */
interface Verdict {
  readonly trusted: boolean
  readonly reason: string
}

const verdicts: Verdict[] = []

/** Trusts a push only when its token is Google's, for this endpoint and this service account. */
async function verify(authorization: string | undefined): Promise<Verdict> {
  try {
    const ticket = await client.verifyIdToken({
      idToken: (authorization ?? "").replace(/^Bearer /, ""),
      audience,
    })
    const payload = ticket.getPayload()
    const trusted = payload?.email === pusher && payload.email_verified === true

    return { trusted, reason: trusted ? "ok" : "wrong account" }
  } catch (error) {
    return { trusted: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function finish(): void {
  server.close()
  console.log(JSON.stringify(verdicts))
}

const server = createServer((req, res) => {
  req.resume()
  req.on("end", () => {
    void verify(req.headers.authorization).then((verdict) => {
      verdicts.push(verdict)
      res.statusCode = verdict.trusted ? 204 : 401
      res.end()
      if (verdicts.length >= expected) finish()
    })
  })
})

server.listen(Number(process.env["PUSH_PORT"]), "127.0.0.1", () => console.log("ready"))
setTimeout(finish, 25_000).unref()
