-- Quillwork's tables. The app applies this at start-up; every statement is safe to run again.

create table if not exists accounts (
  id bigserial primary key,
  email text not null unique,
  team text not null,
  created_at timestamptz not null default now(),
  -- The id Resend gave the welcome email, once it went out.
  welcome_email_id text
);

-- One row per Stripe subscription, its status as Stripe last reported it.
create table if not exists subscriptions (
  id bigserial primary key,
  account_id bigint not null references accounts (id),
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  status text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_id on subscriptions (stripe_subscription_id);

-- Every Stripe event the app has acted on, logged in the same transaction as what it did.
create table if not exists webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
