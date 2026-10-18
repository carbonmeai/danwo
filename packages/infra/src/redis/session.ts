/**
 * One Redis connection through the proxy. Each command the client sends is classified and given
 * its fault before it is sent; Redis answers commands one reply each, in order, so replies are
 * matched to commands in order even when a client pipelines them. Push messages (RESP3) answer no
 * command and pass straight on; once a connection subscribes it carries messages, not replies,
 * and passes through untouched.
 */
import { Line } from "../line.ts"
import type { Session, SessionContext, Wire } from "../tcp.ts"
import { classifyCommand, SUBSCRIBES } from "./commands.ts"
import { errorReply, RespReader, type RespValue } from "./resp.ts"

export class RedisSession implements Session {
  readonly #client = new RespReader(true)
  readonly #server = new RespReader(false)
  readonly #line: Line
  #inMulti = false
  #subscribed = false

  constructor(wire: Wire, context: SessionContext) {
    this.#line = new Line(wire, context)
  }

  fromClient(bytes: Buffer): void {
    if (this.#subscribed) return this.#line.send(bytes)

    this.#client.feed(bytes)

    for (let command = this.#client.next(); command !== undefined; command = this.#client.next())
      this.#command(command)
  }

  fromServer(bytes: Buffer): void {
    this.#server.feed(bytes)

    for (let reply = this.#server.next(); reply !== undefined; reply = this.#server.next())
      this.#reply(reply)
  }

  closed(): void {
    this.#line.closed()
  }

  #command(command: RespValue): void {
    const { verb, operation, role } = classifyCommand(command.words)

    if (SUBSCRIBES.has(verb)) {
      this.#subscribed = true

      return this.#line.send(command.raw)
    }

    const inTransaction = this.#inMulti

    this.#inMulti = verb === "MULTI" || (this.#inMulti && verb !== "EXEC" && verb !== "DISCARD")

    const { fault, handle } = this.#line.context.begin({ operation, verb, role, inTransaction })

    this.#line.dispatch(command.raw, fault, handle, (error) =>
      this.#line.answer(errorReply(error.code, error.message ?? "injected")),
    )
  }

  #reply(reply: RespValue): void {
    const head = this.#line.head()

    if (reply.type === ">" || head === undefined) return this.#line.wire.toClient(reply.raw)
    if (head === "call") this.#line.wire.toClient(reply.raw)

    this.#line.failHead(reply.error?.split(" ")[0])
    this.#line.settle()
  }
}
