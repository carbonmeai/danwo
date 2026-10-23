package main

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/resend/resend-go/v4"
)

// welcomeSubject is the subject of the email a team gets when its plan starts.
const welcomeSubject = "Welcome to Quillwork Team"

// mailer sends each team one welcome email once its plan is active. The idempotency key is the
// account, so a retry after a timeout or a lost answer gets the first email back from Resend
// instead of sending a second. A welcome that still fails is tried again in the background: the
// plan is already committed either way.
type mailer struct {
	resend *resend.Client
	db     *pgxpool.Pool
	cfg    config
	// One send at a time, so a background retry never races the first try for the same team.
	mu sync.Mutex
}

func newMailer(cfg config, db *pgxpool.Pool, client *http.Client) *mailer {
	return &mailer{resend: resend.NewCustomClient(client, cfg.ResendAPIKey), db: db, cfg: cfg}
}

// pendingWelcome is the account's address and team when it is owed a welcome email, or ok false.
func (m *mailer) pendingWelcome(ctx context.Context, accountID int64) (email, team string, ok bool, err error) {
	err = withDB(ctx, "read welcome", func() error {
		return m.db.QueryRow(ctx,
			`select a.email, a.team,
			        a.welcome_email_id is null and exists (
			          select 1 from subscriptions s
			           where s.account_id = a.id and s.status in ('active', 'trialing'))
			   from accounts a where a.id = $1`,
			accountID,
		).Scan(&email, &team, &ok)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	return email, team, ok, err
}

// send sends one welcome email, retrying what a later attempt can get past. Resend's Go SDK
// reports most failures as plain errors, so every failure is retried a few times: the
// idempotency key makes that safe. QUILLWORK_BUG=no-idempotency-key sends without it.
func (m *mailer) send(ctx context.Context, accountID int64, email, team string) (string, error) {
	request := &resend.SendEmailRequest{
		From:    m.cfg.MailFrom,
		To:      []string{email},
		Subject: welcomeSubject,
		Text:    fmt.Sprintf("Your team %s is on the Quillwork Team plan. Invite everyone and start writing.", team),
		Html:    fmt.Sprintf("<h1>Welcome to Quillwork Team</h1><p>Your team <strong>%s</strong> is on the Team plan. Invite everyone and start writing.</p>", html.EscapeString(team)),
	}
	options := &resend.SendEmailOptions{IdempotencyKey: "welcome-" + strconv.FormatInt(accountID, 10)}

	var sent *resend.SendEmailResponse
	err := retrying(ctx, "resend emails.send", 4, func(error) bool { return true }, func() error {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()

		var err error
		if m.cfg.broken("no-idempotency-key") {
			sent, err = m.resend.Emails.SendWithContext(attempt, request)
		} else {
			sent, err = m.resend.Emails.SendWithOptions(attempt, request, options)
		}
		if errors.Is(err, resend.ErrRateLimit) {
			time.Sleep(time.Second)
		}
		return err
	})
	if err != nil {
		return "", err
	}
	return sent.Id, nil
}

// welcome sends the account its welcome email unless it has had it or is not owed one.
func (m *mailer) welcome(ctx context.Context, accountID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	email, team, owed, err := m.pendingWelcome(ctx, accountID)
	if err != nil || !owed {
		return err
	}
	id, err := m.send(ctx, accountID, email, team)
	if err != nil {
		return err
	}
	return exec(ctx, m.db, "note welcome",
		"update accounts set welcome_email_id = $2 where id = $1", accountID, id)
}

// later is how long to wait before each later try at a welcome that failed: half a minute in all.
var later = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 15 * time.Second}

// welcomeSoon sends the welcome now if it can, and otherwise keeps trying in the background, a
// little later each time.
func (m *mailer) welcomeSoon(ctx context.Context, accountID int64) {
	err := m.welcome(ctx, accountID)
	if err == nil {
		return
	}
	go func() {
		for _, wait := range later {
			slog.Warn("welcome email: trying again", "account", accountID, "in", wait, "err", err)
			time.Sleep(wait)
			if err = m.welcome(context.Background(), accountID); err == nil {
				return
			}
		}
		slog.Error("welcome email not sent", "account", accountID, "err", err)
	}()
}

// sendMissed sends, at start-up, the welcomes a stopped app never got to.
func (m *mailer) sendMissed(ctx context.Context) error {
	rows, err := m.db.Query(ctx, `select distinct a.id from accounts a join subscriptions s on s.account_id = a.id
	                              where a.welcome_email_id is null and s.status in ('active', 'trialing')`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		go m.welcomeSoon(context.Background(), id)
	}
	return nil
}
