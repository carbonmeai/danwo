"""
The studio's JSON API: the week's classes, starting Stripe Checkout for a place, a booking by its
Checkout Session, a customer's bookings, and Stripe's webhook. The web app calls it from its
server and from the browser.
"""

import logging
import threading
from contextlib import asynccontextmanager
from typing import Any

import stripe
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .bookings import booking, booking_number, bookings_for, bookings_of_session, fulfil
from .confirmations import send_confirmation_soon, send_missed_confirmations
from .db import pool, query
from .payments import client, payment_state, start_checkout
from .retry import describe
from .settings import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("studio")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    pool.open(wait=True)
    # The confirmations a stopped app never sent go out once it is up, without holding start-up.
    threading.Thread(target=_send_missed, daemon=True).start()
    yield
    pool.close()


def _send_missed() -> None:
    try:
        send_missed_confirmations()
    except Exception as error:
        log.warning("missed confirmations: %s", describe(error))


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
# The web app's pages call the API from the browser too, so its origin may read the answers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_url],
    allow_methods=["GET"],
)


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _class_json(row: dict[str, Any]) -> dict[str, Any]:
    """A class as the API answers with it, with the places it has left."""
    return {
        "slug": row["slug"],
        "name": row["name"],
        "instructor": row["instructor"],
        "starts": row["starts"],
        "minutes": row["minutes"],
        "description": row["description"],
        "price_cents": row["price_cents"],
        "capacity": row["capacity"],
        "places_left": max(row["capacity"] - row["booked"], 0),
    }


def _booking_json(row: dict[str, Any]) -> dict[str, Any]:
    """A booking as the API answers with it: its number, its class and its confirmation."""
    return {
        "id": row["id"],
        "number": booking_number(row["id"]),
        "email": row["email"],
        "amount_cents": row["amount_cents"],
        "confirmation": "sent" if row["confirmation_email_id"] else "pending",
        "class": {
            "slug": row["slug"],
            "name": row["name"],
            "instructor": row["instructor"],
            "starts": row["starts"],
            "minutes": row["minutes"],
        },
    }


def _class(slug: str) -> dict[str, Any] | None:
    return query(
        "read class",
        lambda conn: conn.execute("select * from classes where slug = %s", (slug,)).fetchone(),
    )


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/classes")
def classes() -> list[dict[str, Any]]:
    """The week's classes, in timetable order."""
    rows = query(
        "read timetable",
        lambda conn: conn.execute("select * from classes order by id").fetchall(),
    )
    return [_class_json(row) for row in rows]


@app.get("/classes/{slug}", response_model=None)
def one_class(slug: str) -> dict[str, Any] | JSONResponse:
    klass = _class(slug)
    if klass is None:
        return _error(404, "There is no such class.")
    return _class_json(klass)


class CheckoutRequest(BaseModel):
    email: str


@app.post("/classes/{slug}/checkout", response_model=None)
def checkout(slug: str, body: CheckoutRequest) -> dict[str, str] | JSONResponse:
    """
    Starts Stripe Checkout for one place; the URL of Stripe's page. Asking twice for the same
    place with the same email gets the same Checkout Session back.
    """
    email = body.email.strip().lower()
    klass = _class(slug)
    if klass is None:
        return _error(404, "There is no such class.")
    if "@" not in email:
        return _error(400, "Enter the email to send your confirmation to.")
    if klass["booked"] >= klass["capacity"]:
        return _error(409, f"{klass['name']} is full.")

    try:
        url = start_checkout(klass, email)
    except Exception as error:
        log.warning("checkout for %s failed: %s", slug, describe(error))
        return _error(502, "We couldn't start checkout just now. Please try again.")
    return {"url": url}


@app.get("/checkout/{session_id}")
def checkout_result(session_id: str) -> dict[str, Any]:
    """
    What became of a Checkout Session: its booking once Stripe's webhook has made it, and until
    then whether Stripe has taken the money yet (`paid` or `unpaid`).
    """
    found = bookings_of_session(session_id)
    row = booking(found[0]) if found else None
    if row is not None:
        return {"booking": _booking_json(row), "payment": "paid"}
    return {"booking": None, "payment": payment_state(session_id)}


@app.get("/bookings")
def my_bookings(email: str = "") -> list[dict[str, Any]]:
    """A customer's bookings, newest first."""
    email = email.strip().lower()
    return [_booking_json(row) for row in bookings_for(email)] if email else []


def _verified(body: bytes, signature: str | None) -> stripe.Event | None:
    """The verified event a delivery carries, or None when its signature does not check out."""
    try:
        return client.construct_event(body, signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError):
        return None


def _handle(event: stripe.Event) -> None:
    if event.type != "checkout.session.completed":
        return
    session = event.data.object
    fulfil(event.id, event.type, session.to_dict())
    # The confirmation goes out for the session's booking however it got there: this delivery,
    # an earlier one, or a retry whose COMMIT answer was lost. It is a no-op once sent.
    for booking_id in bookings_of_session(session.id):
        send_confirmation_soon(booking_id)


@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request) -> JSONResponse:
    """
    Stripe's webhook. Every delivery's signature is checked first; a forged or stale one is
    refused and changes nothing. Anything that fails answers 500, so Stripe delivers it again.
    """
    event = _verified(await request.body(), request.headers.get("stripe-signature"))
    if event is None:
        return _error(400, "bad signature")
    try:
        await run_in_threadpool(_handle, event)
    except Exception as error:
        log.error("webhook %s failed: %s", event.id, describe(error))
        return _error(500, "try again")
    return JSONResponse({"received": True})
