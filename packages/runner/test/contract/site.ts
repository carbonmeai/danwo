/*
 * A small local site for the runner's contract tests: plain pages, no proxy, no emulators.
 * The tests that use it go through the public API only, so they keep passing across the rewrite.
 */
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

const FORM = `<!doctype html><title>Sign up</title>
<h1>Sign up</h1>
<label>Email <input name="email" type="email"></label>
<label for="nick">Nickname</label><input id="nick" placeholder="Pick a nickname">
<input aria-label="Prefilled" value="already here">
<label><input type="checkbox" name="terms"> Accept terms</label>
<label>Plan <select name="plan"><option value="free">Free</option><option value="pro">Pro</option></select></label>
<input aria-label="Search" onkeydown="if (event.key === 'Enter') status('Searched ' + this.value)">
<button type="button" onclick="status('Saved ' + document.querySelector('[name=email]').value)">Save</button>
<button type="button" disabled>Delete</button>
<p data-testid="status" title="status line">Not saved</p>
<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>
<p hidden>Hidden note</p>
<div onmouseenter="this.textContent = 'Hovered'">Hover me</div>
<a href="/">Home</a>
<script>
  function status(text) { document.querySelector('[data-testid=status]').textContent = text }
  setTimeout(() => {
    const late = document.createElement('p')
    late.textContent = 'Arrived late'
    document.body.append(late)
  }, 700)
</script>`

// `variant` renames the button, so a recording made against "Add one" no longer replays.
const counter = (variant: "a" | "b") => `<!doctype html><title>Counter</title>
<h1>Counter</h1>
<button type="button" onclick="bump()">${variant === "a" ? "Add one" : "Plus one"}</button>
<output data-testid="count">0</output>
<script>
  function bump() {
    const out = document.querySelector('[data-testid=count]')
    out.textContent = String(Number(out.textContent) + 1)
  }
</script>`

const GREET = `<!doctype html><title>Greeter</title>
<h1>Greeter</h1>
<label>Name <input name="name"></label>
<button type="button" onclick="greet()">Greet</button>
<p data-testid="greeting"></p>
<script>
  function greet() {
    const name = document.querySelector('[name=name]').value
    document.querySelector('[data-testid=greeting]').textContent = 'Hello, ' + name
  }
</script>`

const LOGIN = `<!doctype html><title>Log in</title>
<h1>Log in</h1>
<label>Password <input name="password" type="password"></label>
<label>Token <input name="token"></label>
<button type="button" onclick="document.querySelector('p').textContent = 'Submitted'">Submit</button>
<p></p>
<script>console.log('login page ready'); console.error('login page warning')</script>`

/** A settings page that prints credentials the session was never given. */
const KEYS = `<!doctype html><title>API keys</title><h1>API keys</h1>
<p>Secret key: REDACTED-TEST-VALUE</p>
<p>Signing secret: REDACTED-TEST-VALUE</p>`

const HOME = `<!doctype html><title>Contract site</title><h1>Contract site</h1><a href="/form">Form</a>`

export interface Site {
  readonly url: string
  /** Switches `/counter` between its two versions. */
  setCounterVariant(variant: "a" | "b"): void
  close(): Promise<void>
}

function page(path: string, variant: "a" | "b"): string | undefined {
  switch (path) {
    case "/":
      return HOME
    case "/form":
      return FORM
    case "/counter":
      return counter(variant)
    case "/greet":
      return GREET
    case "/login":
      return LOGIN
    case "/keys":
      return KEYS
    default:
      return undefined
  }
}

export async function startSite(): Promise<Site> {
  let variant: "a" | "b" = "a"
  const server: Server = createServer((req, res) => {
    const html = page(new URL(req.url ?? "/", "http://site").pathname, variant)

    res.writeHead(html === undefined ? 404 : 200, { "content-type": "text/html" })
    res.end(html ?? "<!doctype html><title>Not found</title><h1>Not found</h1>")
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    setCounterVariant: (next) => {
      variant = next
    },
    close: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
