package main

import (
	"embed"
	"encoding/json"
	"errors"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
)

//go:embed templates/*.gohtml kit/kit.css
var assets embed.FS

// server is the app's HTTP side: its pages, the checkout button and Stripe's webhook.
type server struct {
	db       *pgxpool.Pool
	cfg      config
	sessions sessions
	billing  *billing
	mailer   *mailer
	pages    map[string]*template.Template
}

// page is what every template is rendered with.
type page struct {
	Title   string
	Nav     string
	Account *account
	// Refresh reloads the page every second, while a payment is being confirmed.
	Refresh bool
	Error   string
	Form    signUpForm
}

// signUpForm is the sign-up form as it was sent, with what is wrong with it.
type signUpForm struct {
	Email, Team           string
	EmailError, TeamError string
}

// parsePages parses each page with the layout around it.
func parsePages() (map[string]*template.Template, error) {
	pages := map[string]*template.Template{}
	for _, name := range []string{"home", "account"} {
		t, err := template.ParseFS(assets, "templates/layout.gohtml", "templates/"+name+".gohtml")
		if err != nil {
			return nil, err
		}
		pages[name] = t
	}
	return pages, nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("POST /signup", s.signUp)
	mux.HandleFunc("GET /account", s.account)
	mux.HandleFunc("POST /billing/checkout", s.checkout)
	mux.HandleFunc("POST /signout", s.signOut)
	mux.HandleFunc("POST /webhooks/stripe", s.stripeWebhook)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	})
	mux.Handle("GET /kit/", http.FileServerFS(assets))
	return mux
}

func (s *server) render(w http.ResponseWriter, status int, name string, data page) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := s.pages[name].ExecuteTemplate(w, "layout", data); err != nil {
		slog.Error("render", "page", name, "err", err)
	}
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

func (s *server) home(w http.ResponseWriter, r *http.Request) {
	a, err := s.signedIn(r)
	if err != nil {
		http.Error(w, "the database is not answering", http.StatusServiceUnavailable)
		return
	}
	s.render(w, http.StatusOK, "home", page{Title: "Plans", Nav: "plans", Account: a})
}

func (s *server) signUp(w http.ResponseWriter, r *http.Request) {
	form := signUpForm{
		Email: strings.TrimSpace(r.PostFormValue("email")),
		Team:  strings.TrimSpace(r.PostFormValue("team")),
	}
	if address, err := mail.ParseAddress(form.Email); err != nil || address.Address != form.Email || !strings.Contains(form.Email, ".") {
		form.EmailError = "Enter a valid email address."
	}
	if form.Team == "" {
		form.TeamError = "Give your team a name."
	}
	if form.EmailError != "" || form.TeamError != "" {
		s.render(w, http.StatusUnprocessableEntity, "home", page{Title: "Plans", Nav: "plans", Form: form})
		return
	}

	id, err := signUp(r.Context(), s.db, strings.ToLower(form.Email), form.Team)
	if err != nil {
		slog.Error("sign up", "err", err)
		s.render(w, http.StatusServiceUnavailable, "home", page{
			Title: "Plans", Nav: "plans", Form: form,
			Error: "We could not create your account just now. Try again in a moment.",
		})
		return
	}
	s.sessions.start(w, id)
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}

func (s *server) account(w http.ResponseWriter, r *http.Request) {
	a, err := s.signedIn(r)
	if err != nil {
		http.Error(w, "the database is not answering", http.StatusServiceUnavailable)
		return
	}
	if a == nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	// Back from Stripe: the webhook that starts the plan may land a moment after the team does.
	confirming := r.URL.Query().Get("checkout") != "" && !a.OnTeamPlan()
	s.render(w, http.StatusOK, "account", page{Title: "Account", Nav: "account", Account: a, Refresh: confirming})
}

func (s *server) checkout(w http.ResponseWriter, r *http.Request) {
	a, err := s.signedIn(r)
	if err != nil || a == nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	if a.OnTeamPlan() {
		http.Redirect(w, r, "/account", http.StatusSeeOther)
		return
	}
	url, err := s.billing.startCheckout(r.Context(), *a)
	if err != nil {
		slog.Error("start checkout", "account", a.ID, "err", err)
		s.render(w, http.StatusBadGateway, "account", page{
			Title: "Account", Nav: "account", Account: a,
			Error: "Stripe could not start the checkout. Try again in a moment.",
		})
		return
	}
	http.Redirect(w, r, url, http.StatusSeeOther)
}

func (s *server) signOut(w http.ResponseWriter, r *http.Request) {
	s.sessions.end(w)
	http.Redirect(w, r, "/", http.StatusSeeOther)
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
