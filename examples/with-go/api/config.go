package main

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
)

// config is what the app reads from its environment, checked once at start-up so a missing value
// fails loudly instead of halfway through a checkout.
type config struct {
	Addr                string
	AppURL              string
	DatabaseURL         string
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePriceID       string
	ResendAPIKey        string
	MailFrom            string
	SessionSecret       string
	// WebDir is the built web app the server serves beside its API: Vite's output folder.
	WebDir string
	// Bug turns one of the app's safeguards off, so the fault matrix can be seen catching it:
	// "no-webhook-dedupe", "no-idempotency-key" or "no-checkout-key". Empty in normal use.
	Bug string
}

// bugs are the values QUILLWORK_BUG accepts.
var bugs = []string{"no-webhook-dedupe", "no-idempotency-key", "no-checkout-key"}

// broken reports whether the safeguard bug names is turned off for this run.
func (c config) broken(bug string) bool {
	return c.Bug == bug
}

// loadConfig reads the config from the environment.
func loadConfig() (config, error) {
	var missing []string

	need := func(name string) string {
		value := os.Getenv(name)
		if value == "" {
			missing = append(missing, name)
		}
		return value
	}
	orDefault := func(name, fallback string) string {
		if value := os.Getenv(name); value != "" {
			return value
		}
		return fallback
	}

	c := config{
		Addr:                orDefault("HOST", "") + ":" + orDefault("PORT", "8080"),
		AppURL:              strings.TrimSuffix(need("APP_URL"), "/"),
		DatabaseURL:         need("DATABASE_URL"),
		StripeSecretKey:     need("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: need("STRIPE_WEBHOOK_SECRET"),
		StripePriceID:       need("STRIPE_PRICE_ID"),
		ResendAPIKey:        need("RESEND_API_KEY"),
		MailFrom:            orDefault("MAIL_FROM", "Quillwork <hello@quillwork.test>"),
		SessionSecret:       need("SESSION_SECRET"),
		WebDir:              orDefault("WEB_DIR", "web/dist"),
		Bug:                 os.Getenv("QUILLWORK_BUG"),
	}

	if len(missing) > 0 {
		return c, fmt.Errorf("missing environment: %s", strings.Join(missing, ", "))
	}
	if c.Bug != "" && !slices.Contains(bugs, c.Bug) {
		return c, errors.New("QUILLWORK_BUG must be one of: " + strings.Join(bugs, ", "))
	}

	return c, nil
}
