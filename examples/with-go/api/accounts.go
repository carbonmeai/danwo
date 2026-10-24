package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// account is a team's account, with the plan its newest subscription gives it.
type account struct {
	ID    int64
	Email string
	Team  string
	// Status is the newest subscription's status as Stripe reported it, or "" on the free plan.
	Status string
}

// OnTeamPlan reports whether the account's subscription gives it the team plan.
func (a account) OnTeamPlan() bool {
	return a.Status == "active" || a.Status == "trialing"
}

// signUp creates the account for email, or finds the one that has it. Sending the form twice, or
// retrying after the answer to the INSERT was lost, lands on the same row.
func signUp(ctx context.Context, db *pgxpool.Pool, email, team string) (int64, error) {
	var id int64
	err := withDB(ctx, "sign up", func() error {
		return db.QueryRow(ctx,
			`insert into accounts (email, team) values ($1, $2)
			 on conflict (email) do update set team = excluded.team
			 returning id`,
			email, team,
		).Scan(&id)
	})
	return id, err
}

// errNoAccount is what loadAccount returns for an id with no account.
var errNoAccount = errors.New("no such account")

// loadAccount reads one account and its plan.
func loadAccount(ctx context.Context, db *pgxpool.Pool, id int64) (account, error) {
	var a account
	err := withDB(ctx, "load account", func() error {
		return db.QueryRow(ctx,
			`select a.id, a.email, a.team,
			        coalesce((select s.status from subscriptions s where s.account_id = a.id
			                  order by s.updated_at desc, s.id desc limit 1), '')
			   from accounts a where a.id = $1`,
			id,
		).Scan(&a.ID, &a.Email, &a.Team, &a.Status)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return a, errNoAccount
	}
	return a, err
}

// sessionCookie is the cookie that holds the signed-in account's id.
const sessionCookie = "quillwork_session"

// sessions signs and checks session cookies with the app's secret.
type sessions struct {
	secret []byte
}

func (s sessions) sign(id string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(id))
	return hex.EncodeToString(mac.Sum(nil))
}

// start signs the browser in as account id.
func (s sessions) start(w http.ResponseWriter, id int64) {
	value := strconv.FormatInt(id, 10)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value + "." + s.sign(value),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

// end signs the browser out.
func (s sessions) end(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1})
}

// accountID is the signed-in account's id, or false when the request has no valid session.
func (s sessions) accountID(r *http.Request) (int64, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return 0, false
	}
	value, signature, found := strings.Cut(cookie.Value, ".")
	if !found || !hmac.Equal([]byte(signature), []byte(s.sign(value))) {
		return 0, false
	}
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil
}
