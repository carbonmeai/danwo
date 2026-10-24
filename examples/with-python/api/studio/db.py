"""
The app's connection to Postgres: one pool, and helpers that retry what a database can fail at
for a moment (a serialization failure, a deadlock, a dropped connection), each attempt in a
transaction of its own so a retry starts from a clean slate.
"""

from collections.abc import Callable
from typing import TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from .retry import retrying
from .settings import settings

T = TypeVar("T")

Connection = psycopg.Connection[dict]

pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=6,
    timeout=5,
    open=False,
    check=ConnectionPool.check_connection,
    kwargs={"autocommit": True, "row_factory": dict_row, "connect_timeout": 5},
)

# SQLSTATEs a fresh attempt can get past: a serialization failure or deadlock, a server shutting
# down, starting up or full, and lost connections.
RETRYABLE_STATES = {"40001", "40P01", "57P01", "57P03", "53300", "08000", "08003", "08006"}


def transient(error: BaseException) -> bool:
    """Whether a failed statement or transaction is worth running again."""
    if isinstance(error, PoolTimeout):
        return True
    if isinstance(error, psycopg.Error):
        state = error.sqlstate
        # No SQLSTATE: the connection, not the statement, failed.
        return state in RETRYABLE_STATES if state else isinstance(error, psycopg.OperationalError)
    return False


def _backoff(attempt: int, _error: BaseException) -> float:
    """100 ms, doubling to 1 s: seven attempts ride out a few seconds' outage."""
    return min(0.1 * 2 ** (attempt - 1), 1.0)


def transaction(name: str, work: Callable[[Connection], T]) -> T:
    """
    Runs `work` in one transaction, again from the start when the database fails it for a moment.
    `work` must be safe to repeat: a COMMIT whose answer was lost may have committed, so the retry
    has to recognise its own earlier writes.
    """

    def attempt() -> T:
        with pool.connection() as conn, conn.transaction():
            return work(conn)

    return retrying(
        f"postgres {name}", attempt, attempts=7, retryable=transient, delay=_backoff
    )


def query(name: str, work: Callable[[Connection], T]) -> T:
    """Runs one read or single-statement write, retried the same way."""

    def attempt() -> T:
        with pool.connection() as conn:
            return work(conn)

    return retrying(
        f"postgres {name}", attempt, attempts=7, retryable=transient, delay=_backoff
    )
