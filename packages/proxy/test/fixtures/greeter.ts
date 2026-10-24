/**
 * A small gRPC service for the tests, defined by hand so no code is generated: `SayHello` answers
 * once, `CountUp` streams three answers, `Chat` answers each message as it arrives, and a name of
 * `missing` fails with NOT_FOUND. Every message is one string field (protobuf field 1).
 */
import {
  type ServerDuplexStream,
  type ServerUnaryCall,
  type ServerWritableStream,
  type ServiceDefinition,
  type sendUnaryData,
  status,
} from "@grpc/grpc-js"

/** A message of one string as protobuf writes it: field 1, length-delimited. */
export function encodeText(text: string): Buffer {
  const bytes = Buffer.from(text)
  const length: number[] = []
  let left = bytes.length

  do {
    length.push((left & 0x7f) | (left > 0x7f ? 0x80 : 0))
    left >>>= 7
  } while (left > 0)

  return Buffer.concat([Buffer.from([0x0a, ...length]), bytes])
}

/** The string of a message `encodeText` wrote; empty for an empty message. */
export function decodeText(message: Buffer): string {
  let at = 1
  let length = 0
  let shift = 0

  while (at < message.length) {
    const byte = message[at] ?? 0

    at += 1
    length |= (byte & 0x7f) << shift
    shift += 7
    if ((byte & 0x80) === 0) break
  }

  return message.subarray(at, at + length).toString()
}

/** The method's full path, as gRPC sends it in `:path`. */
export function methodPath(name: string): string {
  return `/greeter.Greeter/${name}`
}

function method(name: string, requestStream: boolean, responseStream: boolean) {
  return {
    path: methodPath(name),
    requestStream,
    responseStream,
    requestSerialize: encodeText,
    requestDeserialize: decodeText,
    responseSerialize: encodeText,
    responseDeserialize: decodeText,
  }
}

export const GREETER: ServiceDefinition = {
  SayHello: method("SayHello", false, false),
  CountUp: method("CountUp", false, true),
  Chat: method("Chat", true, true),
}

/** The service's handlers, as a real server would run them. */
export const greeterHandlers = {
  SayHello(call: ServerUnaryCall<string, string>, callback: sendUnaryData<string>) {
    if (call.request === "missing") callback({ code: status.NOT_FOUND, details: "no such name" })
    else callback(null, `hello ${call.request}`)
  },
  CountUp(call: ServerWritableStream<string, string>) {
    for (const n of [1, 2, 3]) call.write(`${call.request} ${n}`)
    call.end()
  },
  Chat(call: ServerDuplexStream<string, string>) {
    call.on("data", (text: string) => call.write(`echo ${text}`))
    call.on("end", () => call.end())
  },
}
