package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

// migrate creates the app's tables. With QUILLWORK_BUG=no-webhook-dedupe it drops the unique
// index that allows one row per Stripe subscription, as an app that never had one would be.
func migrate(ctx context.Context, db *pgxpool.Pool, cfg config) error {
	if _, err := db.Exec(ctx, schema); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	if cfg.broken("no-webhook-dedupe") {
		if _, err := db.Exec(ctx, "drop index if exists subscriptions_stripe_id"); err != nil {
			return fmt.Errorf("drop index: %w", err)
		}
	}
	return nil
}

// transient reports whether err is worth another attempt: a serialization failure or deadlock,
// which Postgres asks the client to retry, a server out of connections or shutting down, or a
// connection that broke or was refused.
func transient(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case pgErr.Code == "40001", pgErr.Code == "40P01":
			return true
		case strings.HasPrefix(pgErr.Code, "08"), strings.HasPrefix(pgErr.Code, "53"),
			strings.HasPrefix(pgErr.Code, "57P"):
			return true
		}
		return false
	}

	// Anything else came from below Postgres: a reset, a closed connection, a refused dial.
	return true
}

// backoff is how long to wait before attempt n (1 is the first retry).
func backoff(n int) time.Duration {
	wait := 50 * time.Millisecond << n
	if wait > time.Second {
		return time.Second
	}
	return wait
}

// retrying runs work until it succeeds, fails for good, or runs out of attempts. Each repeat is
// safe only because the work it repeats is idempotent: an upsert, a logged event id, a key.
func retrying(ctx context.Context, name string, attempts int, retryable func(error) bool, work func() error) error {
	for attempt := 1; ; attempt++ {
		err := work()
		if err == nil || attempt >= attempts || !retryable(err) {
			return err
		}
		slog.Warn("retrying", "what", name, "attempt", attempt, "err", err)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff(attempt)):
		}
	}
}

// dbAttempts is how many times a statement or transaction is tried: enough to ride out a few
// seconds of Postgres refusing connections.
const dbAttempts = 8

// withDB runs one database call, again while it fails for a transient reason.
func withDB(ctx context.Context, name string, work func() error) error {
	return retrying(ctx, name, dbAttempts, transient, work)
}

// inTx runs fn in a transaction, from the start again when a statement or the COMMIT fails for a
// reason worth retrying. A COMMIT whose answer was lost may have landed, so fn must recognise
// work it already did (the event log does that).
func inTx(ctx context.Context, db *pgxpool.Pool, name string, fn func(pgx.Tx) error) error {
	return withDB(ctx, name, func() error {
		return pgx.BeginFunc(ctx, db, fn)
	})
}

// exec runs one statement, retried like a transaction.
func exec(ctx context.Context, db *pgxpool.Pool, name, sql string, args ...any) error {
	return withDB(ctx, name, func() error {
		_, err := db.Exec(ctx, sql, args...)
		return err
	})
}
