import type { EmailAddressJSON, UserJSON, VerificationJSON } from "@clerk/backend"

import { clerkId } from "./helpers.ts"

/**
 * A verification as Clerk's API shows it on an identifier: Clerk sends no `object` or `id` here,
 * so the SDK's resource type is narrowed to what it really answers.
 */
export type IdentifierVerification = Omit<VerificationJSON, "object" | "id">

/** An email address on a user, as the API answers it. */
export type ClerkEmail = Omit<EmailAddressJSON, "verification"> & {
  verification: IdentifierVerification | null
}

/** A user, as the API answers it. */
export type ClerkUser = Omit<UserJSON, "email_addresses"> & { email_addresses: ClerkEmail[] }

/** A verified email address, as Clerk shows one added by the Backend API or verified by a code. */
export function verifiedEmail(address: string, strategy = "admin"): ClerkEmail {
  return {
    object: "email_address",
    id: clerkId("idn"),
    email_address: address,
    verification: { status: "verified", strategy, attempts: null, expire_at: null },
    linked_to: [],
  }
}

/** The fields a user is created with; the rest start empty. */
export interface NewUser {
  readonly emails: readonly string[]
  readonly firstName?: string | null
  readonly lastName?: string | null
  readonly username?: string | null
  readonly externalId?: string | null
  readonly hasPassword: boolean
  readonly publicMetadata?: Record<string, unknown>
  readonly privateMetadata?: Record<string, unknown>
  readonly unsafeMetadata?: Record<string, unknown>
}

/** A user's name parts, null when not given. */
function names(fields: NewUser) {
  return {
    first_name: fields.firstName ?? null,
    last_name: fields.lastName ?? null,
    username: fields.username ?? null,
    external_id: fields.externalId ?? null,
  }
}

/** A user's metadata, empty when not given. */
function metadata(fields: NewUser) {
  return {
    public_metadata: fields.publicMetadata ?? {},
    private_metadata: fields.privateMetadata ?? {},
    unsafe_metadata: fields.unsafeMetadata ?? {},
  }
}

/** The account state of a fresh user: nothing banned, locked or second-factored. */
const FRESH = {
  image_url: "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCJ9",
  has_image: false,
  primary_phone_number_id: null,
  primary_web3_wallet_id: null,
  two_factor_enabled: false,
  totp_enabled: false,
  backup_code_enabled: false,
  phone_numbers: [],
  web3_wallets: [],
  organization_memberships: null,
  external_accounts: [],
  enterprise_accounts: [],
  banned: false,
  locked: false,
  deprovisioned: false,
  lockout_expires_in_seconds: null,
  verification_attempts_remaining: 100,
  last_sign_in_at: null,
  last_active_at: null,
  create_organization_enabled: true,
  create_organizations_limit: null,
  delete_self_enabled: true,
  legal_accepted_at: null,
  locale: null,
  timezone: null,
} as const

/** A new user record at `at` (milliseconds). */
export function newUser(fields: NewUser, at: number): ClerkUser {
  const emails = fields.emails.map((address) => verifiedEmail(address))

  return {
    object: "user",
    id: clerkId("user"),
    ...FRESH,
    ...names(fields),
    ...metadata(fields),
    primary_email_address_id: emails[0]?.id ?? null,
    password_enabled: fields.hasPassword,
    password_last_updated_at: fields.hasPassword ? at : null,
    email_addresses: emails,
    phone_numbers: [],
    web3_wallets: [],
    external_accounts: [],
    enterprise_accounts: [],
    created_at: at,
    updated_at: at,
  }
}

/** The address a user signs in with first: the primary one, else any. */
export function primaryEmail(user: ClerkUser): string | null {
  const primary = user.email_addresses.find((email) => email.id === user.primary_email_address_id)

  return (primary ?? user.email_addresses[0])?.email_address ?? null
}
