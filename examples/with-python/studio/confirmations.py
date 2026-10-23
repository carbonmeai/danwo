"""
Confirmation emails, sent through Resend once a booking exists. The idempotency key is the
booking's Checkout Session, so a retry after a timeout or a lost answer never sends a second
email. A confirmation that still fails is tried again in the background: the booking is safe in
the database either way.
"""

import logging
import threading

import resend

from .bookings import booking, booking_number, money
from .db import query
from .retry import describe, retrying
from .settings import settings

log = logging.getLogger("studio")

resend.api_key = settings.resend_api_key
resend.default_http_client = resend.RequestsClient(timeout=4)

# Failures that a later attempt can get past; a bad address or payload never will.
TRANSIENT = {
    "rate_limit_exceeded",
    "application_error",
    "internal_server_error",
    "concurrent_idempotent_requests",
    "HttpClientError",
}


def _retryable(error: BaseException) -> bool:
    if not isinstance(error, resend.exceptions.ResendError):
        return False
    return error.error_type in TRANSIENT or str(error.code) in {"429", "500", "502", "503"}


def _delay(attempt: int, error: BaseException) -> float:
    rate_limited = getattr(error, "error_type", None) == "rate_limit_exceeded"
    return 1.0 if rate_limited else 0.2 * attempt


def send_confirmation(booking_id: int) -> None:
    """Sends one booking's confirmation unless it was sent already; raises when Resend won't."""
    row = booking(booking_id)
    if row is None or row["confirmation_email_id"]:
        return

    number = booking_number(row["id"])
    lines = [
        f"You're booked for {row['name']} with {row['instructor']}.",
        "",
        f"{row['starts']}, {row['minutes']} minutes",
        f"Paid {money(row['amount_cents'])}",
        "",
        f"Your booking is {number}.",
    ]
    # The same text on every attempt, so the idempotency key holds.
    email: resend.Emails.SendParams = {
        "from": settings.mail_from,
        "to": [row["email"]],
        "subject": f"You're booked: {row['name']} ({number})",
        "text": "\n".join(lines),
        "html": "".join(f"<p>{line}</p>" for line in lines if line),
    }
    options: resend.Emails.SendOptions = {
        "idempotency_key": f"confirmation-{row['checkout_session_id']}"
    }
    sent = retrying(
        f"resend confirmation {number}",
        lambda: resend.Emails.send(email, options),
        attempts=4,
        retryable=_retryable,
        delay=_delay,
    )
    query(
        "note confirmation",
        lambda conn: conn.execute(
            "update bookings set confirmation_email_id = %s where id = %s",
            (sent["id"], booking_id),
        ),
    )


# How long to wait before each later try at a confirmation that failed: about half a minute.
LATER = [1.0, 2.0, 4.0, 8.0, 15.0]


def send_confirmation_soon(booking_id: int, attempt: int = 0) -> None:
    """
    Sends a confirmation now if it can; when Resend still refuses, tries again in the background,
    a little later each time. The booking is committed already, so the customer is never left
    without one because the mail provider had a bad minute.
    """
    try:
        send_confirmation(booking_id)
    except Exception as error:
        if attempt >= len(LATER):
            log.error("confirmation %s not sent: %s", booking_number(booking_id), describe(error))
            return
        wait = LATER[attempt]
        log.warning(
            "confirmation %s: trying again in %.0f s (%s)",
            booking_number(booking_id),
            wait,
            describe(error),
        )
        timer = threading.Timer(wait, send_confirmation_soon, (booking_id, attempt + 1))
        timer.daemon = True
        timer.start()


def send_missed_confirmations() -> None:
    """On start-up, sends the confirmations a stopped app never got to."""
    rows = query(
        "find unsent confirmations",
        lambda conn: conn.execute(
            "select id from bookings where confirmation_email_id is null"
        ).fetchall(),
    )
    for row in rows:
        send_confirmation_soon(row["id"])
