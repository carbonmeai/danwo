/** Unipile's API under `/api/v1`: accounts, hosted links, profiles, chats and messages, mail, webhooks. */
import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"
import { attendeeFor, fileEmail, postMessage, startChat } from "./actions.ts"
import {
  accountObject,
  attendeeObject,
  chatObject,
  emailObject,
  messageObject,
  webhookObject,
} from "./formatters.ts"
import {
  API,
  badRequest,
  HOSTED_ORIGIN,
  listOf,
  notFound,
  requireToken,
  unipileId,
  type UnipileRouteContext,
} from "./helpers.ts"
import type { UnipileAccountRecord, UnipileChatRecord, UnipileWebhookRecord } from "./store.ts"

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    return asRecord(await c.req.json()) ?? {}
  } catch {
    return {}
  }
}

/** A multipart or JSON body's fields as strings, as the SDK sends either. */
async function fields(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? ""
  const raw: Record<string, unknown> = type.includes("json")
    ? await jsonBody(c)
    : { ...(await c.req.parseBody()) }

  return Object.fromEntries(
    Object.entries(raw).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : Array.isArray(v) ? [[k, JSON.stringify(v)]] : [],
    ),
  )
}

/** The items of a JSON list sent as a form field; anything else is an empty list. */
function listIn(text: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text)

    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return [text]
  }
}

function accountOf(context: UnipileRouteContext, id: string | undefined): UnipileAccountRecord {
  const account = id === undefined ? undefined : context.objects.accounts.get(id)

  if (!account) throw notFound(`Account ${id ?? ""}`)

  return account
}

function chatOf(context: UnipileRouteContext, id: string): UnipileChatRecord {
  const chat = context.objects.chats.get(id)

  if (!chat) throw notFound(`Chat ${id}`)

  return chat
}

function accountRoutes(context: UnipileRouteContext): void {
  const { app, objects } = context

  app.get(`${API}/accounts`, (c) => {
    requireToken(context, c)

    return listOf(c, "AccountList", objects.accounts.all().map(accountObject))
  })
  app.get(`${API}/accounts/:id`, (c) => {
    requireToken(context, c)

    return c.json(accountObject(accountOf(context, c.req.param("id"))))
  })
  app.delete(`${API}/accounts/:id`, (c) => {
    requireToken(context, c)

    const account = accountOf(context, c.req.param("id"))

    objects.accounts.remove(account.id)

    return c.json({ object: "AccountDeleted" })
  })
  app.post(`${API}/hosted/accounts/link`, async (c) => {
    requireToken(context, c)

    const body = await jsonBody(c)
    const type = body["type"] === "reconnect" ? "reconnect" : "create"
    const reconnect =
      typeof body["reconnect_account"] === "string" ? body["reconnect_account"] : null

    if (type === "reconnect") accountOf(context, reconnect ?? undefined)

    const id = unipileId()
    const text = (key: string) => (typeof body[key] === "string" ? body[key] : null)
    const providers =
      body["providers"] === "*" || body["providers"] === undefined
        ? ["*"]
        : Array.isArray(body["providers"])
          ? body["providers"].filter((p): p is string => typeof p === "string")
          : typeof body["providers"] === "string"
            ? [body["providers"]]
            : ["*"]

    objects.links.add(
      {
        id,
        type,
        providers,
        name: text("name"),
        notify_url: text("notify_url"),
        success_redirect_url: text("success_redirect_url"),
        failure_redirect_url: text("failure_redirect_url"),
        reconnect_account: reconnect,
        expires_on:
          text("expiresOn") ?? new Date(context.clock().getTime() + 3600_000).toISOString(),
      },
      null,
    )
    if (text("notify_url")) objects.addNotifyUrl(text("notify_url") ?? "")

    return c.json({ object: "HostedAuthUrl", url: `${HOSTED_ORIGIN}/${id}` }, 201)
  })
}

function profileRoutes(context: UnipileRouteContext): void {
  const { app, objects } = context

  app.get(`${API}/users/me`, (c) => {
    requireToken(context, c)

    const account = accountOf(context, c.req.query("account_id"))

    return c.json({
      object: "AccountOwnerProfile",
      provider: account.type === "WHATSAPP" ? "WHATSAPP" : "LINKEDIN",
      provider_id: account.owner.provider_id,
      entity_urn: `urn:li:fsd_profile:${account.owner.provider_id}`,
      object_urn: `urn:li:member:${objects.next()}`,
      first_name: account.owner.first_name,
      last_name: account.owner.last_name,
      profile_picture_url: null,
      headline: "",
      public_identifier: account.owner.username,
      public_profile_url: `https://www.linkedin.com/in/${account.owner.username}`,
      location: "",
      email: "",
      premium: false,
      open_profile: false,
      occupation: "",
      recruiter: null,
      sales_navigator: null,
    })
  })
  app.get(`${API}/users/:identifier`, (c) => {
    requireToken(context, c)

    const account = accountOf(context, c.req.query("account_id"))
    const attendee = attendeeFor(context, account, c.req.param("identifier"))

    return c.json({
      object: "UserProfile",
      provider: "LINKEDIN",
      provider_id: attendee.provider_id,
      public_identifier: c.req.param("identifier"),
      first_name: attendee.name.split(" ")[0] ?? attendee.name,
      last_name: attendee.name.split(" ").slice(1).join(" "),
      headline: "",
      is_relationship: true,
      network_distance: "FIRST_DEGREE",
      websites: [],
    })
  })
  app.get(`${API}/users/:identifier/posts`, (c) => {
    requireToken(context, c)

    return listOf(c, "PostList", [])
  })
}

function messagingRoutes(context: UnipileRouteContext): void {
  const { app, objects } = context

  app.get(`${API}/chats`, (c) => {
    requireToken(context, c)

    const accountId = c.req.query("account_id")
    const chats = objects.chats.where(
      (chat) => accountId === undefined || chat.account_id === accountId,
    )

    return listOf(
      c,
      "ChatList",
      chats.toReversed().map((chat) => chatObject(objects, chat)),
    )
  })
  app.post(`${API}/chats`, async (c) => {
    requireToken(context, c)

    const body = await fields(c)
    const account = accountOf(context, body["account_id"])
    const ids =
      body["attendees_ids"] === undefined
        ? []
        : [body["attendees_ids"]].flatMap((v) => (v.startsWith("[") ? listIn(v) : [v]))
    const attendees = ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => attendeeFor(context, account, id))

    if (attendees.length === 0) throw badRequest("attendees_ids is required")

    const chat = startChat(context, account, attendees)
    const message =
      body["text"] === undefined ? undefined : postMessage(context, chat, body["text"])

    return c.json({ object: "ChatStarted", chat_id: chat.id, message_id: message?.id ?? null }, 201)
  })
  app.get(`${API}/chats/:id`, (c) => {
    requireToken(context, c)

    return c.json(chatObject(objects, chatOf(context, c.req.param("id"))))
  })
  app.get(`${API}/chats/:id/messages`, (c) => {
    requireToken(context, c)

    const chat = chatOf(context, c.req.param("id"))
    const messages = objects.messages.where((m) => m.chat_id === chat.id).toReversed()

    return listOf(
      c,
      "MessageList",
      messages.map((m) => messageObject(m, chat)),
    )
  })
  app.post(`${API}/chats/:id/messages`, async (c) => {
    requireToken(context, c)

    const chat = chatOf(context, c.req.param("id"))
    const message = postMessage(context, chat, (await fields(c))["text"] ?? "")

    return c.json({ object: "MessageSent", message_id: message.id }, 201)
  })
  app.get(`${API}/chats/:id/attendees`, (c) => {
    requireToken(context, c)

    const chat = chatOf(context, c.req.param("id"))
    const attendees = chat.attendee_ids.flatMap((id) => {
      const attendee = objects.attendees.get(id)

      return attendee ? [attendeeObject(attendee)] : []
    })

    return listOf(c, "ChatAttendeeList", attendees)
  })
  app.get(`${API}/messages/:id`, (c) => {
    requireToken(context, c)

    const message = objects.messages.get(c.req.param("id"))
    const chat = message && objects.chats.get(message.chat_id)

    if (!message || !chat) throw notFound(`Message ${c.req.param("id")}`)

    return c.json(messageObject(message, chat))
  })
}

function emailRoutes(context: UnipileRouteContext): void {
  const { app, objects } = context

  app.get(`${API}/emails`, (c) => {
    requireToken(context, c)

    const accountId = c.req.query("account_id")
    const emails = objects.emails.where(
      (e) => accountId === undefined || e.account_id === accountId,
    )

    return listOf(
      c,
      "EmailList",
      emails
        .toReversed()
        .map((e) => emailObject(e, objects.accounts.get(e.account_id)?.type ?? "MAIL")),
    )
  })
  app.get(`${API}/emails/:id`, (c) => {
    requireToken(context, c)

    const email = objects.emails.get(c.req.param("id"))

    if (!email) throw notFound(`Email ${c.req.param("id")}`)

    return c.json(emailObject(email, objects.accounts.get(email.account_id)?.type ?? "MAIL"))
  })
  app.post(`${API}/emails`, async (c) => {
    requireToken(context, c)

    const body = await fields(c)
    const account = accountOf(context, body["account_id"])
    const to = listIn(body["to"] ?? "[]").flatMap((item) => {
      const record = asRecord(item)
      const identifier = record?.["identifier"]

      return typeof identifier === "string"
        ? [
            {
              identifier,
              display_name:
                typeof record?.["display_name"] === "string" ? record["display_name"] : identifier,
            },
          ]
        : []
    })

    if (to.length === 0) throw badRequest("to is required")

    const email = fileEmail(context, account, {
      subject: body["subject"] ?? "",
      body: body["body"] ?? "",
      from: { display_name: account.name, identifier: account.owner.username },
      to,
      role: "sent",
    })

    return c.json(
      { object: "EmailSent", tracking_id: email.tracking_id, provider_id: email.provider_id },
      201,
    )
  })
}

function webhookRoutes(context: UnipileRouteContext): void {
  const { app, objects } = context
  const SOURCES = ["messaging", "email", "account_status", "email_tracking"] as const

  app.get(`${API}/webhooks`, (c) => {
    requireToken(context, c)

    return listOf(
      c,
      "WebhookList",
      objects.webhooks.all().map((w) => webhookObject(objects, w)),
    )
  })
  app.post(`${API}/webhooks`, async (c) => {
    requireToken(context, c)

    const body = await jsonBody(c)
    const source = SOURCES.find((s) => s === body["source"])
    const url = body["request_url"]

    if (!source || typeof url !== "string")
      throw badRequest("request_url and a known source are required")

    const webhook: UnipileWebhookRecord = {
      id: unipileId(),
      source,
      request_url: url,
      name: typeof body["name"] === "string" ? body["name"] : source,
      headers: (Array.isArray(body["headers"]) ? body["headers"] : []).flatMap((h) => {
        const header = asRecord(h)

        return typeof header?.["key"] === "string" && typeof header["value"] === "string"
          ? [{ key: header["key"], value: header["value"] }]
          : []
      }),
      account_ids: Array.isArray(body["account_ids"])
        ? body["account_ids"].filter((a): a is string => typeof a === "string")
        : [],
      events: Array.isArray(body["events"])
        ? body["events"].filter((e): e is string => typeof e === "string")
        : [],
      enabled: body["enabled"] !== false,
    }

    objects.webhooks.add(webhook, null)

    return c.json({ object: "WebhookCreated", webhook_id: webhook.id }, 201)
  })
  app.delete(`${API}/webhooks/:id`, (c) => {
    requireToken(context, c)

    if (!objects.webhooks.remove(c.req.param("id"))) throw notFound(`Webhook ${c.req.param("id")}`)

    return c.json({ object: "WebhookDeleted" })
  })
}

/** Every API route. */
export function apiRoutes(context: UnipileRouteContext): void {
  for (const register of [
    accountRoutes,
    profileRoutes,
    messagingRoutes,
    emailRoutes,
    webhookRoutes,
  ])
    register(context)
}
