import { createHash } from "node:crypto"

import type { Auth0UserRecord } from "./entities.ts"
import { hashPassword, hexId } from "./helpers.ts"
import type { Auth0Store } from "./store.ts"

/** The database connection every tenant has, which email and password users live in. */
const DATABASE_CONNECTION = "Username-Password-Authentication"

/** How the login page names each social connection's button. */
export const SOCIAL_LABELS: Readonly<Record<string, string>> = {
  "google-oauth2": "Google",
  github: "GitHub",
  windowslive: "Microsoft Account",
}

/** A Gravatar-style picture URL for an email, as Auth0 fills one in. */
function pictureFor(email: string): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex")

  return `https://s.gravatar.com/avatar/${hash}?s=480&r=pg&d=https%3A%2F%2Fcdn.auth0.com%2Favatars%2F${encodeURIComponent(email.slice(0, 2))}.png`
}

/** What a new user is made of; everything but the email has a default. */
export interface NewUser {
  readonly email: string
  readonly password?: string | null
  readonly user_id?: string
  readonly name?: string
  readonly given_name?: string | null
  readonly family_name?: string | null
  readonly email_verified?: boolean
  readonly app_metadata?: Record<string, unknown>
  readonly user_metadata?: Record<string, unknown>
  readonly blocked?: boolean
  readonly mfa_secret?: string | null
  readonly claims?: Record<string, unknown>
  readonly connection?: string
}

/** The profile Auth0 fills in from what a new user gave. */
function profileOf(user: NewUser, email: string) {
  return {
    name: user.name ?? email,
    nickname: email.split("@")[0] ?? email,
    given_name: user.given_name ?? null,
    family_name: user.family_name ?? null,
    picture: pictureFor(email),
  }
}

/** A new user's account state: verified (social logins are), blocked, password and second factor. */
function accountOf(user: NewUser, social: boolean) {
  return {
    email_verified: user.email_verified ?? social,
    passwordHash: user.password ? hashPassword(user.password) : null,
    blocked: user.blocked ?? false,
    mfaSecret: user.mfa_secret ?? null,
  }
}

/** Stores a user on `tenant`, the way Auth0 creates one in a connection. */
export function insertUser(auth0: Auth0Store, tenant: string, user: NewUser): Auth0UserRecord {
  const connection = user.connection ?? DATABASE_CONNECTION
  const social = connection !== DATABASE_CONNECTION
  const userId = user.user_id ?? `${social ? connection : "auth0"}|${hexId(12)}`
  const email = user.email.trim().toLowerCase()

  return auth0.users.insert({
    tenant,
    user_id: userId,
    email,
    ...profileOf(user, email),
    ...accountOf(user, social),
    app_metadata: { ...user.app_metadata },
    user_metadata: { ...user.user_metadata },
    identities: [
      {
        connection,
        provider: social ? connection : "auth0",
        user_id: userId.slice(userId.indexOf("|") + 1),
        isSocial: social,
      },
    ],
    claims: { ...user.claims },
    logins_count: 0,
    last_login: null,
  })
}

/** A user signing up with email and password: unverified until they open their verification link. */
export function createDatabaseUser(
  auth0: Auth0Store,
  tenant: string,
  credentials: { email: string; password: string },
): Auth0UserRecord {
  return insertUser(auth0, tenant, { ...credentials, email_verified: false })
}

/** A user as Auth0's Management API returns one. */
export function userView(user: Auth0UserRecord) {
  return {
    user_id: user.user_id,
    email: user.email,
    email_verified: user.email_verified,
    name: user.name,
    nickname: user.nickname,
    picture: user.picture,
    ...(user.given_name !== null && { given_name: user.given_name }),
    ...(user.family_name !== null && { family_name: user.family_name }),
    identities: user.identities,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    blocked: user.blocked,
    created_at: user.created_at,
    updated_at: user.updated_at,
    logins_count: user.logins_count,
    ...(user.last_login !== null && { last_login: user.last_login }),
  }
}
