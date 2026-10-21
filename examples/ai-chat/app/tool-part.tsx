import type { SupportMessage } from "../lib/messages.ts"

type Part = SupportMessage["parts"][number]

/** A call to one of the assistant's tools, as the conversation shows it. */
type ToolCall = Extract<Part, { type: "tool-lookupOrder" | "tool-createTicket" }>

const STATUS_TONES: Readonly<Record<string, string>> = {
  delivered: "badge-success",
  shipped: "badge-info",
  processing: "badge-warning",
}

/** The date as the customer reads it: `Fri 17 Oct`. */
function day(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/**
 * What a tool call came to: the order it looked up (read from the shop's database, not from the
 * model), the ticket it opened, or why it didn't run.
 */
export function ToolPart({ part, live }: { readonly part: ToolCall; readonly live: boolean }) {
  if (part.state === "output-error")
    return (
      <div className="chat-tool chat-tool-error" data-testid="tool-error">
        {part.type === "tool-createTicket"
          ? "The assistant tried to open a ticket, but its request didn't check out, so nothing was saved."
          : "The assistant tried to look an order up, but its request didn't check out."}
      </div>
    )

  if (part.state !== "output-available")
    return live ? (
      <div className="chat-tool chat-tool-pending" aria-busy="true">
        {part.type === "tool-createTicket" ? "Opening a ticket…" : "Looking the order up…"}
      </div>
    ) : (
      /* The answer broke off before the call was made: nothing ran. */
      <div className="chat-tool chat-tool-pending" data-testid="tool-unfinished">
        {part.type === "tool-createTicket"
          ? "The assistant started to open a ticket, but didn't finish."
          : "The assistant started to look the order up, but didn't finish."}
      </div>
    )

  if (part.type === "tool-lookupOrder") {
    const { output } = part

    if (!output.found)
      return (
        <div className="chat-tool" data-testid="order-card">
          No order {output.orderNumber} on file.
        </div>
      )

    const { order } = output

    return (
      <div className="chat-tool" data-testid="order-card">
        <div className="chat-tool-head">
          <span className="font-medium">Order {order.number}</span>
          <span className={`badge ${STATUS_TONES[order.status] ?? ""}`} data-testid="order-status">
            {order.status}
          </span>
        </div>
        <p className="muted">
          {order.item} · placed {day(order.placedOn)}
          {order.arrivesOn
            ? ` · ${order.status === "delivered" ? "arrived" : "arrives"} ${day(order.arrivesOn)}`
            : ""}
        </p>
      </div>
    )
  }

  const { output } = part

  if (output.status === "no-such-order")
    return (
      <div className="chat-tool" data-testid="ticket-card">
        No ticket opened: there is no order {output.orderNumber}.
      </div>
    )

  return (
    <div className="chat-tool" data-testid="ticket-card">
      <div className="chat-tool-head">
        <span className="font-medium font-mono" data-testid="ticket-number">
          {output.ticket}
        </span>
        <span className="badge badge-success">
          {output.status === "opened" ? "Ticket opened" : "Already open"}
        </span>
      </div>
      <p className="muted">
        About order {output.orderNumber} · a copy went to {output.email}
      </p>
    </div>
  )
}
