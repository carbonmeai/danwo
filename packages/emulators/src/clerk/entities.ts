import type {
  EmailAddressJSON,
  ExternalAccountJSON,
  OrganizationJSON,
  UserJSON,
  VerificationJSON,
} from "@clerk/backend"

import { clerkId } from "./helpers.ts"

/**
 * A verification as Clerk's API shows it on an identifier: an `object` naming how it was verified
 * (`verification_admin` for an address the Backend API added) and no `id`, so the SDK's resource
 * type is narrowed to what it really answers.
 */
export type IdentifierVerification = Omit<VerificationJSON, "object" | "id"> & {
  object: string
}

/** An email address on a user, as the API answers it. */
export type ClerkEmail = Omit<EmailAddressJSON, "verification"> & {
  verification: IdentifierVerification | null
  reserved: boolean
  matches_sso_connection: boolean
  created_at: number
  updated_at: number
}

/** A social account linked to a user, verified by the provider (`verification_oauth`). */
export type ClerkExternalAccount = Omit<ExternalAccountJSON, "verification"> & {
  verification: IdentifierVerification | null
}

/**
 * A user, as the Backend API answers it. The SDK's type still lists `organization_memberships`
 * and `create_organizations_limit`, which the API no longer sends, and lacks fields it now does.
 */
export type ClerkUser = Omit<
  UserJSON,
  | "email_addresses"
  | "external_accounts"
  | "organization_memberships"
  | "create_organizations_limit"
> & {
  email_addresses: ClerkEmail[]
  external_accounts: ClerkExternalAccount[]
  passkeys: unknown[]
  saml_accounts: unknown[]
  bypass_client_trust: boolean
  mfa_enabled_at: number | null
  mfa_disabled_at: number | null
  requires_password_reset: boolean
  profile_image_url: string
}

/**
 * A verified email address at `at` (milliseconds), as Clerk shows one added by the Backend API
 * (`admin`) or verified by a code.
 */
export function verifiedEmail(address: string, at: number, strategy = "admin"): ClerkEmail {
  const byCode = strategy === "email_code"

  return {
    object: "email_address",
    id: clerkId("idn"),
    email_address: address,
    reserved: false,
    verification: {
      object: byCode ? "verification_otp" : `verification_${strategy}`,
      status: "verified",
      strategy,
      attempts: byCode ? 1 : null,
      expire_at: byCode ? at + EMAIL_CODE_LIFETIME_MS : null,
    },
    linked_to: [],
    matches_sso_connection: false,
    created_at: at,
    updated_at: at,
  }
}

/**
 * An organization, as the Backend API answers it: the SDK's type with the self-serve SSO,
 * directory sync and logo fields the API now sends.
 */
export type ClerkOrganization = OrganizationJSON & {
  self_serve_sso_enabled: boolean
  self_serve_directory_sync_enabled: boolean
  logo_url: string | null
}

/** How long an emailed code stays good: ten minutes, the expiry a code verification records. */
const EMAIL_CODE_LIFETIME_MS = 10 * 60 * 1000

/** The fields a user is created with; the rest start empty. */
export interface NewUser {
  readonly emails: readonly string[]
  readonly firstName?: string | null | undefined
  readonly lastName?: string | null | undefined
  readonly username?: string | null | undefined
  readonly externalId?: string | null | undefined
  readonly hasPassword: boolean
  readonly publicMetadata?: Record<string, unknown> | undefined
  readonly privateMetadata?: Record<string, unknown> | undefined
  readonly unsafeMetadata?: Record<string, unknown> | undefined
  /** How the email addresses were verified: `admin` (the Backend API) unless a code did it. */
  readonly emailStrategy?: string | undefined
  /** The user's timezone; a browser sign-up records one. */
  readonly timezone?: string | undefined
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

/** The default avatar a user without an image gets. */
const DEFAULT_IMAGE = "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCJ9"

/** The account state of a fresh user: nothing banned, locked or second-factored. */
const FRESH = {
  image_url: DEFAULT_IMAGE,
  profile_image_url: DEFAULT_IMAGE,
  has_image: false,
  primary_phone_number_id: null,
  primary_web3_wallet_id: null,
  two_factor_enabled: false,
  totp_enabled: false,
  backup_code_enabled: false,
  phone_numbers: [],
  web3_wallets: [],
  passkeys: [],
  saml_accounts: [],
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
  delete_self_enabled: true,
  bypass_client_trust: false,
  mfa_enabled_at: null,
  mfa_disabled_at: null,
  requires_password_reset: false,
  legal_accepted_at: null,
  locale: null,
  timezone: null,
} as const

/** A new user record at `at` (milliseconds). */
export function newUser(fields: NewUser, at: number): ClerkUser {
  const emails = fields.emails.map((address) => verifiedEmail(address, at, fields.emailStrategy))

  return {
    object: "user",
    id: clerkId("user"),
    ...FRESH,
    ...names(fields),
    ...metadata(fields),
    primary_email_address_id: emails[0]?.id ?? null,
    timezone: fields.timezone ?? null,
    password_enabled: fields.hasPassword,
    password_last_updated_at: fields.hasPassword ? at : null,
    email_addresses: emails,
    phone_numbers: [],
    web3_wallets: [],
    passkeys: [],
    saml_accounts: [],
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
