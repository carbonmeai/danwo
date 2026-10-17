/*
 * An app under test with a sign-in form and a notes page only signed-in users reach. Notes are
 * stored in Tigris with the official S3 client, through the proxy. Signing in costs what a real
 * password check costs, so reusing a session is worth measuring. Every session id it issues is
 * appended to `$DANWO_FIXTURE_STATE/sids.txt`, so a test can check no record ever holds one.
 */
import { randomUUID } from "node:crypto"
import { appendFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const USER = { email: "ada@danwo.test", password: "pw-ada-fixture" }
/** What checking a password costs a real app (a slow hash). */
const PASSWORD_CHECK_MS = 300

const client = new S3Client({
  endpoint: "https://t3.storage.dev",
  region: "auto",
  credentials: { accessKeyId: "tid_fixture", secretAccessKey: "tsec_fixture" },
})
const sessions = new Set<string>()
const notes: string[] = []
const stats = { logins: 0, saved: 0 }

function page(res: ServerResponse, title: string, body: string): void {
  res.writeHead(200, { "content-type": "text/html" })
  res.end(`<!doctype html><title>${title}</title><main>${body}</main>`)
}

function redirect(res: ServerResponse, to: string, cookie?: string): void {
  res.writeHead(303, { location: to, ...(cookie && { "set-cookie": cookie }) }).end()
}

function signedIn(req: IncomingMessage): boolean {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1]

  return sid !== undefined && sessions.has(sid)
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let body = ""

  for await (const chunk of req) body += String(chunk)

  return new URLSearchParams(body)
}

const LOGIN_FORM = `<h1>Sign in</h1><form method="post" action="/login">
  <label>Email <input name="email" type="email"></label>
  <label>Password <input name="password" type="password"></label>
  <button type="submit">Sign in</button></form>`

async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const fields = await form(req)

  await sleep(PASSWORD_CHECK_MS)

  if (fields.get("email") !== USER.email || fields.get("password") !== USER.password) {
    page(res, "Sign in", `<p role="alert">Wrong email or password</p>${LOGIN_FORM}`)

    return
  }

  const sid = randomUUID()

  sessions.add(sid)
  stats.logins += 1
  appendFileSync(join(process.env["DANWO_FIXTURE_STATE"] ?? ".", "sids.txt"), `${sid}\n`)
  redirect(res, "/notes", `sid=${sid}; HttpOnly; Path=/`)
}

/** The notes page; its script greets a returning browser from localStorage. */
function notesPage(res: ServerResponse): void {
  const items = notes.map((note) => `<li>${note}</li>`).join("")

  page(
    res,
    "Notes",
    `<h1>Notes for ${USER.email}</h1><p id="greeting"></p>
    <form method="post" action="/notes"><label>Note <input name="note"></label>
    <button type="submit">Save</button></form><ul aria-label="Saved notes">${items}</ul>
    <script>
      const seen = localStorage.getItem("seen")
      document.getElementById("greeting").textContent = seen ? "Welcome back" : "First visit"
      localStorage.setItem("seen", "yes")
    </script>`,
  )
}

async function saveNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const note = (await form(req)).get("note") ?? ""

  try {
    await client.send(
      new PutObjectCommand({ Bucket: "danwo-notes", Key: `notes/${randomUUID()}`, Body: note }),
    )
    notes.push(note)
    stats.saved += 1
    redirect(res, "/notes")
  } catch (error) {
    res.writeHead(502).end(String(error))
  }
}

/** Ends every session, as a password change or a security reset would. */
function logoutEveryone(res: ServerResponse): void {
  sessions.clear()
  res.writeHead(204).end()
}

type Route = (req: IncomingMessage, res: ServerResponse) => unknown

const routes: Record<string, Route> = {
  "GET /login": (_req, res) => page(res, "Sign in", LOGIN_FORM),
  "POST /login": login,
  "GET /notes": (req, res) => (signedIn(req) ? notesPage(res) : redirect(res, "/login")),
  "POST /notes": (req, res) => (signedIn(req) ? saveNote(req, res) : redirect(res, "/login")),
  "POST /logout-everyone": (_req, res) => logoutEveryone(res),
  "GET /stats": (_req, res) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats)),
}

const server = createServer((req, res) => {
  const route = routes[`${req.method} ${new URL(req.url ?? "/", "http://app").pathname}`]

  if (route === undefined) res.writeHead(404).end()
  else void route(req, res)
})

server.listen(Number(process.env["PORT"] ?? 0), "127.0.0.1", () => console.log("listening"))
