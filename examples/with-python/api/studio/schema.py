"""
The app's tables. `python -m studio.schema` creates them on the database DATABASE_URL names, as a
deploy step would; the tests run it on each worker's fresh database.
"""

import os

import psycopg

TABLES = """
create table if not exists classes (
  id serial primary key,
  slug text not null unique,
  name text not null,
  instructor text not null,
  starts text not null,
  minutes integer not null,
  description text not null,
  price_cents integer not null,
  stripe_price_id text not null,
  capacity integer not null,
  booked integer not null default 0
);

create table if not exists bookings (
  id serial primary key,
  checkout_session_id text not null,
  payment_intent_id text,
  class_id integer not null references classes (id),
  email text not null,
  amount_cents integer not null,
  currency text not null,
  confirmation_email_id text,
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
"""

ONE_BOOKING_PER_SESSION = """
create unique index if not exists bookings_checkout_session_id on bookings (checkout_session_id);
"""


def create(conn: psycopg.Connection) -> None:
    """
    Creates the tables. One booking per paid Checkout Session is a unique index, whatever Stripe
    sends twice; STUDIO_BUG=no-webhook-dedupe leaves it out.
    """
    conn.execute(TABLES)
    if os.environ.get("STUDIO_BUG") != "no-webhook-dedupe":
        conn.execute(ONE_BOOKING_PER_SESSION)


if __name__ == "__main__":
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
        create(connection)
