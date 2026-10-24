/**
 * Reading a WebSocket's frames as they pass, without changing them: how many messages went by and
 * their size, and the code of a close frame. A message is counted when its last frame passes; its
 * size is its payloads' bytes as they crossed the wire (compressed, when the socket compresses).
 * Control frames (ping, pong, close) are not messages.
 */

const CLOSE = 0x8

interface Frame {
  readonly opcode: number
  readonly fin: boolean
  readonly mask?: Buffer
}

/** How many bytes a frame's extended length takes (0, 2 or 8), from its 7-bit length field. */
function extendedLengthBytes(short: number): number {
  if (short === 126) return 2

  return short === 127 ? 8 : 0
}

/** The payload length a header gives, from its 7-bit field and any extended length after it. */
function payloadLength(header: Buffer, short: number): number {
  if (short === 126) return header.readUInt16BE(2)

  return short === 127 ? Number(header.readBigUInt64BE(2)) : short
}

/** A frame header's fields once `header` holds all of it: the frame, its payload length, its size. */
function parseHeader(
  header: Buffer,
): { readonly frame: Frame; readonly length: number; readonly size: number } | undefined {
  if (header.length < 2) return undefined

  const first = header[0] ?? 0
  const second = header[1] ?? 0
  const short = second & 0x7f
  const masked = (second & 0x80) !== 0
  const lengthBytes = extendedLengthBytes(short)
  const size = 2 + lengthBytes + (masked ? 4 : 0)

  if (header.length < size) return undefined

  return {
    frame: {
      opcode: first & 0x0f,
      fin: (first & 0x80) !== 0,
      ...(masked && { mask: header.subarray(2 + lengthBytes, size) }),
    },
    length: payloadLength(header, short),
    size,
  }
}

/** A close frame's status code, unmasked; null when it carried none. */
function closeCodeOf(payload: Buffer, mask: Buffer | undefined): number | null {
  if (payload.length < 2) return null

  const high = (payload[0] ?? 0) ^ (mask?.[0] ?? 0)
  const low = (payload[1] ?? 0) ^ (mask?.[1] ?? 0)

  return high * 256 + low
}

/** Counts the messages in one direction of a WebSocket, from the bytes as they pass. */
export class FrameCounter {
  /** Messages that have passed whole. */
  messages = 0
  /** Payload bytes of those messages, and of the frames of one still passing. */
  bytes = 0
  /**
   * The first close frame's status code: undefined while none has passed, null for a close frame
   * that carried no code.
   */
  closeCode: number | null | undefined = undefined

  /** Header bytes of the frame being read, until there are enough to know its length. */
  #header = Buffer.alloc(0)
  /** Payload bytes of the current frame not yet passed. */
  #left = 0
  #frame: Frame | undefined
  /** A close frame's payload, as it arrives. */
  #closing: Buffer[] = []

  push(chunk: Buffer): void {
    let at = 0

    while (at < chunk.length) {
      if (this.#frame === undefined) {
        const taken = this.#readHeader(chunk.subarray(at))

        at += taken
        if (this.#frame === undefined) return
        if (this.#left === 0) this.#finishFrame()
        continue
      }

      const take = Math.min(this.#left, chunk.length - at)

      if (this.#frame.opcode === CLOSE) this.#closing.push(chunk.subarray(at, at + take))
      this.#left -= take
      at += take
      if (this.#left === 0) this.#finishFrame()
    }
  }

  /** Takes header bytes from `data`; returns how many it took. Sets the frame once the header is whole. */
  #readHeader(data: Buffer): number {
    const before = this.#header.length
    const header = Buffer.concat([this.#header, data.subarray(0, 14)])
    const parsed = parseHeader(header)

    if (parsed === undefined) {
      this.#header = header

      return data.length
    }

    this.#frame = parsed.frame
    this.#left = parsed.length
    this.#header = Buffer.alloc(0)
    if (parsed.frame.opcode < CLOSE) this.bytes += parsed.length

    return parsed.size - before
  }

  #finishFrame(): void {
    const frame = this.#frame

    this.#frame = undefined

    if (frame === undefined) return
    if (frame.opcode < CLOSE && frame.fin) this.messages++

    if (frame.opcode === CLOSE && this.closeCode === undefined)
      this.closeCode = closeCodeOf(Buffer.concat(this.#closing), frame.mask)

    this.#closing = []
  }
}
