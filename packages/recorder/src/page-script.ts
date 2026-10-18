/**
 * Runs inside every page of a recording, before the page's own scripts. It reports what the person
 * does (clicks, typing, choices, keys) to the recorder, and shows a small toolbar to stop, to add an
 * assertion by clicking an element, and to add a note.
 *
 * A click on something that could leave the page is held until the recorder has found the
 * element's locator, then clicked again, so the element is still there to be described. Password
 * fields are reported as secrets without their value. Nothing here runs in Node: the recorder reads
 * this file, strips its types and installs it in the browser.
 */

/** The page function the recorder exposes; it answers once the event is recorded. */
const BINDING = "__danwoRecord"
/** The attribute that names an element for the recorder while it is described. */
const TAG = "data-danwo-rec"
const TOOLBAR = "danwo-recorder"
const PREFIX = Math.random().toString(36).slice(2, 8)

let counter = 0
let assertMode = false

/** What the page sends: what happened, and on which element; the recorder checks each field. */
type Payload = Readonly<Record<string, string | boolean>> & { readonly kind: string }

/** Elements a click is meant for, nearest first: the control, not the icon inside it. */
const CLICKABLE =
  "a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=option],[data-testid]"
const TEXT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number", ""])

function send(payload: Payload): Promise<unknown> {
  const binding: unknown = Reflect.get(window, BINDING)

  if (typeof binding !== "function") return Promise.resolve()

  const answered: unknown = Reflect.apply(binding, window, [payload])

  return Promise.resolve(answered)
}

/** Turns assertion mode on or off, and shows it on the toolbar's button. */
function setAssertMode(on: boolean): void {
  assertMode = on
  document
    .querySelector(TOOLBAR)
    ?.shadowRoot?.querySelector("[data-action=assert]")
    ?.toggleAttribute("data-on", on)
}

/** The element's recorder name, given now if it had none. */
function tagOf(element: Element): string {
  const existing = element.getAttribute(TAG)

  if (existing !== null) return existing

  counter += 1
  const id = `${PREFIX}${String(counter)}`

  element.setAttribute(TAG, id)

  return id
}

function inToolbar(event: Event): boolean {
  return event.composedPath().some((node) => node instanceof Element && node.localName === TOOLBAR)
}

function origin(event: Event): Element | undefined {
  const first = event.composedPath()[0]

  return first instanceof Element ? first : undefined
}

function isTextField(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true

  return element instanceof HTMLInputElement && TEXT_TYPES.has(element.type)
}

function isToggle(element: Element): boolean {
  if (element instanceof HTMLInputElement)
    return element.type === "checkbox" || element.type === "radio"

  return element instanceof HTMLLabelElement && element.control instanceof HTMLInputElement
    ? isToggle(element.control)
    : false
}

/** Clicks that only focus or toggle a field; typing and the change are recorded instead. */
function recordedElsewhere(element: Element): boolean {
  return isTextField(element) || element instanceof HTMLSelectElement || isToggle(element)
}

function onClick(event: MouseEvent): void {
  const target = origin(event)

  if (!event.isTrusted || target === undefined || inToolbar(event)) return

  const element = target.closest(CLICKABLE) ?? target

  if (assertMode) {
    event.preventDefault()
    event.stopImmediatePropagation()
    setAssertMode(false)
    void send({ kind: "assert", tag: tagOf(element) })

    return
  }

  if (recordedElsewhere(element) || !(element instanceof HTMLElement)) return

  event.preventDefault()
  event.stopImmediatePropagation()
  void send({ kind: "click", tag: tagOf(element) }).finally(() => element.click())
}

function onInput(event: Event): void {
  const target = origin(event)

  if (target === undefined || inToolbar(event) || !isTextField(target)) return

  const secret = target instanceof HTMLInputElement && target.type === "password"

  void send({
    kind: "fill",
    tag: tagOf(target),
    secret,
    ...(secret ? {} : { value: target.value }),
  })
}

function onChange(event: Event): void {
  const target = origin(event)

  if (target === undefined || inToolbar(event)) return

  if (target instanceof HTMLSelectElement) {
    const label = [...target.selectedOptions].map((option) => option.label).join(", ")

    void send({ kind: "select", tag: tagOf(target), label })
  } else if (target instanceof HTMLInputElement && isToggle(target)) {
    void send({ kind: "check", tag: tagOf(target), checked: target.checked })
  }
}

/** Enter in a form's field submits it once the recorder has the key; Escape is just reported. */
function onKey(event: KeyboardEvent): void {
  const target = origin(event)

  if (target === undefined || inToolbar(event) || (event.key !== "Enter" && event.key !== "Escape"))
    return

  const form = event.key === "Enter" && isTextField(target) ? target.form : null
  const pressed = send({ kind: "press", tag: tagOf(target), key: event.key })

  if (form === null) return

  event.preventDefault()
  void pressed.finally(() => form.requestSubmit())
}

const TOOLBAR_HTML = `
<style>
  :host { all: initial; position: fixed; z-index: 2147483647; right: 12px; bottom: 12px; }
  div { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-radius: 8px;
    background: #1f2328; color: #f0f0f0; font: 12px system-ui, sans-serif;
    box-shadow: 0 2px 8px rgb(0 0 0 / 30%); }
  button, input { font: inherit; border-radius: 5px; border: 1px solid #555; padding: 3px 7px; }
  button { background: #2f353d; color: inherit; cursor: pointer; }
  button[data-on] { background: #b45309; }
  input { width: 140px; background: #111; color: inherit; }
</style>
<div>
  <strong>danwo ●</strong>
  <button type="button" data-action="assert">Assert</button>
  <input type="text" placeholder="note" data-field="note">
  <button type="button" data-action="note">Add note</button>
  <button type="button" data-action="stop">Stop</button>
</div>`

function toolbarButton(root: ShadowRoot, action: string, run: () => void): void {
  root.querySelector(`[data-action=${action}]`)?.addEventListener("click", run)
}

function addNote(root: ShadowRoot): void {
  const field = root.querySelector("[data-field=note]")

  if (!(field instanceof HTMLInputElement) || field.value.trim() === "") return

  void send({ kind: "note", text: field.value.trim() })
  field.value = ""
}

function mountToolbar(): void {
  if (window.top !== window || document.querySelector(TOOLBAR) !== null) return

  const host = document.createElement(TOOLBAR)

  host.setAttribute("aria-hidden", "true")

  const root = host.attachShadow({ mode: "open" })

  root.innerHTML = TOOLBAR_HTML
  toolbarButton(root, "assert", () => setAssertMode(!assertMode))
  toolbarButton(root, "note", () => addNote(root))
  toolbarButton(root, "stop", () => void send({ kind: "stop" }))
  document.documentElement.append(host)
}

function installRecorder(): void {
  if (window.top !== window) return

  window.addEventListener("click", onClick, true)
  window.addEventListener("input", onInput, true)
  window.addEventListener("change", onChange, true)
  window.addEventListener("keydown", onKey, true)

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountToolbar)
  else mountToolbar()
}

installRecorder()

/* Makes this file a module for the type checker, so its names stay its own; the recorder drops it. */
// oxlint-disable-next-line unicorn/require-module-specifiers -- the only way to mark a script file a module without exporting
export {}
