package main

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
)

// server is the app's HTTP side: the JSON API the web app calls, Stripe's webhook, and the web
// app's own files.
type server struct {
	db       *pgxpool.Pool
	cfg      config
	sessions sessions
	billing  *billing
	mailer   *mailer
	web      http.Handler
}

// accountJSON is an account as the API sends it.
type accountJSON struct {
	Email string `json:"email"`
	Team  string `json:"team"`
	// Plan is "team" while the newest subscription is active or trialing, and "free" otherwise.
	Plan string `json:"plan"`
	// Status is the newest subscription's status as Stripe reported it, or "" on the free plan.
	Status string `json:"status"`
}

func toJSON(a account) accountJSON {
	plan := "free"
	if a.OnTeamPlan() {
		plan = "team"
	}
	return accountJSON{Email: a.Email, Team: a.Team, Plan: plan, Status: a.Status}
}

// problem is the body of every error the API answers: a message to show, and for a form, what is
// wrong with each field.
type problem struct {
	Error  string            `json:"error"`
	Fields map[string]string `json:"fields,omitempty"`
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("POST /api/signup", s.signUp)
	mux.HandleFunc("POST /api/signout", s.signOut)
	mux.HandleFunc("POST /api/billing/checkout", s.checkout)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, problem{Error: "no such endpoint"})
	})
	mux.HandleFunc("POST /webhooks/stripe", s.stripeWebhook)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	})
	mux.Handle("/", s.web)
	return jsonOnly(mux)
}

// jsonOnly refuses an API write whose body is not JSON. A form on another site can post to the
// API with the browser's cookie, but only as a form or plain text: a JSON body from another
// origin needs CORS, which this API never grants. With the cookie's SameSite=Lax, that keeps
// other sites from acting for a signed-in team.
func jsonOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/") {
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				writeJSON(w, http.StatusUnsupportedMediaType, problem{Error: "send JSON"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write json", "err", err)
	}
}

// unavailable answers a request the database could not serve, even after its retries.
func unavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, problem{Error: "Quillwork is not answering just now. Try again in a moment."})
}

// signedIn is the request's account, or nil when it has none.
func (s *server) signedIn(r *http.Request) (*account, error) {
	id, ok := s.sessions.accountID(r)
	if !ok {
		return nil, nil
	}
	a, err := loadAccount(r.Context(), s.db, id)
	if errors.Is(err, errNoAccount) {
		return nil, nil
	}
	return &a, err
}

// sessionJSON is who the browser is signed in as: an account, or null when it is not signed in.
type sessionJSON struct {
	Account *accountJSON `json:"account"`
}

// session answers the signed-in team's account and plan. A browser with no session gets a null
// account rather than an error, since every visitor's first page asks.
func (s *server) session(w http.ResponseWriter, r *http.Request) {
	a, err := s.signedIn(r)
	if err != nil {
		slog.Error("load account", "err", err)
		unavailable(w)
		return
	}
	if a == nil {
		writeJSON(w, http.StatusOK, sessionJSON{})
		return
	}
	account := toJSON(*a)
	writeJSON(w, http.StatusOK, sessionJSON{Account: &account})
}

// signUpRequest is the sign-up form as the web app sends it.
type signUpRequest struct {
	Email string `json:"email"`
	Team  string `json:"team"`
}

// signUp creates the team's account and signs the browser in. Sending it twice, or again after
// its answer was lost, lands on the same account.
func (s *server) signUp(w http.ResponseWriter, r *http.Request) {
	var form signUpRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14)).Decode(&form); err != nil {
		writeJSON(w, http.StatusBadRequest, problem{Error: "unreadable sign-up"})
		return
	}
	form.Email = strings.TrimSpace(form.Email)
	form.Team = strings.TrimSpace(form.Team)

	fields := map[string]string{}
	if address, err := mail.ParseAddress(form.Email); err != nil || address.Address != form.Email || !strings.Contains(form.Email, ".") {
		fields["email"] = "Enter a valid email address."
	}
	if form.Team == "" {
		fields["team"] = "Give your team a name."
	}
	if len(fields) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, problem{Error: "Check the form.", Fields: fields})
		return
	}

	id, err := signUp(r.Context(), s.db, strings.ToLower(form.Email), form.Team)
	if err != nil {
		slog.Error("sign up", "err", err)
		writeJSON(w, http.StatusServiceUnavailable, problem{Error: "We could not create your account just now. Try again in a moment."})
		return
	}
	a, err := loadAccount(r.Context(), s.db, id)
	if err != nil {
		slog.Error("load account", "account", id, "err", err)
		unavailable(w)
		return
	}
	s.sessions.start(w, id)
	writeJSON(w, http.StatusCreated, toJSON(a))
}

// checkoutJSON is where the browser goes to pay: Stripe's Checkout page.
type checkoutJSON struct {
	URL string `json:"url"`
}

// checkout starts Stripe Checkout for the Team plan and answers the URL of Stripe's page.
func (s *server) checkout(w http.ResponseWriter, r *http.Request) {
	a, err := s.signedIn(r)
	if err != nil {
		slog.Error("load account", "err", err)
		unavailable(w)
		return
	}
	if a == nil {
		writeJSON(w, http.StatusUnauthorized, problem{Error: "not signed in"})
		return
	}
	if a.OnTeamPlan() {
		writeJSON(w, http.StatusConflict, problem{Error: "Your team is already on the Team plan."})
		return
	}
	url, err := s.billing.startCheckout(r.Context(), *a)
	if err != nil {
		slog.Error("start checkout", "account", a.ID, "err", err)
		writeJSON(w, http.StatusBadGateway, problem{Error: "Stripe could not start the checkout. Try again in a moment."})
		return
	}
	writeJSON(w, http.StatusOK, checkoutJSON{URL: url})
}

func (s *server) signOut(w http.ResponseWriter, r *http.Request) {
	s.sessions.end(w)
	w.WriteHeader(http.StatusNoContent)
}

// stripeWebhook acts on Stripe's events. Every delivery's signature is checked first, so a forged
// or stale one is refused and changes nothing. Anything that fails answers 500, and Stripe
// delivers the event again later.
func (s *server) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	if err != nil {
		http.Error(w, "unreadable body", http.StatusBadRequest)
		return
	}
	event, err := webhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), s.cfg.StripeWebhookSecret)
	if err != nil {
		http.Error(w, "bad signature", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	switch event.Type {
	case "checkout.session.completed":
		var session stripe.CheckoutSession
		if err = json.Unmarshal(event.Data.Raw, &session); err != nil {
			break
		}
		var accountID int64
		accountID, err = s.billing.activate(ctx, event, session)
		// The welcome goes out however the plan got here: this delivery, an earlier one, or a
		// retry whose COMMIT answer was lost. It does nothing once sent.
		if err == nil && accountID != 0 {
			s.mailer.welcomeSoon(ctx, accountID)
		}
	case "customer.subscription.updated", "customer.subscription.deleted":
		var sub stripe.Subscription
		if err = json.Unmarshal(event.Data.Raw, &sub); err != nil {
			break
		}
		err = s.billing.syncStatus(ctx, event, sub.ID)
	}

	if err != nil {
		slog.Error("stripe webhook", "event", event.ID, "type", event.Type, "err", err)
		http.Error(w, "try again later", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"received":true}`)
}
