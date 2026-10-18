import type { SessionJSON } from "@clerk/backend"

import type { ClerkContext } from "./context.ts"
import { primaryEmail } from "./entities.ts"
import { notFound } from "./helpers.ts"
import type { JwtTemplateRecord } from "./store.ts"

/** A template by name, or 404. */
function templateNamed(context: ClerkContext, name: string): JwtTemplateRecord {
  const template = context.clerk.jwtTemplates.where((t) => t.name === name)[0]

  if (!template) throw notFound("JWT template")

  return template
}

/** The values a template's `{{…}}` shortcodes read, by path. */
function shortcodeValues(context: ClerkContext, session: SessionJSON): Record<string, unknown> {
  const user = context.clerk.users.get(session.user_id)

  return {
    "user.id": session.user_id,
    "user.first_name": user?.first_name ?? null,
    "user.last_name": user?.last_name ?? null,
    "user.username": user?.username ?? null,
    "user.primary_email_address": user ? primaryEmail(user) : null,
    "user.public_metadata": user?.public_metadata ?? {},
    "user.unsafe_metadata": user?.unsafe_metadata ?? {},
    "user.external_id": user?.external_id ?? null,
    "session.id": session.id,
    "org.id": session.last_active_organization_id ?? null,
  }
}

/** A shortcode's value inside a longer string: primitives as they are, the rest as JSON. */
function text(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value)

  return JSON.stringify(value)
}

/** Replaces shortcodes in one claim value: a lone `{{x}}` keeps the value's type. */
function resolve(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const lone = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value)

    if (lone) return values[lone[1] ?? ""] ?? null

    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => text(values[path]))
  }

  if (Array.isArray(value)) return value.map((item) => resolve(item, values))
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, values)]))

  return value
}

/**
 * The claims of a token shaped by the template `name`: its own claims with shortcodes filled in,
 * on top of the standard ones, valid for the template's lifetime.
 */
export function templateClaims(
  context: ClerkContext,
  name: string,
  session: SessionJSON,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const template = templateNamed(context, name)
  const resolved = resolve(template.claims, shortcodeValues(context, session))
  const own = resolved !== null && typeof resolved === "object" ? resolved : {}
  const iat = Number(base.iat)

  return {
    ...own,
    iss: base.iss,
    sub: base.sub,
    iat,
    nbf: iat - template.allowed_clock_skew,
    exp: iat + template.lifetime,
  }
}
