/**
 * A small task board whose member picker behaves like a real app's: the "Members" button opens a
 * popover rendered at the end of the body (a portal), its options appear after a short delay, and
 * every element's id changes on each page load. Tasks live on the server, so a reset gives each run
 * the same starting board.
 */
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingMessage } from "node:http"

import { listeningPort } from "@danwo/emulators"

interface Task {
  readonly id: string
  readonly title: string
  assignee: string | undefined
}

/** How the board looks; a test changes it between runs to make a page that really changed. */
export interface BoardLook {
  /** The people the member picker offers. */
  readonly members: readonly string[]
  /** Whether the line counting the tasks is shown. */
  readonly count: boolean
}

const LOOK: BoardLook = {
  members: ["Ada Lovelace", "Bob Babbage"],
  count: true,
}

export interface MembersBoard {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string
  /** The tasks on the board now. */
  tasks(): readonly Task[]
  /** Adds a task, as another user would. */
  add(title: string): void
  /** Changes how the board looks from the next page load on. */
  look(change: Partial<BoardLook>): void
  /** Empties the board and restores its look, as a fresh environment would. */
  reset(): void
  close(): Promise<void>
}

/** How long the popover takes to show its options, as a list that loads its members would. */
const OPTIONS_DELAY_MS = 400

function page(look: BoardLook): string {
  const load = randomUUID().slice(0, 8)

  return `<!doctype html>
<html><head><title>Tasks</title></head>
<body>
<main>
  <h1>Tasks</h1>
  <p id="count-${load}" data-count${look.count ? "" : " hidden"}></p>
  <button id="add-${load}" type="button">Add task</button>
  <form id="form-${load}" hidden>
    <label>Task title <input name="title"></label>
    <button type="submit">Create</button>
  </form>
  <ul aria-label="Task list"></ul>
</main>
<script>
const load = ${JSON.stringify(load)}
const list = document.querySelector("ul")
const count = document.querySelector("[data-count]")
const form = document.querySelector("form")

async function render() {
  const tasks = await (await fetch("/api/tasks")).json()

  count.textContent = tasks.length === 1 ? "1 task" : tasks.length + " tasks"
  list.replaceChildren(...tasks.map((task) => {
    const item = document.createElement("li")
    const title = document.createElement("span")
    const who = document.createElement("span")
    const members = document.createElement("button")

    item.id = "task-" + load + "-" + task.id
    title.textContent = task.title
    who.textContent = task.assignee ? " Assigned: " + task.assignee + " " : " Unassigned "
    members.type = "button"
    members.textContent = "Members"
    members.setAttribute("aria-label", "Members of " + task.title)
    members.onclick = () => openPicker(task)
    item.append(title, who, members)

    return item
  }))
}

function openPicker(task) {
  document.querySelector("[role=listbox]")?.remove()

  const picker = document.createElement("div")

  picker.setAttribute("role", "listbox")
  picker.setAttribute("aria-label", "Members")
  picker.id = "picker-" + Math.random().toString(36).slice(2)
  document.body.append(picker)
  setTimeout(() => {
    for (const name of ${JSON.stringify(look.members)}) {
      const option = document.createElement("div")

      option.setAttribute("role", "option")
      option.id = "member-" + Math.random().toString(36).slice(2)
      option.tabIndex = 0
      option.textContent = name
      option.onclick = async () => {
        await fetch("/api/tasks/" + task.id + "/assign", { method: "POST", body: name })
        picker.remove()
        await render()
      }
      picker.append(option)
    }
  }, ${OPTIONS_DELAY_MS})
}

document.querySelector("button[type=button]").onclick = () => {
  form.hidden = false
  form.querySelector("input").focus()
}
form.onsubmit = async (event) => {
  event.preventDefault()
  await fetch("/api/tasks", { method: "POST", body: form.title.value })
  form.reset()
  form.hidden = true
  await render()
}
render()
</script>
</body></html>`
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let body = ""

  req.setEncoding("utf8")
  for await (const chunk of req) body += String(chunk)

  return body
}

interface Answer {
  readonly status: number
  readonly type?: string
  readonly body?: string
}

/** Starts the board on a free port. */
export async function startMembersBoard(): Promise<MembersBoard> {
  let tasks: Task[] = []
  let look = LOOK

  const add = (title: string) => {
    tasks = [...tasks, { id: randomUUID(), title, assignee: undefined }]
  }

  /** What the board answers `req` with. */
  async function answer(req: IncomingMessage): Promise<Answer> {
    const path = new URL(req.url ?? "/", "http://board").pathname
    const assign = /^\/api\/tasks\/([^/]+)\/assign$/.exec(path)

    if (path === "/api/tasks" && req.method === "GET")
      return { status: 200, type: "application/json", body: JSON.stringify(tasks) }

    if (path === "/api/tasks" && req.method === "POST") {
      add(await bodyOf(req))

      return { status: 201 }
    }

    if (assign === null) return { status: 200, type: "text/html", body: page(look) }

    const name = await bodyOf(req)
    const task = tasks.find((entry) => entry.id === assign[1])

    if (task) task.assignee = name

    return { status: task ? 204 : 404 }
  }

  const server = createServer((req, res) => {
    void answer(req).then(({ status, type, body }) => {
      res.writeHead(status, type === undefined ? {} : { "content-type": type })
      res.end(body)
    })
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  return {
    url: `http://127.0.0.1:${listeningPort(server)}`,
    tasks: () => tasks,
    add,
    look: (change) => {
      look = { ...look, ...change }
    },
    reset: () => {
      tasks = []
      look = LOOK
    },
    close: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
