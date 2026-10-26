/**
 * The benchmark app's pages: plain server-rendered HTML with a little script where a real app
 * would have some (a sortable table, a dialog, an upload, a canvas, a cross-origin widget, a
 * report that takes a moment). Every page is reachable from the navigation.
 */
import { readFileSync } from "node:fs"

import type { Bug } from "./bugs.ts"
import { type AppState, type Order, PRODUCTS } from "./state.ts"

const NAV = [
  ["/signup", "Sign up"],
  ["/checkout", "Checkout"],
  ["/orders", "Orders"],
  ["/settings", "Settings"],
  ["/products", "Products"],
  ["/projects", "Projects"],
  ["/upload", "Upload"],
  ["/newsletter", "Newsletter"],
  ["/approve", "Approve"],
  ["/team", "Team"],
  ["/report", "Report"],
] as const

/** Escapes text for HTML. */
function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

/** A whole page: the navigation, a heading and `body`. */
export function page(title: string, body: string): string {
  const links = NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join(" · ")

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Bench</title>
<style>body{font:15px system-ui;margin:2rem;max-width:56rem}nav{margin-bottom:1rem}td,th{padding:.25rem .75rem;text-align:left}
.error{color:#b42318}dialog{padding:1.5rem}</style></head>
<body><nav aria-label="Main">${links}</nav><main><h1>${esc(title)}</h1>${body}</main></body></html>`
}

export function home(): string {
  return page("Bench", "<p>A small app with one page per thing worth testing.</p>")
}

export function signupForm(): string {
  return page(
    "Sign up",
    `<form method="post" action="/signup"><label>Email <input name="email" type="email" required></label>
<button>Send code</button></form>`,
  )
}

export function signupCode(email: string, wrong: boolean): string {
  const notice = wrong ? `<p role="alert" class="error">That code is not right.</p>` : ""

  return page(
    "Check your email",
    `<p>We sent a code to ${esc(email)}.</p>${notice}
<form method="post" action="/signup/verify"><input type="hidden" name="email" value="${esc(email)}">
<label>Code <input name="code" inputmode="numeric"></label><button>Verify</button></form>`,
  )
}

export function welcome(email: string): string {
  return page("Welcome", `<p role="status">Signed up as ${esc(email)}</p>`)
}

/** Two Pro seats at $12; `wrong-total` shows the price of one as the total. */
export function cart(bugs: ReadonlySet<Bug>): string {
  const total = bugs.has("wrong-total") ? "$12.00" : "$24.00"

  return page(
    "Checkout",
    `<table><tr><th>Item</th><th>Qty</th><th>Price</th></tr><tr><td>Pro seat</td><td>2</td><td>$12.00</td></tr></table>
<p>Total: <strong data-testid="cart-total">${total}</strong></p>
<form method="post" action="/checkout/confirm"><button>Continue to payment</button></form>`,
  )
}

/** The extra step a card payment can ask for before the customer reaches the payment page. */
export function challenge(): string {
  return page(
    "Confirm it's you",
    `<p>Your bank asks you to approve this payment of $24.00.</p>
<form method="post" action="/checkout/pay"><button>Approve payment</button></form>`,
  )
}

export function paymentError(message: string): string {
  return page("Payment problem", `<p role="alert" class="error">${esc(message)}</p>`)
}

function orderRow(order: Order): string {
  return `<tr><td><a href="/orders/${order.id}">${order.id}</a></td><td>${order.seats} seats</td><td>${order.status === "paid" ? "Paid" : "Pending"}</td></tr>`
}

export function orderList(state: AppState): string {
  const rows = state.orders.map(orderRow).join("")
  const empty = state.orders.length === 0 ? "<p>No orders yet.</p>" : ""

  return page(
    "Orders",
    `${empty}<table aria-label="Orders"><tr><th>Order</th><th>Seats</th><th>Status</th></tr>${rows}</table>
<p role="status">Credits: ${state.credits}</p>`,
  )
}

/** While an order waits for its payment event, the page looks again every 700 ms. */
const WATCH_ORDER = "<script>setTimeout(()=>location.reload(),700)</script>"

export function orderPage(order: Order, credits: number): string {
  const status = order.status === "paid" ? "Paid" : "Pending"

  return page(
    `Order ${order.id}`,
    `<p>Status: <strong data-testid="order-status">${status}</strong></p><p role="status">Credits: ${credits}</p>${
      order.status === "paid" ? "" : WATCH_ORDER
    }`,
  )
}

/** One settings field with its error, if any. */
function field(label: string, name: string, value: string, error: string | undefined): string {
  const message = error === undefined ? "" : `<span role="alert" class="error">${esc(error)}</span>`

  return `<p><label>${label} <input name="${name}" value="${esc(value)}"></label> ${message}</p>`
}

export function settingsForm(
  values: { name: string; email: string; age: string },
  errors: Readonly<Record<string, string>>,
  saved: boolean,
): string {
  const notice = saved ? `<p role="status">Settings saved</p>` : ""

  return page(
    "Settings",
    `${notice}<form method="post" action="/settings">${field("Name", "name", values.name, errors.name)}
${field("Email", "email", values.email, errors.email)}${field("Age", "age", values.age, errors.age)}
<button>Save settings</button></form>`,
  )
}

/** The product table: sortable, filterable, ten rows a page; `dead-second-click` breaks Next. */
export function products(bugs: ReadonlySet<Bug>): string {
  const data = JSON.stringify(PRODUCTS)
  const dead = bugs.has("dead-second-click")

  return page(
    "Products",
    `<label>Filter <input id="filter" placeholder="Name or category"></label>
<table aria-label="Products"><thead><tr><th><button data-sort="name">Name</button></th><th>Category</th>
<th><button data-sort="price">Price</button></th></tr></thead><tbody id="rows"></tbody></table>
<p><button id="prev">Previous</button> <span id="where" role="status"></span> <button id="next">Next</button></p>
<script>
const all=${data};let page=0,key="id",dir=1,q="",nexts=0;
const shown=()=>all.filter(p=>(p.name+" "+p.category).toLowerCase().includes(q)).sort((a,b)=>(a[key]>b[key]?1:-1)*dir);
function draw(){const list=shown(),pages=Math.max(1,Math.ceil(list.length/10));page=Math.min(page,pages-1);
rows.innerHTML=list.slice(page*10,page*10+10).map(p=>"<tr><td>"+p.name+"</td><td>"+p.category+"</td><td>$"+p.price+"</td></tr>").join("");
where.textContent="Page "+(page+1)+" of "+pages+" · "+list.length+" products";}
document.querySelectorAll("[data-sort]").forEach(b=>b.onclick=()=>{const k=b.dataset.sort;dir=key===k?-dir:1;key=k;draw();});
filter.oninput=()=>{q=filter.value.toLowerCase();page=0;draw();};
prev.onclick=()=>{page=Math.max(0,page-1);draw();};
next.onclick=()=>{nexts++;if(${dead}&&nexts>1)return;page++;draw();};
draw();
</script>`,
  )
}

export function projects(state: AppState): string {
  const items = state.projects
    .map(
      (p) =>
        `<li>${esc(p.name)} <button data-id="${p.id}" data-name="${esc(p.name)}">Delete ${esc(p.name)}</button></li>`,
    )
    .join("")

  return page(
    "Projects",
    `<ul aria-label="Projects">${items}</ul><p role="status">${state.projects.length} projects</p>
<dialog id="removal" aria-labelledby="ask"><p id="ask"></p><form method="post" action="/projects/delete">
<input type="hidden" name="id" id="pick"><button>Delete project</button> <button type="button" id="cancel">Cancel</button></form></dialog>
<script>
document.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>{pick.value=b.dataset.id;ask.textContent="Delete "+b.dataset.name+"? This cannot be undone.";removal.showModal();});
cancel.onclick=()=>removal.close();
</script>`,
  )
}

export function upload(state: AppState): string {
  const last = state.uploads.at(-1)
  const done = last ? `<p role="status">Uploaded ${esc(last.name)} (${last.bytes} bytes)</p>` : ""

  return page(
    "Upload",
    `${done}<form id="send"><label>Attachment <input type="file" id="file"></label><button>Upload file</button></form>
<script>
send.onsubmit=async e=>{e.preventDefault();const f=file.files[0];if(!f)return;
await fetch("/upload",{method:"POST",headers:{"x-file-name":encodeURIComponent(f.name)},body:f});location.reload();};
</script>`,
  )
}

/** The newsletter page embeds a sign-up widget served from another origin. */
export function newsletter(state: AppState, widgetOrigin: string): string {
  const last = state.subscribers.at(-1)
  const done = last ? `<p role="status">Subscribed: ${esc(last)}</p>` : ""

  return page(
    "Newsletter",
    `${done}<iframe title="Newsletter sign-up" src="${widgetOrigin}/widget" width="420" height="140"></iframe>
<script>
addEventListener("message",async e=>{if(e.origin!=="${widgetOrigin}"||!e.data||!e.data.subscribe)return;
await fetch("/newsletter/subscribe",{method:"POST",body:e.data.subscribe});location.reload();});
</script>`,
  )
}

/** The widget itself, as its own origin serves it. */
export function widget(parentOrigin: string): string {
  return `<!doctype html><html lang="en"><body style="font:14px system-ui">
<form id="w"><label>Your email <input id="email" type="email"></label> <button>Subscribe</button></form>
<script>w.onsubmit=e=>{e.preventDefault();parent.postMessage({subscribe:email.value},"${parentOrigin}");};</script></body></html>`
}

/**
 * The drawn button, green with "Approve" in white, as a picture. Text drawn on a canvas takes the
 * machine's own font (San Francisco on macOS, DejaVu Sans on Linux) and its own rasterizer, so a
 * recording of the button made on one machine would not look the same on another; a picture is
 * drawn with the same pixels everywhere.
 */
const APPROVE_BUTTON = `data:image/png;base64,${readFileSync(new URL("./approve-button.png", import.meta.url)).toString("base64")}`

/** A canvas with one drawn button in its middle; clicking inside it approves. */
export function approve(state: AppState): string {
  const done = state.approved
    ? `<p role="status">Approved</p>`
    : `<p role="status">Waiting for approval</p>`

  return page(
    "Approve",
    `${done}<canvas id="board" data-testid="board" aria-label="Approval board" width="400" height="200" style="border:1px solid #ccc"></canvas>
<script>
const c=board.getContext("2d");c.fillStyle="#f4f4f5";c.fillRect(0,0,400,200);
const button=new Image();button.onload=()=>c.drawImage(button,140,75);button.src="${APPROVE_BUTTON}";
board.onclick=async e=>{const r=board.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
if(x>=140&&x<=260&&y>=75&&y<=125){await fetch("/approve",{method:"POST"});location.reload();}};
</script>`,
  )
}

export function team(state: AppState): string {
  const done = state.notified > 0 ? `<p role="status">Team notified</p>` : ""

  return page(
    "Team",
    `${done}<form method="post" action="/team/notify"><button>Notify the team</button></form>`,
  )
}

/** A report that takes 1.5 seconds to build, the same every time. */
export function report(): string {
  return page(
    "Report",
    `<button id="go">Generate report</button> <p role="status" id="state">No report yet</p>
<script>
go.onclick=()=>{state.textContent="Generating…";setTimeout(async()=>{const r=await (await fetch("/report/data")).json();
state.textContent="Ready: "+r.rows+" rows";},1500);};
</script>`,
  )
}
