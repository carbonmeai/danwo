/**
 * A gRPC client as an app runs one, with nothing but the proxy's environment: grpc-js reads the
 * proxy from `https_proxy` and, for TLS, trusts the roots `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`
 * names. `node grpc-client.ts <host:port> <tls|plain> [calls]` makes the calls named (by default
 * all: `unary`, a server-streaming `stream`, a two-way `chat` and a `failed` call; `partial` is a
 * server stream that fails partway) and prints what each got, as JSON.
 */
import {
  Client,
  type ClientDuplexStream,
  type ClientReadableStream,
  credentials,
  type ServiceError,
} from "@grpc/grpc-js"

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

/** A stream's answers, each passed to `onReply` too, then its error's code and details if it failed. */
function repliesOf(
  call: ClientReadableStream<string> | ClientDuplexStream<string, string>,
  onReply: () => void = () => {},
): Promise<string[]> {
  return new Promise((resolve) => {
    const replies: string[] = []

    call.on("data", (reply: string) => {
      replies.push(reply)
      onReply()
    })
    call.on("error", (error: ServiceError) =>
      resolve([...replies, `error ${error.code} ${error.details}`]),
    )
    call.on("end", () => resolve(replies))
  })
}

function serverStream(name: string): Promise<string[]> {
  return repliesOf(
    client.makeServerStreamRequest(methodPath("CountUp"), encodeText, decodeText, name),
  )
}

/**
 * Sends each name only once the answer to the one before has come back; the answers, then the
 * stream's error if it failed.
 */
function chat(names: readonly string[]): Promise<string[]> {
  const call = client.makeBidiStreamRequest(methodPath("Chat"), encodeText, decodeText)
  let next = 0

  const send = () => {
    const name = names[next]

    next += 1
    if (name === undefined) call.end()
    else call.write(name)
  }

  const replies = repliesOf(call, send)

  send()

  return replies
}

const CALLS: Record<string, () => Promise<unknown>> = {
  unary: () => unary("ada"),
  stream: () => serverStream("count"),
  chat: () => chat(["one", "two"]),
  failed: () => unary("missing"),
  partial: () => serverStream("broken"),
}

try {
  const got: Record<string, unknown> = {}

  for (const name of calls.split(",")) got[name] = await CALLS[name]?.()
  console.log(JSON.stringify(got))
} finally {
  client.close()
}
