/**
 * An app whose SDKs each build their own transport: the official Stripe client with its own
 * `https.Agent`, axios with a custom agent, and fetch with an undici `Agent` as its dispatcher.
 * Each calls `https://api.danwo.test/<name>` and prints what it got back, as JSON.
 */
import https from "node:https"

import axios from "axios"
import { Stripe } from "stripe"
import { Agent, fetch as undiciFetch } from "undici"

const out: Record<string, string> = {}

async function attempt(name: string, call: () => Promise<string>): Promise<void> {
  try {
    out[name] = await call()
  } catch (error) {
    out[name] = `error ${error instanceof Error ? error.message.slice(0, 60) : "unknown"}`
  }
}

await attempt("stripe", async () => {
  const stripe = new Stripe("sk_test_agents", {
    host: "api.danwo.test",
    httpAgent: new https.Agent({ keepAlive: true }),
    maxNetworkRetries: 0,
  })
  const customer = await stripe.customers.create({ email: "ada@example.com" })

  return customer.id
})
await attempt("axios", async () => {
  const response = await axios.get<string>("https://api.danwo.test/axios", {
    httpsAgent: new https.Agent({ keepAlive: true }),
    proxy: false,
  })

  return response.data
})
await attempt("undici", async () => {
  const response = await undiciFetch("https://api.danwo.test/undici", { dispatcher: new Agent() })

  return response.text()
})

console.log(JSON.stringify(out))
