/**
 * The app `danwo init`'s slow test sets danwo up in: a home page, and `POST /charge`, which
 * creates a Stripe payment intent the way an app's server would, with no knowledge of danwo.
 */
import { createServer } from "node:http"

async function charge(): Promise<number> {
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: "Bearer sk_test_init_app",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ amount: "500", currency: "usd" }),
  })

  return response.status
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/charge") {
    charge().then(
      (status) => response.writeHead(status).end(),
      (error: unknown) => response.writeHead(502).end(String(error)),
    )

    return
  }

  response
    .writeHead(200, { "content-type": "text/html" })
    .end("<!doctype html><title>Init app</title><h1>Welcome</h1>")
}).listen(Number(process.env.PORT), "127.0.0.1")
