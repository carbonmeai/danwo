"""
Retrying with backoff: what the app does around every call that can fail for a moment, its
database included. A retry is only safe because each call it repeats is idempotent: an
idempotency key, a dedupe table or a unique index makes the second attempt a no-op.
"""

import logging
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

log = logging.getLogger("studio")


def describe(error: BaseException) -> str:
    """A short description of an error for the log."""
    return f"{type(error).__name__}: {error}"


def retrying(
    name: str,
    work: Callable[[], T],
    *,
    attempts: int,
    retryable: Callable[[BaseException], bool],
    delay: Callable[[int, BaseException], float] = lambda attempt, _: 0.1 * 2 ** (attempt - 1),
) -> T:
    """Runs `work` until it succeeds, it fails for good, or `attempts` run out."""
    for attempt in range(1, attempts + 1):
        try:
            return work()
        except Exception as error:
            if attempt >= attempts or not retryable(error):
                raise
            log.warning("%s: attempt %d failed (%s); retrying", name, attempt, describe(error))
            time.sleep(delay(attempt, error))
    raise AssertionError("unreachable")
