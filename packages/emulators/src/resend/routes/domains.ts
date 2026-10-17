import type {
  CreateDomainResponseSuccess,
  RemoveDomainsResponseSuccess,
  VerifyDomainsResponseSuccess,
} from "resend"

import { isOneOf } from "../../json.ts"
import type { ResendRouteContext } from "../context.ts"
import { REGIONS } from "../entities.ts"
import { domainObject, verified } from "../formatters.ts"
import { jsonBody, listOf, newUuid, notFound, resendError, textOf } from "../helpers.ts"

/** Sending domains: add (with the DNS records to publish), list, read, verify and remove. */
export function domainRoutes({ app, objects, events, clock }: ResendRouteContext): void {
  const { domains } = objects

  app.post("/domains", async (c) => {
    const body = await jsonBody(c)
    const name = textOf(body.name)
    const region = body.region ?? "us-east-1"

    if (!name) return resendError(c, 422, "missing_required_field", "Missing `name` field.")
    if (!isOneOf(REGIONS, region))
      return resendError(c, 422, "invalid_region", `Region must be one of ${REGIONS.join(", ")}.`)

    const domain = domains.add(
      domainObject({
        id: newUuid(),
        name,
        region,
        createdAt: clock().toISOString(),
      }),
      null,
    )

    events.domain("domain.created", domain)

    const { object: _object, ...created } = domain

    return c.json(created satisfies CreateDomainResponseSuccess)
  })

  app.get("/domains", (c) =>
    listOf(
      c,
      domains.all().map(({ object: _object, records: _records, ...listed }) => listed),
    ),
  )

  app.get("/domains/:id", (c) => {
    const domain = domains.get(c.req.param("id"))

    return domain ? c.json(domain) : notFound(c, "Domain")
  })

  app.post("/domains/:id/verify", (c) => {
    const id = c.req.param("id")
    const domain = domains.get(id)

    if (!domain) return notFound(c, "Domain")

    domains.change(id, verified(domain))

    return c.json({ object: "domain", id } satisfies VerifyDomainsResponseSuccess)
  })

  app.delete("/domains/:id", (c) => {
    const id = c.req.param("id")
    const domain = domains.get(id)

    if (!domain) return notFound(c, "Domain")

    domains.remove(id)
    events.domain("domain.deleted", domain)

    return c.json({ object: "domain", id, deleted: true } satisfies RemoveDomainsResponseSuccess)
  })
}
