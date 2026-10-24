/**
 * A gRPC client as an app runs one, with nothing but the proxy's environment: grpc-js reads the
 * proxy from `https_proxy` and, for TLS, trusts the roots `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`
 * names. `node grpc-client.ts <host:port> <tls|plain> [calls]` makes the calls named (by default
 * all: `unary`, a server-streaming `stream`, a two-way `chat` and a `failed` call) and prints
 * what each got, as JSON.
 */
import { Client, credentials, type ServiceError } from "@grpc/grpc-js"

import { decodeText, encodeText, methodPath } from "./greeter.ts"

const [target = "", security = "tls", calls = "unary,stream,chat,failed"] = process.argv.slice(2)
const client = new Client(
  target,
  security === "tls" ? credentials.createSsl() : credentials.createInsecure(),
)

function unary(name: string): Promise<string> {
  return new Promise((resolve) => {
    client.makeUnaryRequest(
      methodPath("SayHello"),
      encodeText,
      decodeText,
      name,
      (error: ServiceError | null, reply?: string) =>
        resolve(error ? `error ${error.code} ${error.details}` : (reply ?? "")),
    )
  })
}

function serverStream(name: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const replies: string[] = []
    const call = client.makeServerStreamRequest(methodPath("CountUp"), encodeText, decodeText, name)

    call.on("data", (reply: string) => replies.push(reply))
    call.on("error", reject)
    call.on("end", () => resolve(replies))
  })
}

/** Sends each name only once the answer to the one before has come back. */
function chat(names: readonly string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const replies: string[] = []
    const call = client.makeBidiStreamRequest(methodPath("Chat"), encodeText, decodeText)
    let next = 0

    const send = () => {
      const name = names[next]

      next += 1
      if (name === undefined) call.end()
      else call.write(name)
    }

    call.on("data", (reply: string) => {
      replies.push(reply)
      send()
    })
    call.on("error", reject)
    call.on("end", () => resolve(replies))
    send()
  })
}

const CALLS: Record<string, () => Promise<unknown>> = {
  unary: () => unary("ada"),
  stream: () => serverStream("count"),
  chat: () => chat(["one", "two"]),
  failed: () => unary("missing"),
}

try {
  const got: Record<string, unknown> = {}

  for (const name of calls.split(",")) got[name] = await CALLS[name]?.()
  console.log(JSON.stringify(got))
} finally {
  client.close()
}
