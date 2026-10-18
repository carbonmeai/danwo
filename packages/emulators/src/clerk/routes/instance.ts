import type { App } from "../../http.ts"
import { bodyOf } from "../backend-auth.ts"
import { clientJson } from "../client-json.ts"
import { type ClerkContext, instanceOf, now } from "../context.ts"
import { clerkId, invalidParameter, notFound, num, record, secretToken, str } from "../helpers.ts"
import { userOf } from "./users.ts"

function keyRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/jwks", (c) => c.json({ keys: [context.key.jwk] }))
}

function templateRoutes(app: App, context: ClerkContext): void {
  const json = (id: string) => {
    const template = context.clerk.jwtTemplates.get(id)

    if (!template) throw notFound("JWT template")

    return { object: "jwt_template", ...template }
  }

  app.get("/v1/jwt_templates", (c) =>
    c.json(context.clerk.jwtTemplates.all().map((t) => ({ object: "jwt_template", ...t }))),
  )
  app.post("/v1/jwt_templates", async (c) => {
    const body = await bodyOf(c)
    const name = str(body.name)

    if (name === undefined) throw invalidParameter("name")

    const at = now(context)
    const template = context.clerk.jwtTemplates.add(
      {
        id: clerkId("jtmp"),
        name,
        claims: record(body.claims),
        lifetime: num(body.lifetime) ?? 60,
        allowed_clock_skew: num(body.allowed_clock_skew) ?? 5,
        created_at: at,
        updated_at: at,
      },
      null,
    )

    return c.json(json(template.id))
  })
  app.get("/v1/jwt_templates/:id", (c) => c.json(json(c.req.param("id"))))
  app.delete("/v1/jwt_templates/:id", (c) => {
    const id = c.req.param("id")

    json(id)
    context.clerk.jwtTemplates.remove(id)

    return c.json({ object: "jwt_template", id, deleted: true })
  })
}

function signInTokenRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/sign_in_tokens", async (c) => {
    const user = userOf(context, str((await bodyOf(c)).user_id) ?? "")
    const at = now(context)
    const token = secretToken(32)

    return c.json(
      context.clerk.signInTokens.add(
        {
          object: "sign_in_token",
          id: clerkId("sit"),
          user_id: user.id,
          token,
          status: "pending",
          url: `https://${instanceOf(context).accountsHost}/sign-in?__clerk_ticket=${token}`,
          created_at: at,
          updated_at: at,
        },
        null,
      ),
    )
  })
  app.post("/v1/sign_in_tokens/:id/revoke", (c) => {
    const changed = context.clerk.signInTokens.change(c.req.param("id"), {
      status: "revoked",
      updated_at: now(context),
    })

    if (!changed) throw notFound("sign in token")

    return c.json(changed)
  })
}

function clientRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/clients/handshake_payload", (c) => {
    const nonce = context.clerk.nonces.get(c.req.query("nonce") ?? "")

    if (!nonce) throw notFound("handshake payload")

    context.clerk.nonces.remove(nonce.id)

    return c.json({ directives: nonce.directives })
  })
  app.get("/v1/clients/:id", (c) => {
    const client = context.clerk.clients.get(c.req.param("id"))

    if (!client) throw notFound("client")

    return c.json(clientJson(context, client))
  })
}

/** The Backend API's keys, JWT templates, sign-in tokens and clients. */
export function instanceRoutes(app: App, context: ClerkContext): void {
  keyRoutes(app, context)
  templateRoutes(app, context)
  signInTokenRoutes(app, context)
  clientRoutes(app, context)
}
