/*
 * An app under test that keeps a user's Outlook inbox in sync the way integrations do, with plain
 * fetches to Graph's real host: it subscribes to new inbox mail (answering Graph's validation
 * handshake), takes a first delta of the inbox, sends itself a message, waits for the change
 * notification, and reads the delta since. Prints what it saw as JSON.
 */
import { createServer } from "node:http"

import { z } from "zod"

const headers = {
  authorization: `Bearer ${process.env["ACCESS_TOKEN"] ?? ""}`,
  "content-type": "application/json",
}
const graph = "https://graph.microsoft.com/v1.0"
const port = Number(process.env["NOTIFY_PORT"])

const Notification = z.object({
  changeType: z.string(),
  clientState: z.string().optional(),
  subscriptionId: z.string(),
})
const Notifications = z.object({ value: z.array(Notification) })
const DeltaPage = z.object({
  value: z.array(z.object({ subject: z.string().optional() })),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
})
const Subscription = z.object({ id: z.string() })

const notifications: z.infer<typeof Notification>[] = []

const server = createServer((req, res) => {
  const token = new URL(req.url ?? "/", "http://app").searchParams.get("validationToken")
  let body = ""

  req.on("data", (chunk: Buffer) => (body += chunk.toString()))
  req.on("end", () => {
    if (token !== null) {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end(token)

      return
    }

    notifications.push(...Notifications.parse(JSON.parse(body)).value)
    res.writeHead(202)
    res.end()
  })
})

await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))

/** Calls Graph and returns the status with the parsed JSON body (null when empty). */
async function call(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()

  return { status: response.status, body: text ? JSON.parse(text) : null }
}

/** Pages through a delta round to its end; returns the subjects and the link for the next round. */
async function delta(
  url: string,
): Promise<{ subjects: (string | undefined)[]; deltaLink: string }> {
  const subjects: (string | undefined)[] = []
  let next = url

  for (;;) {
    const page = DeltaPage.parse((await call(next)).body)

    subjects.push(...page.value.map((m) => m.subject))

    const nextLink = page["@odata.nextLink"]

    if (nextLink) next = nextLink
    else return { subjects, deltaLink: page["@odata.deltaLink"] ?? "" }
  }
}

async function waitForNotification(): Promise<z.infer<typeof Notification> | undefined> {
  for (let tries = 0; tries < 100 && notifications.length === 0; tries++)
    await new Promise((resolve) => setTimeout(resolve, 50))

  return notifications[0]
}

const subscription = await call(`${graph}/subscriptions`, {
  method: "POST",
  body: JSON.stringify({
    changeType: "created",
    notificationUrl: `http://127.0.0.1:${port}/notify`,
    resource: "me/mailFolders('Inbox')/messages",
    expirationDateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    clientState: "graph-sync-state",
  }),
})
const subscriptionId = Subscription.safeParse(subscription.body).data?.id
const first = await delta(`${graph}/me/mailFolders/inbox/messages/delta?$select=subject`)

await call(`${graph}/me/sendMail`, {
  method: "POST",
  body: JSON.stringify({
    message: {
      subject: "Weekly report",
      body: { contentType: "Text", content: "Numbers attached." },
      toRecipients: [{ emailAddress: { address: process.env["USER_EMAIL"] } }],
    },
  }),
})

const notification = await waitForNotification()
const since = await delta(first.deltaLink)

console.log(
  JSON.stringify({
    subscribed: subscription.status,
    firstRound: first.subjects,
    notification: notification && {
      changeType: notification.changeType,
      clientState: notification.clientState,
      subscription: notification.subscriptionId === subscriptionId,
    },
    changed: since.subjects,
  }),
)
server.close()
