/** Contacts, the grants themselves, and the application's webhook subscriptions. */
import { randomBytes, randomUUID } from "node:crypto"

import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import { callerOf, grantOf, requireApplication } from "../auth.ts"
import type { NylasContact, NylasWebhook } from "../entities.ts"
import { NYLAS_TRIGGERS } from "../events.ts"
import { removeGrant } from "../grants.ts"
import {
  badRequest,
  bodyOf,
  hexId,
  type NylasRouteContext,
  notFound,
  one,
  page,
  requestId,
  seconds,
  text,
} from "../helpers.ts"

const GRANT = "/v3/grants/:grant"

/** A list field of contact parts (`emails`, `phone_numbers`), kept to its records. */
function parts<T>(value: unknown, key: string): T[] {
  if (!Array.isArray(value)) return []

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each kept item has the named key, which is all a contact part promises
  return value.filter((item) => typeof asRecord(item)?.[key] === "string") as T[]
}

/** The fields of a contact a create or update body sets. */
function contactFields(body: Readonly<Record<string, unknown>>): Partial<NylasContact> {
  const strings = [
    "given_name",
    "middle_name",
    "surname",
    "nickname",
    "company_name",
    "job_title",
    "notes",
    "birthday",
  ] as const

  return {
    ...Object.fromEntries(
      strings.flatMap((key) => (text(body, key) === undefined ? [] : [[key, text(body, key)]])),
    ),
    ...(Array.isArray(body["emails"]) && { emails: parts(body["emails"], "email") }),
    ...(Array.isArray(body["phone_numbers"]) && {
      phone_numbers: parts(body["phone_numbers"], "number"),
    }),
    ...(Array.isArray(body["web_pages"]) && { web_pages: parts(body["web_pages"], "url") }),
  }
}

function contactRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  const contactOf = (c: Context) => {
    const grant = grantOf(context, c)
    const contact = objects.contacts.get(c.req.param("id"))

    if (!contact || contact.grant_id !== grant.id) throw notFound(`contact ${c.req.param("id")}`)

    return { grant, contact }
  }

  app.get(`${GRANT}/contacts`, (c) => {
    const grant = grantOf(context, c)
    const email = c.req.query("email")?.toLowerCase()

    return page(
      c,
      objects.contacts.where(
        (contact) =>
          contact.grant_id === grant.id &&
          (email === undefined || contact.emails.some((e) => e.email.toLowerCase() === email)),
      ),
    )
  })
  app.get(`${GRANT}/contacts/:id`, (c) => one(c, contactOf(c).contact))
  app.post(`${GRANT}/contacts`, async (c) => {
    const grant = grantOf(context, c)
    const contact: NylasContact = {
      id: hexId(),
      grant_id: grant.id,
      object: "contact",
      given_name: null,
      middle_name: null,
      surname: null,
      nickname: null,
      company_name: null,
      job_title: null,
      notes: null,
      birthday: null,
      emails: [],
      phone_numbers: [],
      web_pages: [],
      im_addresses: [],
      physical_addresses: [],
      groups: [],
      picture_url: null,
      source: "address_book",
      ...contactFields(await bodyOf(c)),
    }

    objects.contacts.add(contact, null)
    events.emit("contact.updated", grant, contact)

    return one(c, contact)
  })
  app.put(`${GRANT}/contacts/:id`, async (c) => {
    const { grant, contact } = contactOf(c)
    const changed = objects.contacts.change(contact.id, contactFields(await bodyOf(c))) ?? contact

    events.emit("contact.updated", grant, changed)

    return one(c, changed)
  })
  app.delete(`${GRANT}/contacts/:id`, (c) => {
    const { grant, contact } = contactOf(c)

    objects.contacts.remove(contact.id)
    events.emit("contact.deleted", grant, { id: contact.id, grant_id: grant.id, object: "contact" })

    return c.json({ request_id: requestId() })
  })
}

function grantRoutes(context: NylasRouteContext): void {
  const { app, objects, events } = context

  app.get("/v3/grants", (c) => {
    requireApplication(context, c)

    const email = c.req.query("email")
    const provider = c.req.query("provider")

    return page(
      c,
      objects.grants.where(
        (grant) =>
          (email === undefined || grant.email === email) &&
          (provider === undefined || grant.provider === provider),
      ),
    )
  })
  app.get(GRANT, (c) => {
    const caller = callerOf(context, c)
    const id =
      c.req.param("grant") === "me" && caller.kind === "grant"
        ? caller.grantId
        : c.req.param("grant")
    const grant = objects.grants.get(id)

    if (!grant || (caller.kind === "grant" && caller.grantId !== id)) throw notFound(`grant ${id}`)

    return one(c, grant)
  })
  app.patch(GRANT, async (c) => {
    requireApplication(context, c)

    const grant = objects.grants.get(c.req.param("grant"))

    if (!grant) throw notFound(`grant ${c.req.param("grant")}`)

    const body = await bodyOf(c)
    const settings = asRecord(body["settings"])
    const changed =
      objects.grants.change(grant.id, {
        ...(settings && { settings }),
        ...(Array.isArray(body["scope"]) && {
          scope: body["scope"].filter((s): s is string => typeof s === "string"),
        }),
        updated_at: seconds(context.clock),
      }) ?? grant

    events.grant("grant.updated", changed)

    return one(c, changed)
  })
  app.delete(GRANT, (c) => {
    requireApplication(context, c)

    const grant = objects.grants.get(c.req.param("grant"))

    if (!grant) throw notFound(`grant ${c.req.param("grant")}`)
    removeGrant(context, grant)
    events.grant("grant.deleted", grant)

    return c.json({ request_id: requestId() })
  })
}

/** The trigger types a webhook body asks for, all known. */
function triggersOf(body: Readonly<Record<string, unknown>>): string[] {
  const asked = Array.isArray(body["trigger_types"])
    ? body["trigger_types"].filter((t): t is string => typeof t === "string")
    : []
  const unknown = asked.filter((t) => !NYLAS_TRIGGERS.some((known) => known === t))

  if (asked.length === 0) throw badRequest("trigger_types is required")
  if (unknown.length > 0) throw badRequest(`unknown trigger_types: ${unknown.join(", ")}`)

  return asked
}

/** A webhook as listings show it: the secret is only given on create and rotate. */
const listed = ({ webhook_secret: _secret, ...webhook }: NylasWebhook) => webhook

function webhookRoutes(context: NylasRouteContext): void {
  const { app, objects } = context

  const webhookOf = (c: Context) => {
    requireApplication(context, c)

    const webhook = objects.webhooks.get(c.req.param("id"))

    if (!webhook) throw notFound(`webhook ${c.req.param("id")}`)

    return webhook
  }

  app.get("/v3/webhooks", (c) => {
    requireApplication(context, c)

    return page(c, objects.webhooks.all().map(listed))
  })
  app.post("/v3/webhooks", async (c) => {
    requireApplication(context, c)

    const body = await bodyOf(c)
    const url = text(body, "webhook_url")

    if (url === undefined) throw badRequest("webhook_url is required")

    const now = seconds(context.clock)
    const webhook: NylasWebhook = {
      id: randomUUID(),
      description: text(body, "description") ?? null,
      trigger_types: triggersOf(body),
      webhook_url: url,
      webhook_secret: randomBytes(24).toString("hex"),
      status: "active",
      notification_email_addresses: [],
      status_updated_at: now,
      created_at: now,
      updated_at: now,
    }

    return one(c, objects.webhooks.add(webhook, null))
  })
  app.get("/v3/webhooks/:id", (c) => one(c, listed(webhookOf(c))))
  app.put("/v3/webhooks/:id", async (c) => {
    const webhook = webhookOf(c)
    const body = await bodyOf(c)
    const url = text(body, "webhook_url")
    const description = text(body, "description")
    const changed = objects.webhooks.change(webhook.id, {
      ...(body["trigger_types"] !== undefined && { trigger_types: triggersOf(body) }),
      ...(url !== undefined && { webhook_url: url }),
      ...(description !== undefined && { description }),
      updated_at: seconds(context.clock),
    })

    return one(c, changed && listed(changed))
  })
  app.delete("/v3/webhooks/:id", (c) => {
    objects.webhooks.remove(webhookOf(c).id)

    return c.json({ request_id: requestId(), data: { status: "success" } })
  })
  app.post("/v3/webhooks/rotate-secret/:id", (c) => {
    const webhook = webhookOf(c)

    return one(
      c,
      objects.webhooks.change(webhook.id, { webhook_secret: randomBytes(24).toString("hex") }),
    )
  })
}

/** Grants, contacts and webhooks. */
export function peopleRoutes(context: NylasRouteContext): void {
  for (const register of [grantRoutes, contactRoutes, webhookRoutes]) register(context)
}
