// Quillwork is a small team-notes product with one paid plan. A team signs up, starts the Team
// plan through Stripe Checkout, and Stripe's webhook activates the plan and sends a welcome email
// through Resend. Pages are rendered on the server with html/template; Postgres holds accounts,
// subscriptions and the webhook events already handled.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		slog.Error("quillwork stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := migrate(ctx, db, cfg); err != nil {
		return err
	}

	client, err := outboundClient()
	if err != nil {
		return err
	}
	pages, err := parsePages()
	if err != nil {
		return err
	}

	s := &server{
		db:       db,
		cfg:      cfg,
		sessions: sessions{secret: []byte(cfg.SessionSecret)},
		billing:  newBilling(cfg, db, client),
		mailer:   newMailer(cfg, db, client),
		pages:    pages,
	}
	if err := s.mailer.sendMissed(ctx); err != nil {
		return err
	}

	httpServer := &http.Server{Addr: cfg.Addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	served := make(chan error, 1)
	go func() { served <- httpServer.ListenAndServe() }()
	slog.Info("quillwork listening", "addr", cfg.Addr, "bug", cfg.Bug)

	select {
	case err := <-served:
		return err
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdown); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
