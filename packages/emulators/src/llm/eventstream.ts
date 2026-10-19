/**
 * The binary event stream Bedrock answers its streaming calls in (`application/vnd.amazon.eventstream`):
 * each message a length prelude with its CRC, string headers naming the event, a JSON payload, and
 * a CRC of the whole message.
 */
import { crc32 } from "node:zlib"

/** The header value type for a UTF-8 string. */
const STRING = 7

function header(name: string, value: string): Buffer {
  const key = Buffer.from(name, "utf8")
  const text = Buffer.from(value, "utf8")
  const out = Buffer.alloc(1 + key.length + 1 + 2 + text.length)

  out.writeUInt8(key.length, 0)
  key.copy(out, 1)
  out.writeUInt8(STRING, 1 + key.length)
  out.writeUInt16BE(text.length, 2 + key.length)
  text.copy(out, 4 + key.length)

  return out
}

/** One message with `headers` and a JSON payload. */
function frame(headers: Readonly<Record<string, string>>, payload: unknown): Buffer {
  const head = Buffer.concat(Object.entries(headers).map(([name, value]) => header(name, value)))
  const body = Buffer.from(JSON.stringify(payload), "utf8")
  const total = 12 + head.length + body.length + 4
  const prelude = Buffer.alloc(8)

  prelude.writeUInt32BE(total, 0)
  prelude.writeUInt32BE(head.length, 4)

  const preludeCrc = Buffer.alloc(4)

  preludeCrc.writeUInt32BE(crc32(prelude), 0)

  const message = Buffer.concat([prelude, preludeCrc, head, body])
  const messageCrc = Buffer.alloc(4)

  messageCrc.writeUInt32BE(crc32(message), 0)

  return Buffer.concat([message, messageCrc])
}

/** An event named `type`, as Converse streams and `InvokeModelWithResponseStream` chunks are sent. */
export function eventFrame(type: string, payload: unknown): Buffer {
  return frame(
    { ":event-type": type, ":content-type": "application/json", ":message-type": "event" },
    payload,
  )
}

/**
 * A stream's frames as one response body. A stream cut short keeps only its first half, as when a
 * connection drops mid-answer.
 */
export function eventStreamResponse(frames: readonly Buffer[], cut: boolean): Response {
  const kept = cut ? frames.slice(0, Math.max(1, Math.floor(frames.length / 2))) : frames

  return new Response(new Uint8Array(Buffer.concat(kept)), {
    headers: { "content-type": "application/vnd.amazon.eventstream" },
  })
}
