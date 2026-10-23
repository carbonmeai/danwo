"""
Turning a paid Checkout Session into a booking. Everything happens in one transaction: the event
is logged, the booking is written and the place is taken, or none of it is. That is what makes a
retry safe, whether Stripe sent the event twice or the database lost the answer to the COMMIT:
the second run finds the event logged (or the booking there) and stops.
"""

from typing import Any

from .db import Connection, query, transaction
from .settings import broken


def booking_number(booking_id: int) -> str:
    """The number a customer sees for a booking."""
    return f"FS-{1000 + booking_id}"


def money(cents: int) -> str:
    """`1800` as `$18.00`."""
    return f"${cents / 100:.2f}"


def _first_delivery(conn: Connection, event_id: str, event_type: str) -> bool:
    """
    Logs the event as handled; False when it already was. With STUDIO_BUG=no-webhook-dedupe the
    app forgets every event, so a repeat delivery runs again.
    """
    if broken("no-webhook-dedupe"):
        return True
    logged = conn.execute(
        "insert into webhook_events (id, type) values (%s, %s) on conflict do nothing returning id",
        (event_id, event_type),
    ).fetchone()
    return logged is not None


def _place(conn: Connection, session: dict[str, Any]) -> int | None:
    """Writes the session's booking and takes its place; None when the session has one already."""
    metadata = session.get("metadata") or {}
    klass = conn.execute(
        "select id from classes where slug = %s", (metadata.get("class"),)
    ).fetchone()
    if klass is None:
        # Stripe delivers the event again later, and the log says so meanwhile.
        raise RuntimeError(f"checkout session {session['id']} names no class we know")

    details = session.get("customer_details") or {}
    values = (
        session["id"],
        session.get("payment_intent"),
        klass["id"],
        details.get("email") or metadata.get("email") or session.get("customer_email"),
        session["amount_total"],
        session.get("currency") or "usd",
    )
    insert = """
        insert into bookings
          (checkout_session_id, payment_intent_id, class_id, email, amount_cents, currency)
        values (%s, %s, %s, %s, %s, %s)
    """
    if not broken("no-webhook-dedupe"):
        insert += " on conflict (checkout_session_id) do nothing"
    booking = conn.execute(insert + " returning id", values).fetchone()
    if booking is None:
        return None

    conn.execute("update classes set booked = booked + 1 where id = %s", (klass["id"],))
    return booking["id"]


def fulfil(event_id: str, event_type: str, session: dict[str, Any]) -> int | None:
    """
    Books the place a `checkout.session.completed` event paid for; the new booking's id, or None
    when there was nothing to do (unpaid, a repeat, a booking that exists).
    """
    if session.get("payment_status") != "paid":
        return None

    def work(conn: Connection) -> int | None:
        if not _first_delivery(conn, event_id, event_type):
            return None
        return _place(conn, session)

    return transaction("book the paid session", work)


def bookings_of_session(session_id: str) -> list[int]:
    """The bookings a Checkout Session paid for: one, unless a safeguard is off."""
    rows = query(
        "find the session's bookings",
        lambda conn: conn.execute(
            "select id from bookings where checkout_session_id = %s order by id", (session_id,)
        ).fetchall(),
    )
    return [row["id"] for row in rows]


BOOKING = """
    select b.id, b.checkout_session_id, b.email, b.amount_cents, b.confirmation_email_id,
           b.created_at, c.slug, c.name, c.instructor, c.starts, c.minutes
      from bookings b join classes c on c.id = b.class_id
"""


def booking(booking_id: int) -> dict[str, Any] | None:
    """One booking with its class."""
    return query(
        "read booking",
        lambda conn: conn.execute(BOOKING + " where b.id = %s", (booking_id,)).fetchone(),
    )


def bookings_for(email: str) -> list[dict[str, Any]]:
    """A customer's bookings, newest first."""
    return query(
        "read bookings",
        lambda conn: conn.execute(
            BOOKING + " where b.email = %s order by b.id desc", (email,)
        ).fetchall(),
    )
