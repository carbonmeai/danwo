"""
The app's Stripe client, and starting a Checkout Session for a booking. The SDK retries 5xx
answers, 409s and dropped connections itself, reusing the request's idempotency key;
`stripe_call` adds what it leaves out: backing off on a 429.
"""

import hashlib
import json
import os
from collections.abc import Callable
from typing import Any, TypeVar

import stripe

from .retry import retrying
from .settings import broken, settings

T = TypeVar("T")

# The Stripe SDK verifies against the CA bundle it ships and reads no variable for another, so a
# deployment behind a TLS-inspecting proxy points it at the bundle the environment names.
_ca_bundle = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
if _ca_bundle:
    stripe.ca_bundle_path = _ca_bundle

client = stripe.StripeClient(
    settings.stripe_secret_key,
    max_network_retries=2,
    http_client=stripe.RequestsClient(timeout=10),
)


def _retryable(error: BaseException) -> bool:
    """Whether Stripe asked the app to slow down, or failed in a way worth one more try."""
    return isinstance(error, (stripe.RateLimitError, stripe.APIError, stripe.APIConnectionError))


def stripe_call(name: str, call: Callable[[], T]) -> T:
    """Runs one Stripe call with the app's retry policy on top of the SDK's own."""
    return retrying(
        f"stripe {name}",
        call,
        attempts=4,
        retryable=_retryable,
        delay=lambda attempt, _: 0.25 * attempt,
    )


def _idempotency_key(class_id: int, params: dict[str, Any]) -> str:
    """
    The key for one booking attempt: the class and a fingerprint of exactly what Stripe is asked
    for, the customer's email among it. A double-click, a retried request or a retry after a lost
    answer all get the same Checkout Session back.
    """
    fingerprint = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    return f"book-{class_id}-{fingerprint[:16]}"


def start_checkout(klass: dict[str, Any], email: str) -> str:
    """
    Starts a Checkout Session for one place in `klass`; the URL of Stripe's payment page. Stripe
    sends the customer back to the web app, at the address WEB_URL names.
    """
    origin = settings.web_url
    params: dict[str, Any] = {
        "mode": "payment",
        "customer_email": email,
        "client_reference_id": f"{klass['slug']}:{email}",
        "line_items": [{"price": klass["stripe_price_id"], "quantity": 1}],
        "metadata": {"class": klass["slug"], "email": email},
        "success_url": f"{origin}/bookings/confirmed?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{origin}/classes/{klass['slug']}",
    }
    options: stripe.RequestOptions = (
        {}
        if broken("no-idempotency-key")
        else {"idempotency_key": _idempotency_key(klass["id"], params)}
    )
    session = stripe_call(
        "checkout.sessions.create",
        lambda: client.v1.checkout.sessions.create(params, options),  # type: ignore[arg-type]
    )
    if not session.url:
        raise RuntimeError(f"Stripe gave checkout session {session.id} no URL")
    return session.url


def payment_state(session_id: str) -> str:
    """Whether Stripe has taken the money for a Checkout Session yet: `paid` or `unpaid`."""
    session = stripe_call(
        "checkout.sessions.retrieve", lambda: client.v1.checkout.sessions.retrieve(session_id)
    )
    return "paid" if session.payment_status == "paid" else "unpaid"
