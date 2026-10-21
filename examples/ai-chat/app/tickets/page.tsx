import type { Metadata } from "next"

import { listTickets, type TicketRow } from "../../lib/tickets.ts"
import { Topbar } from "../topbar.tsx"

export const metadata: Metadata = { title: "Tickets" }

export const dynamic = "force-dynamic"

/** Every ticket the assistant opened, newest first. */
export default async function TicketsPage() {
  const tickets = await listTickets().catch(() => undefined)

  return (
    <>
      <Topbar page="Tickets" />
      <main className="shell-content">
        <header className="page-header">
          <h1 className="page-title">Tickets</h1>
          <p className="page-description">
            What the assistant opened for customers. Each one emailed the customer a copy.
          </p>
        </header>
        {tickets === undefined ? (
          <p className="toast toast-error" role="alert">
            The tickets couldn&apos;t be loaded just now. Refresh to try again.
          </p>
        ) : tickets.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No tickets yet</p>
            <p className="empty-text">
              Tell the assistant an order arrived broken, and it opens one.
            </p>
          </div>
        ) : (
          <TicketTable tickets={tickets} />
        )}
      </main>
    </>
  )
}

function TicketTable({ tickets }: { readonly tickets: readonly TicketRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Order</th>
            <th scope="col">Reason</th>
            <th scope="col">Summary</th>
            <th scope="col">Email</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.ticket}>
              <td className="font-mono">{ticket.ticket}</td>
              <td>{ticket.orderNumber}</td>
              <td>
                <span className="badge badge-warning">{ticket.reason ?? "not set"}</span>
              </td>
              <td>{ticket.summary}</td>
              <td>
                {ticket.emailed ? (
                  <span className="badge badge-success">Sent</span>
                ) : (
                  <span className="badge">Not sent</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
