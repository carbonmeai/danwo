package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v87"
)

// billing starts Stripe Checkout for the team plan and keeps each account's subscription in step
// with Stripe's.
type billing struct {
	stripe *stripe.Client
	db     *pgxpool.Pool
	cfg    config
}

func newBilling(cfg config, db *pgxpool.Pool, client *http.Client) *billing {
	backends := stripe.NewBackendsWithConfig(&stripe.BackendConfig{
		HTTPClient: client,
		// The SDK retries a dropped connection, a 409 and a 5xx itself, with the same
		// idempotency key, so a retry never acts twice.
		MaxNetworkRetries: stripe.Int64(3),
	})
	return &billing{
		stripe: stripe.NewClient(cfg.StripeSecretKey, stripe.WithBackends(backends)),
		db:     db,
		cfg:    cfg,
	}
}

// rateLimited reports whether Stripe refused a call for going too fast. The SDK leaves those to
// the caller: retrying at once would only add to the load.
func rateLimited(err error) bool {
	var stripeErr *stripe.Error
	return errors.As(err, &stripeErr) && stripeErr.HTTPStatusCode == http.StatusTooManyRequests
}

// withStripe runs call, backing off and trying again when Stripe rate-limits it or still fails
// after the SDK's own retries. Every call it repeats carries an idempotency key or only reads.
func withStripe[T any](ctx context.Context, name string, call func() (T, error)) (T, error) {
	var result T
	err := retrying(ctx, name, 4, func(err error) bool {
		var stripeErr *stripe.Error
		if !errors.As(err, &stripeErr) {
			return true
		}
		return rateLimited(err) || stripeErr.HTTPStatusCode >= 500
	}, func() error {
		var err error
		result, err = call()
		if rateLimited(err) {
			time.Sleep(500 * time.Millisecond)
		}
		return err
	})
	return result, err
}

// startCheckout creates the Checkout Session that subscribes a to the team plan and returns the
// URL of Stripe's page for it. The idempotency key is the account and the price: pressing the
// button twice, or the page sending the call again after a lost answer, gets the same session
// back, never a second one the team could pay for too. QUILLWORK_BUG=no-checkout-key leaves it
// to the SDK, whose own key covers only its own retries.
func (b *billing) startCheckout(ctx context.Context, a account) (string, error) {
	id := strconv.FormatInt(a.ID, 10)
	params := &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		CustomerEmail:     stripe.String(a.Email),
		ClientReferenceID: stripe.String(id),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(b.cfg.StripePriceID), Quantity: stripe.Int64(1)},
		},
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: map[string]string{"account": id},
		},
		SuccessURL: stripe.String(b.cfg.AppURL + "/checkout/return?session={CHECKOUT_SESSION_ID}"),
		CancelURL:  stripe.String(b.cfg.AppURL + "/account"),
	}
	if !b.cfg.broken("no-checkout-key") {
		params.SetIdempotencyKey(fmt.Sprintf("checkout-%s-%s", id, b.cfg.StripePriceID))
	}

	session, err := withStripe(ctx, "stripe checkout.sessions.create", func() (*stripe.CheckoutSession, error) {
		return b.stripe.V1CheckoutSessions.Create(ctx, params)
	})
	if err != nil {
		return "", err
	}
	return session.URL, nil
}

// subscription reads a subscription as Stripe has it now. Webhooks can arrive late, twice or out
// of order, so the app stores what Stripe says at the time, never the event's own copy.
func (b *billing) subscription(ctx context.Context, id string) (*stripe.Subscription, error) {
	return withStripe(ctx, "stripe subscriptions.retrieve", func() (*stripe.Subscription, error) {
		return b.stripe.V1Subscriptions.Retrieve(ctx, id, nil)
	})
}

// firstDelivery logs event as handled and reports whether this is the first time. With
// QUILLWORK_BUG=no-webhook-dedupe the app forgets every event, so a repeat runs again.
func (b *billing) firstDelivery(ctx context.Context, tx pgx.Tx, event stripe.Event) (bool, error) {
	if b.cfg.broken("no-webhook-dedupe") {
		return true, nil
	}
	tag, err := tx.Exec(ctx,
		"insert into webhook_events (id, type) values ($1, $2) on conflict (id) do nothing",
		event.ID, string(event.Type),
	)
	return tag.RowsAffected() == 1, err
}

// activate records the subscription a paid Checkout Session started, in one transaction with the
// event that reported it. It returns the account to welcome, or 0 when there is none.
func (b *billing) activate(ctx context.Context, event stripe.Event, session stripe.CheckoutSession) (int64, error) {
	if session.Mode != stripe.CheckoutSessionModeSubscription || session.Subscription == nil {
		return 0, nil
	}
	accountID, err := strconv.ParseInt(session.ClientReferenceID, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("session %s names no account", session.ID)
	}

	sub, err := b.subscription(ctx, session.Subscription.ID)
	if err != nil {
		return 0, err
	}
	customer := ""
	if sub.Customer != nil {
		customer = sub.Customer.ID
	}

	insert := `insert into subscriptions (account_id, stripe_subscription_id, stripe_customer_id, status)
	           values ($1, $2, $3, $4)
	           on conflict (stripe_subscription_id) do update set status = excluded.status, updated_at = now()`
	if b.cfg.broken("no-webhook-dedupe") {
		insert = `insert into subscriptions (account_id, stripe_subscription_id, stripe_customer_id, status)
		          values ($1, $2, $3, $4)`
	}

	err = inTx(ctx, b.db, "activate the team plan", func(tx pgx.Tx) error {
		first, err := b.firstDelivery(ctx, tx, event)
		if err != nil || !first {
			return err
		}
		_, err = tx.Exec(ctx, insert, accountID, sub.ID, customer, string(sub.Status))
		return err
	})
	return accountID, err
}

// syncStatus stores a subscription's status as Stripe has it now, after Stripe reported a change.
func (b *billing) syncStatus(ctx context.Context, event stripe.Event, id string) error {
	sub, err := b.subscription(ctx, id)
	if err != nil {
		return err
	}
	return inTx(ctx, b.db, "sync subscription status", func(tx pgx.Tx) error {
		first, err := b.firstDelivery(ctx, tx, event)
		if err != nil || !first {
			return err
		}
		_, err = tx.Exec(ctx,
			"update subscriptions set status = $2, updated_at = now() where stripe_subscription_id = $1",
			sub.ID, string(sub.Status),
		)
		return err
	})
}
