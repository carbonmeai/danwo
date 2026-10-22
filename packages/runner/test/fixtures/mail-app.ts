/**
 * A small app for `appEnvironment`'s tests: it listens on `PORT`, says which proxy it was started
 * behind, hands its environment over on `GET /env`, sends a welcome email through Resend's API on
 * `POST /signup`, and exits at once when `MAIL_APP_CRASH` is set.
 */
import { createServer } from "node:http"

if (process.env.MAIL_APP_CRASH) {
  console.error("mail app: missing configuration")
  process.exit(3)
}

async function sendWelcome(): Promise<number> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer re_test_mail_app", "content-type": "application/json" },
    body: JSON.stringify({
      from: "hello@mail-app.test",
      to: "ada@example.com",
      subject: "Welcome",
      html: "<p>Your code is 482913</p>",
    }),
  })

  return response.status
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/signup") {
    sendWelcome().then(
      (status) => response.writeHead(status === 200 ? 200 : 502).end(String(status)),
      (error: unknown) => response.writeHead(500).end(String(error)),
    )

    return
  }

  if (request.url === "/env") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(process.env))

    return
  }

  response
    .writeHead(200, { "content-type": "text/plain" })
    .end(`proxied: ${process.env.HTTPS_PROXY === undefined ? "no" : "yes"}`)
}).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening"))
