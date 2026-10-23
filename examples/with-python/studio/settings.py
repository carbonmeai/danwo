"""
What the app reads from its environment, checked once at start-up so a missing value fails
loudly rather than halfway through a booking.
"""

import os
from dataclasses import dataclass
from typing import Literal

Bug = Literal["no-webhook-dedupe", "no-idempotency-key"]

BUGS: tuple[Bug, ...] = ("no-webhook-dedupe", "no-idempotency-key")


@dataclass(frozen=True)
class Settings:
    database_url: str
    stripe_secret_key: str
    stripe_webhook_secret: str
    resend_api_key: str
    mail_from: str
    bug: Bug | None


def _required(name: str, prefix: str = "") -> str:
    value = os.environ.get(name, "")
    if not value or not value.startswith(prefix):
        raise SystemExit(f"{name} is missing or does not start with {prefix!r}")
    return value


def _bug() -> Bug | None:
    """
    STUDIO_BUG turns one of the app's safeguards off, so a reader can watch the fault matrix
    catch it: `no-webhook-dedupe` or `no-idempotency-key`.
    """
    value = os.environ.get("STUDIO_BUG") or None
    for bug in BUGS:
        if value == bug:
            return bug
    if value is not None:
        raise SystemExit(f"STUDIO_BUG is {value!r}; it can be one of {', '.join(BUGS)}")
    return None


def load() -> Settings:
    return Settings(
        database_url=_required("DATABASE_URL"),
        stripe_secret_key=_required("STRIPE_SECRET_KEY", "sk_"),
        stripe_webhook_secret=_required("STRIPE_WEBHOOK_SECRET", "whsec_"),
        resend_api_key=_required("RESEND_API_KEY", "re_"),
        mail_from=os.environ.get("MAIL_FROM", "Fern Studio <hello@fernstudio.test>"),
        bug=_bug(),
    )


settings = load()


def broken(bug: Bug) -> bool:
    """Whether the safeguard `bug` names is turned off for this run."""
    return settings.bug == bug
