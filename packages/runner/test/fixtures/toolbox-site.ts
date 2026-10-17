/**
 * A local site with the controls the agent's toolbox is for: a menu that opens on hover, a file
 * input, confirm and prompt dialogs, a link that opens a new tab, drag and drop, content that
 * arrives late, a second page to go back from, an account page to read data off (`?v=2`
 * renames its fields, `?v=3` only drops their test ids), and a settings form whose save button
 * is renamed in `?v=2` and has a look-alike in `?v=3`. Every page writes what happened to a status line, so a test can check the
 * outcome with a locator.
 */
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

const TOOLS = `<!doctype html><title>Toolbox</title>
<h1>Toolbox</h1>
<nav aria-label="Main">
  <div id="menu" onmouseenter="document.getElementById('items').hidden = false">
    <button type="button">Account</button>
    <div role="menu" id="items" hidden><a role="menuitem" href="/settings">Settings</a></div>
  </div>
</nav>
<label>Avatar <input type="file" onchange="status('Uploaded ' + this.files[0].name)"></label>
<button type="button" onclick="status(confirm('Delete the account?') ? 'Deleted' : 'Kept')">Delete account</button>
<button type="button" onclick="status('Renamed to ' + prompt('New name?', 'old'))">Rename</button>
<a href="/help" target="_blank">Help</a>
<ul aria-label="Todo"><li draggable="true" ondragstart="event.dataTransfer.setData('text', 'Task A')">Task A</li></ul>
<section aria-label="Done" ondragover="event.preventDefault()"
  ondrop="event.preventDefault(); status('Dropped ' + event.dataTransfer.getData('text'))">Drop here</section>
<button type="button" onclick="setTimeout(() => status('More loaded'), 600)">Load more</button>
<p data-testid="status">Idle</p>
<script>
  function status(text) { document.querySelector('[data-testid=status]').textContent = text }
</script>`

const SETTINGS = `<!doctype html><title>Settings</title><h1>Settings</h1><a href="/tools">Toolbox</a>`

const HELP = `<!doctype html><title>Help</title><h1>Help centre</h1>`

/** An account summary; version 2 words its fields differently, and 2 and 3 drop the test ids. */
function account(version: string | null): string {
  if (version === "2")
    return `<!doctype html><title>Account</title><h1>Account</h1>
<dl><dt>Holder</dt><dd>Ada Lovelace</dd><dt>Available</dt><dd>$1,234.50</dd></dl>
<label><input type="checkbox" checked> Automatic payments</label>`

  const id = (name: string) => (version === "3" ? "" : ` data-testid="${name}"`)

  return `<!doctype html><title>Account</title><h1>Account</h1>
<dl><dt>Owner</dt><dd${id("owner")}>Ada Lovelace</dd><dt>Balance</dt><dd${id("balance")}>$1,234.50</dd></dl>
<label><input type="checkbox" checked> Autopay</label>`
}

/** A billing form; version 2 renames its save button, version 3 adds a look-alike next to it. */
function billing(version: string | null): string {
  const buttons: Record<string, string> = {
    "2": `<button type="button" onclick="status('Saved')">Save all changes</button>`,
    "3": `<button type="button" onclick="status('Saved')">Save changes now</button>
<button type="button" onclick="status('Saved later')">Save changes later</button>`,
  }
  const save =
    buttons[version ?? ""] ??
    `<button type="button" onclick="status('Saved')">Save changes</button>`

  return `<!doctype html><title>Billing</title><h1>Billing</h1>
<form aria-label="Billing details" onsubmit="return false">
  <label>Card holder <input name="holder"></label>
  ${save}
</form>
<form aria-label="Newsletter" onsubmit="return false"><button type="button">Subscribe</button></form>
<p data-testid="status">Idle</p>
<script>function status(text) { document.querySelector('[data-testid=status]').textContent = text }</script>`
}

const PAGES: Readonly<Record<string, string>> = {
  "/tools": TOOLS,
  "/settings": SETTINGS,
  "/help": HELP,
}

export interface ToolboxSite {
  readonly url: string
  close(): Promise<void>
}

export async function startToolboxSite(): Promise<ToolboxSite> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://site")
    const version = url.searchParams.get("v")
    const built: Record<string, (v: string | null) => string> = {
      "/account": account,
      "/billing": billing,
    }
    const html = built[url.pathname]?.(version) ?? PAGES[url.pathname]

    res.writeHead(html === undefined ? 404 : 200, { "content-type": "text/html" })
    res.end(html ?? "<!doctype html><title>Not found</title><h1>Not found</h1>")
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
