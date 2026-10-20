import twilioSdk from "twilio"
import RequestClient from "twilio/lib/base/RequestClient.js"

import type { Emulator } from "../src/define.ts"

export const ACCOUNT = "REDACTED-TEST-VALUE"
export const TOKEN = "REDACTED-TEST-VALUE"
export const APP_NUMBER = "+15005550006"

/** A form body as the SDK sends it: one field per value, lists repeated. */
function formOf(data: unknown): URLSearchParams {
  const form = new URLSearchParams()

  if (data === null || typeof data !== "object") return form

  for (const [name, value] of Object.entries(data)) {
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) form.append(name, String(item))
  }

  return form
}

/** The URL with the call's query parameters added. */
function urlOf(uri: string, params: unknown): string {
  const url = new URL(uri)

  for (const [name, value] of formOf(params)) url.searchParams.append(name, value)

  return url.toString()
}

/** The SDK's HTTP client, answered by the emulator in-process instead of over the network. */
class EmulatorClient extends RequestClient {
  private readonly emulator: Pick<Emulator, "fetch">

  constructor(emulator: Pick<Emulator, "fetch">) {
    super()
    this.emulator = emulator
  }

  override async request<TData>(opts: RequestClient.RequestOptions<TData>): Promise<Answer<TData>> {
    const auth = Buffer.from(`${opts.username ?? ""}:${opts.password ?? ""}`).toString("base64")
    const method = opts.method.toUpperCase()
    const response = await this.emulator.fetch(
      new Request(urlOf(opts.uri, opts.params), {
        method,
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        ...(method === "POST" && { body: formOf(opts.data).toString() }),
      }),
    )
    const body = await response.text()

    return {
      statusCode: response.status,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK types the body as what it will parse it into; the client hands over the raw JSON text, which the SDK parses
      body: body as TData,
      headers: Object.fromEntries(response.headers),
      toString: () => body,
    }
  }
}

/** What the SDK expects back from its HTTP client. */
interface Answer<TData> {
  statusCode: number
  body: TData
  headers: Record<string, string>
  toString(): string
}

/** The official Twilio client, talking to `emulator` as the given account (or API key). */
export function twilioClient(
  emulator: Pick<Emulator, "fetch">,
  user = ACCOUNT,
  password = TOKEN,
  accountSid = ACCOUNT,
) {
  return twilioSdk(user, password, {
    accountSid,
    httpClient: new EmulatorClient(emulator),
  })
}
