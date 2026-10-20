/**
 * A stand-in for Stripe.js (`js.stripe.com`), served by the Stripe emulator so a page that loads
 * Stripe.js works in a run instead of failing to load it. The real script cannot be served: it
 * talks to Stripe's own iframes and fraud services. This one covers what apps commonly call:
 *
 * - `Stripe(key)`, as `loadStripe` and `@stripe/react-stripe-js` expect it;
 * - `elements()` with `create`, `getElement`, `update`, `submit` and `fetchUpdates`; elements of
 *   type `card`, `cardNumber`, `cardExpiry`, `cardCvc`, `payment`, `address`, `linkAuthentication`
 *   and `expressCheckout`, mounted as plain inputs a test can fill (the card number is labelled
 *   "Card number" and accepts Stripe's test numbers);
 * - `createPaymentMethod`, `confirmCardPayment`, `confirmCardSetup`, `confirmPayment`,
 *   `confirmSetup`, `retrievePaymentIntent`, `retrieveSetupIntent`, each a call to the emulator's
 *   API with the publishable key and the intent's client secret, as Stripe.js makes them;
 * - `redirectToCheckout({ sessionId })`, which opens the session's hosted page;
 * - `paymentRequest()`, which reports that no wallet is available.
 *
 * Anything else answers `{ error }` rather than throwing, so a page degrades the way it would
 * when Stripe declines.
 */

/** The script, as served at `js.stripe.com/v3` and every `js.stripe.com/<version>/stripe.js`. */
export const STRIPE_JS = String.raw`(function () {
  "use strict";
  if (window.Stripe) return;

  var API = "https://api.stripe.com/v1/";
  var CHECKOUT = "https://checkout.stripe.com/";
  var TEST_NUMBERS = {
    "4242424242424242": "visa",
    "4000056655665556": "visa_debit",
    "5555555555554444": "mastercard",
    "378282246310005": "amex",
    "4000000000000002": "chargeDeclined",
    "4000000000000341": "chargeCustomerFail",
    "4000002500003155": "authenticationRequired",
    "4000002760003184": "authenticationRequired"
  };

  function form(params, prefix, out) {
    out = out || [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      var name = prefix ? prefix + "[" + key + "]" : key;
      if (value === undefined || value === null) return;
      if (typeof value === "object") form(value, name, out);
      else out.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(value)));
    });
    return out.join("&");
  }

  function idOf(clientSecret) {
    return String(clientSecret || "").split("_secret_")[0];
  }

  function call(key, method, path, params) {
    var body = form(params);
    var url = API + path + (method === "GET" && body ? "?" + body : "");
    return fetch(url, {
      method: method,
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: method === "GET" ? undefined : body
    }).then(function (response) {
      return response.json().then(function (json) {
        return response.ok ? json : { error: (json && json.error) || { message: "Request failed" } };
      });
    }, function (error) {
      return { error: { type: "api_connection_error", message: String(error && error.message || error) } };
    });
  }

  function Element(type, options) {
    this.type = type;
    this.options = options || {};
    this.handlers = {};
    this.node = null;
    this.fields = {};
  }

  Element.prototype.on = function (event, handler) {
    (this.handlers[event] = this.handlers[event] || []).push(handler);
    return this;
  };
  Element.prototype.off = function (event, handler) {
    this.handlers[event] = (this.handlers[event] || []).filter(function (h) { return h !== handler; });
    return this;
  };
  Element.prototype.once = function (event, handler) {
    var self = this;
    var wrapped = function (payload) { self.off(event, wrapped); handler(payload); };
    return this.on(event, wrapped);
  };
  Element.prototype.emit = function (event, payload) {
    (this.handlers[event] || []).slice().forEach(function (h) { h(payload); });
  };
  Element.prototype.inputsFor = function () {
    switch (this.type) {
      case "card":
      case "payment":
        return [["number", "Card number", "4242 4242 4242 4242"], ["expiry", "Expiration date", "12 / 34"], ["cvc", "Security code", "123"]];
      case "cardNumber": return [["number", "Card number", "4242 4242 4242 4242"]];
      case "cardExpiry": return [["expiry", "Expiration date", "12 / 34"]];
      case "cardCvc": return [["cvc", "Security code", "123"]];
      case "address":
        return [["name", "Full name", ""], ["line1", "Address line 1", ""], ["city", "City", ""], ["postal_code", "Postal code", ""], ["country", "Country", "US"]];
      case "linkAuthentication": return [["email", "Email", ""]];
      default: return [];
    }
  };
  Element.prototype.value = function () {
    var f = this.fields;
    if (this.type === "address") {
      return {
        name: f.name || "",
        address: { line1: f.line1 || "", city: f.city || "", postal_code: f.postal_code || "", country: f.country || "US" }
      };
    }
    if (this.type === "linkAuthentication") return { email: f.email || "" };
    return { postalCode: "" };
  };
  Element.prototype.complete = function () {
    var f = this.fields;
    var self = this;
    return this.inputsFor().every(function (input) {
      var name = input[0];
      return self.type === "address" && name !== "name" && name !== "line1" ? true : Boolean(f[name]);
    });
  };
  Element.prototype.change = function () {
    var empty = Object.keys(this.fields).every(function (k) { return !this.fields[k]; }, this);
    this.emit("change", {
      elementType: this.type,
      empty: empty,
      complete: this.complete(),
      error: undefined,
      value: this.value(),
      brand: "visa"
    });
  };
  Element.prototype.mount = function (target) {
    var node = typeof target === "string" ? document.querySelector(target) : target;
    if (!node) throw new Error("Stripe: the element to mount into was not found");
    var self = this;
    var box = document.createElement("div");
    box.setAttribute("data-danwo-stripe-element", this.type);
    this.inputsFor().forEach(function (input) {
      var field = document.createElement("input");
      field.name = input[0];
      field.setAttribute("aria-label", input[1]);
      field.placeholder = input[2] || input[1];
      field.autocomplete = "off";
      field.addEventListener("input", function () {
        self.fields[input[0]] = field.value;
        self.change();
      });
      field.addEventListener("focus", function () { self.emit("focus", { elementType: self.type }); });
      field.addEventListener("blur", function () { self.emit("blur", { elementType: self.type }); });
      box.appendChild(field);
    });
    node.appendChild(box);
    this.node = box;
    setTimeout(function () { self.emit("ready", { elementType: self.type }); }, 0);
    return this;
  };
  Element.prototype.unmount = function () {
    if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
    this.node = null;
  };
  Element.prototype.destroy = function () { this.unmount(); this.handlers = {}; };
  Element.prototype.update = function (options) { this.options = Object.assign({}, this.options, options); };
  Element.prototype.focus = function () { var i = this.node && this.node.querySelector("input"); if (i) i.focus(); };
  Element.prototype.blur = function () { var i = this.node && this.node.querySelector("input"); if (i) i.blur(); };
  Element.prototype.clear = function () {
    this.fields = {};
    if (this.node) this.node.querySelectorAll("input").forEach(function (i) { i.value = ""; });
  };
  Element.prototype.collapse = function () {};
  Element.prototype.getValue = function () {
    return Promise.resolve({ complete: this.complete(), isNewAddress: true, value: this.value() });
  };
  Element.prototype.cardToken = function () {
    var number = String(this.fields.number || "4242424242424242").replace(/\D/g, "");
    return "tok_" + (TEST_NUMBERS[number] || "visa");
  };

  function Elements(stripe, options) {
    this.stripe = stripe;
    this.options = options || {};
    this.elements = {};
  }
  Elements.prototype.create = function (type, options) {
    var element = new Element(type, options);
    this.elements[type] = element;
    return element;
  };
  Elements.prototype.getElement = function (type) {
    if (typeof type !== "string") type = type && type.type;
    return this.elements[type] || null;
  };
  Elements.prototype.update = function (options) { this.options = Object.assign({}, this.options, options); };
  Elements.prototype.submit = function () { return Promise.resolve({}); };
  Elements.prototype.fetchUpdates = function () { return Promise.resolve({}); };
  Elements.prototype.card = function () {
    return this.elements.card || this.elements.payment || this.elements.cardNumber || null;
  };

  function cardOf(source) {
    if (!source) return null;
    if (source instanceof Element) return source;
    if (source instanceof Elements) return source.card();
    return null;
  }

  function Stripe(key, options) {
    if (!(this instanceof Stripe)) return new Stripe(key, options);
    if (!key) throw new Error("Stripe: provide a publishable key");
    this.key = key;
    this.options = options || {};
    this.lastElements = null;
  }

  Stripe.prototype._registerWrapper = function () {};
  Stripe.prototype.registerAppInfo = function () {};
  Stripe.prototype.elements = function (options) {
    this.lastElements = new Elements(this, options);
    return this.lastElements;
  };

  Stripe.prototype.newMethod = function (card, extra) {
    var element = cardOf(card) || (this.lastElements && this.lastElements.card());
    var params = Object.assign({ type: "card", card: { token: element ? element.cardToken() : "tok_visa" } }, extra || {});
    return call(this.key, "POST", "payment_methods", params);
  };

  Stripe.prototype.createPaymentMethod = function (data) {
    data = data || {};
    var extra = {};
    if (data.billing_details) extra.billing_details = data.billing_details;
    if (data.metadata) extra.metadata = data.metadata;
    var card = data.card || data.elements;
    return this.newMethod(card, extra).then(function (result) {
      return result.error ? result : { paymentMethod: result };
    });
  };
  Stripe.prototype.createToken = function () {
    return Promise.resolve({ error: { type: "invalid_request_error", message: "Tokens are not supported in this test environment; use payment methods" } });
  };
  Stripe.prototype.createSource = Stripe.prototype.createToken;

  Stripe.prototype.methodFor = function (data) {
    data = data || {};
    var method = data.payment_method;
    if (typeof method === "string") return Promise.resolve(method);
    var self = this;
    var card = method && method.card;
    if (!card && !(this.lastElements && this.lastElements.card())) return Promise.resolve(undefined);
    return this.newMethod(card, method && method.billing_details ? { billing_details: method.billing_details } : {}).then(function (result) {
      if (result.error) throw result;
      return result.id;
    });
  };

  Stripe.prototype.confirmIntent = function (kind, clientSecret, data, redirect) {
    var self = this;
    var plural = kind === "paymentIntent" ? "payment_intents" : "setup_intents";
    return this.methodFor(data).then(function (method) {
      var params = { client_secret: clientSecret };
      if (method) params.payment_method = method;
      if (data && data.return_url) params.return_url = data.return_url;
      return call(self.key, "POST", plural + "/" + idOf(clientSecret) + "/confirm", params);
    }, function (failed) { return failed; }).then(function (result) {
      if (result.error) return result;
      var answer = {};
      answer[kind] = result;
      if (redirect && result.status !== "requires_action" && result.status !== "requires_payment_method") {
        var url = new URL(redirect);
        url.searchParams.set(kind === "paymentIntent" ? "payment_intent" : "setup_intent", result.id);
        url.searchParams.set(kind === "paymentIntent" ? "payment_intent_client_secret" : "setup_intent_client_secret", clientSecret);
        url.searchParams.set("redirect_status", result.status === "succeeded" ? "succeeded" : "processing");
        window.location.assign(url.toString());
      }
      if (result.status === "requires_action" || result.status === "requires_payment_method") {
        var error = result.last_payment_error || result.last_setup_error;
        if (error) return { error: error };
      }
      return answer;
    });
  };

  Stripe.prototype.confirmCardPayment = function (clientSecret, data) {
    return this.confirmIntent("paymentIntent", clientSecret, data);
  };
  Stripe.prototype.confirmCardSetup = function (clientSecret, data) {
    return this.confirmIntent("setupIntent", clientSecret, data);
  };
  Stripe.prototype.confirmPayment = function (options) {
    options = options || {};
    var params = options.confirmParams || {};
    var secret = options.clientSecret || (options.elements && options.elements.options.clientSecret);
    var redirect = options.redirect === "if_required" ? undefined : params.return_url;
    return this.confirmIntent("paymentIntent", secret, { payment_method: params.payment_method, return_url: params.return_url }, redirect);
  };
  Stripe.prototype.confirmSetup = function (options) {
    options = options || {};
    var params = options.confirmParams || {};
    var secret = options.clientSecret || (options.elements && options.elements.options.clientSecret);
    var redirect = options.redirect === "if_required" ? undefined : params.return_url;
    return this.confirmIntent("setupIntent", secret, { payment_method: params.payment_method, return_url: params.return_url }, redirect);
  };
  Stripe.prototype.retrievePaymentIntent = function (clientSecret) {
    return call(this.key, "GET", "payment_intents/" + idOf(clientSecret), { client_secret: clientSecret }).then(function (result) {
      return result.error ? result : { paymentIntent: result };
    });
  };
  Stripe.prototype.retrieveSetupIntent = function (clientSecret) {
    return call(this.key, "GET", "setup_intents/" + idOf(clientSecret), { client_secret: clientSecret }).then(function (result) {
      return result.error ? result : { setupIntent: result };
    });
  };
  Stripe.prototype.handleCardAction = function (clientSecret) { return this.retrievePaymentIntent(clientSecret); };
  Stripe.prototype.handleNextAction = function (options) { return this.retrievePaymentIntent(options && options.clientSecret); };
  Stripe.prototype.redirectToCheckout = function (options) {
    if (!options || !options.sessionId) {
      return Promise.resolve({ error: { type: "invalid_request_error", message: "redirectToCheckout needs a sessionId here" } });
    }
    window.location.assign(CHECKOUT + "checkout/" + encodeURIComponent(options.sessionId));
    return new Promise(function () {});
  };
  Stripe.prototype.paymentRequest = function () {
    return { canMakePayment: function () { return Promise.resolve(null); }, on: function () {}, off: function () {}, show: function () {}, update: function () {}, isShowing: function () { return false; } };
  };

  /*
   * The version the page asked for, read from its script URL (js.stripe.com/dahlia/stripe.js is
   * "dahlia", /v3 is 3), as @stripe/stripe-js checks Stripe.version against the one it expects.
   */
  var source = (document.currentScript && document.currentScript.src) || "";
  var named = /js\.stripe\.com\/([^/?#]+)\/stripe\.js/.exec(source);
  Stripe.version = named ? named[1] : 3;

  window.Stripe = Stripe;
})();
`
