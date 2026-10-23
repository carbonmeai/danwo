"""
The web app: the timetable, a class's page, booking through Stripe Checkout, the confirmation,
"My bookings" and Stripe's webhook. Pages are rendered on the server with Jinja2.
"""

import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import quote

import stripe
from fastapi import FastAPI, Form, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .bookings import booking, booking_number, bookings_for, bookings_of_session, fulfil, money
from .confirmations import send_confirmation_soon, send_missed_confirmations
from .db import pool, query
from .payments import client, payment_state, start_checkout
from .retry import describe
from .settings import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("studio")

HERE = Path(__file__).parent


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
app.mount("/kit", StaticFiles(directory=HERE.parent / "kit"), name="kit")
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")

templates = Jinja2Templates(directory=HERE / "templates")
templates.env.filters["money"] = money
templates.env.filters["booking_number"] = booking_number

EMAIL_COOKIE = "studio_email"


def _page(request: Request, name: str, status: int = 200, **context: Any) -> HTMLResponse:
    return templates.TemplateResponse(request, name, context, status_code=status)


def _see_other(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=303)


def _classes() -> list[dict[str, Any]]:
    return query(
        "read timetable",
        lambda conn: conn.execute("select * from classes order by id").fetchall(),
    )


def _class(slug: str) -> dict[str, Any] | None:
    return query(
        "read class",
        lambda conn: conn.execute("select * from classes where slug = %s", (slug,)).fetchone(),
    )


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
def timetable(request: Request) -> HTMLResponse:
    return _page(request, "timetable.html", classes=_classes(), nav="timetable")


@app.get("/classes/{slug}", response_class=HTMLResponse)
def class_page(request: Request, slug: str, error: str | None = None) -> HTMLResponse:
    klass = _class(slug)
    if klass is None:
        return _page(request, "missing.html", status=404, nav="timetable")
    return _page(
        request,
        "class.html",
        klass=klass,
        error=error,
        email=request.cookies.get(EMAIL_COOKIE, ""),
        nav="timetable",
    )


def _origin(request: Request) -> str:
    """This app's address as the browser sees it, for Stripe to send the customer back to."""
    return str(request.base_url).rstrip("/")


@app.post("/classes/{slug}/book")
def book(request: Request, slug: str, email: str = Form(...)) -> Response:
    """Starts Stripe Checkout for one place; pressing it twice gets the same session."""
    email = email.strip().lower()
    klass = _class(slug)
    if klass is None:
        return _see_other("/")

    def back(message: str) -> RedirectResponse:
        return _see_other(f"/classes/{slug}?error={quote(message)}")

    if "@" not in email:
        return back("Enter the email to send your confirmation to.")
    if klass["booked"] >= klass["capacity"]:
        return back(f"{klass['name']} is full.")

    try:
        url = start_checkout(klass, email, _origin(request))
    except Exception as error:
        log.warning("checkout for %s failed: %s", slug, describe(error))
        return back("We couldn't start checkout just now. Please try again.")

    response = _see_other(url)
    response.set_cookie(EMAIL_COOKIE, email, httponly=True, samesite="lax")
    return response


@app.get("/bookings/confirmed", response_class=HTMLResponse)
def confirmed(request: Request, session_id: str = "") -> HTMLResponse:
    """
    Where Stripe sends the customer after paying. The booking is made by Stripe's webhook, which
    may land a moment after the customer does, so until then the page says the payment is being
    confirmed and looks again every second.
    """
    if not session_id:
        return _page(request, "missing.html", status=404, nav="bookings")
    found = bookings_of_session(session_id)
    if found:
        return _page(request, "confirmed.html", booking=booking(found[0]), nav="bookings")
    return _page(request, "pending.html", state=payment_state(session_id), nav="bookings")


@app.get("/bookings", response_class=HTMLResponse)
def my_bookings(request: Request, email: str | None = None) -> HTMLResponse:
    email = (email if email is not None else request.cookies.get(EMAIL_COOKIE, "")).strip().lower()
    rows = bookings_for(email) if email else []
    return _page(request, "bookings.html", email=email, bookings=rows, nav="bookings")


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
        return JSONResponse({"error": "bad signature"}, status_code=400)
    try:
        await run_in_threadpool(_handle, event)
    except Exception as error:
        log.error("webhook %s failed: %s", event.id, describe(error))
        return JSONResponse({"error": "try again"}, status_code=500)
    return JSONResponse({"received": True})
