/**
 * A one-page sign-up that emails a code through the Resend emulator and asks for it back. Tests
 * of the recorder read the code from `/last-code`, the way a person reads it from their inbox.
 */
import { randomInt } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { text } from "node:stream/consumers"

import { createEmulator, listeningPort, resend } from "@danwo/emulators"
import { defineConfig, resendMail } from "@danwo/sdk"

const html = (title: string, body: string) =>
  `<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}</main>`

const SIGN_UP = html(
  "Sign up",
  `<form method="post" action="/start"><label>Email <input name="email" type="email"></label><button>Send code</button></form>`,
)

/** The fields a request posted; none for a GET. */
async function formOf(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(req.method === "POST" ? await text(req) : "")
}

function contentType(body: string): string {
  return body.startsWith("<") ? "text/html" : "text/plain"
}

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  async environment() {
    const inbox = createEmulator(resend)
    let lastCode = ""

    const mailCode = async (email: string) => {
      lastCode = String(randomInt(100_000, 1_000_000))
      await inbox.fetch(
        new Request("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: "Bearer re_recorder", "content-type": "application/json" },
          body: JSON.stringify({
            from: "codes@signup.test",
            to: [email],
            subject: "Your code",
            text: `Use ${lastCode} to finish signing up.`,
          }),
        }),
      )
    }

    /** Each page by its path, from the form fields it was posted. */
    const pages: Readonly<Record<string, (fields: URLSearchParams) => Promise<string> | string>> = {
      "/start": async (fields) => {
        await mailCode(fields.get("email") ?? "")

        return html(
          "Enter your code",
          `<form method="post" action="/check"><label>Code <input name="code"></label><button>Verify</button></form>`,
        )
      },
      "/check": (fields) => html(fields.get("code") === lastCode ? "Welcome" : "Wrong code", ""),
      /* What a person would read in their inbox; only tests ask for it. */
      "/last-code": () => lastCode,
    }

    const answer = async (req: IncomingMessage, res: ServerResponse) => {
      const page = pages[req.url ?? "/"]
      const body = page === undefined ? SIGN_UP : await page(await formOf(req))

      res.writeHead(200, { "content-type": contentType(body) })
      res.end(body)
    }

    const server = createServer((req, res) => void answer(req, res))

    server.listen(0, "127.0.0.1")
    await once(server, "listening")

    return {
      baseUrl: `http://127.0.0.1:${String(listeningPort(server))}`,
      mail: [resendMail(inbox)],
      async close() {
        server.close()
        await inbox.close()
      },
    }
  },
})
