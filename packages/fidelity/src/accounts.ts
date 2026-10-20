/**
 * The two providers whose fidelity suites act as a signed-in test account, Google and Microsoft:
 * where each one's OAuth endpoints are, which scopes the suites need, where the minted refresh
 * token is kept, and how to tell whose account a token belongs to.
 */

/** A provider whose suites need a person's account rather than an API key. */
export type AccountProvider = "google" | "microsoft"

const GOOGLE_AUTH = "https://www.googleapis.com/auth/"

/** The variables one account provider reads from `.env.fidelity`. */
export interface AccountVariables {
  readonly clientId: string
  readonly clientSecret: string
  readonly refreshToken: string
  readonly redirectUri: string
  /** The one account the suites may act as when its address is not a personal one. */
  readonly account: string
  /** Microsoft only: the tenant to sign in through, `common` when unset. */
  readonly tenant?: string
}

/** One account provider's OAuth app as the suites use it. */
export interface AccountApp {
  readonly provider: AccountProvider
  readonly label: string
  readonly variables: AccountVariables
  /** Least privilege for what the suites do: read and write their own test items, nothing else. */
  readonly scopes: readonly string[]
  /** The consent page, for `tenant` where the provider has tenants. */
  authorizeUrl(tenant: string): string
  /** The token endpoint, for `tenant`. */
  tokenUrl(tenant: string): string
  /** Parameters the consent request needs so the answer carries a refresh token. */
  readonly offlineParams: Readonly<Record<string, string>>
  /** Where the signed-in account's address is read, with an access token. */
  readonly whoAmI: string
  /** The account's address from the {@link whoAmI} answer. */
  emailOf(body: unknown): string | undefined
  /** Address domains of personal accounts, which the suites may use without naming them. */
  readonly personal: RegExp
}

/** A string field of a JSON object, or undefined. */
function field(body: unknown, name: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined

  const value: unknown = Reflect.get(body, name)

  return typeof value === "string" && value !== "" ? value : undefined
}

export const GOOGLE_ACCOUNT: AccountApp = {
  provider: "google",
  label: "Google",
  variables: {
    clientId: "DANWO_FIDELITY_GOOGLE_CLIENT_ID",
    clientSecret: "DANWO_FIDELITY_GOOGLE_CLIENT_SECRET",
    refreshToken: "DANWO_FIDELITY_GOOGLE_REFRESH_TOKEN",
    redirectUri: "DANWO_FIDELITY_GOOGLE_REDIRECT_URI",
    account: "DANWO_FIDELITY_GOOGLE_ACCOUNT",
  },
  scopes: [
    "openid",
    "email",
    `${GOOGLE_AUTH}gmail.modify`,
    `${GOOGLE_AUTH}calendar.events`,
    `${GOOGLE_AUTH}calendar.calendarlist.readonly`,
    `${GOOGLE_AUTH}drive.file`,
  ],
  authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: () => "https://oauth2.googleapis.com/token",
  offlineParams: { access_type: "offline", prompt: "consent" },
  whoAmI: "https://openidconnect.googleapis.com/v1/userinfo",
  emailOf: (body) => field(body, "email"),
  personal: /@(gmail|googlemail)\.com$/i,
}

export const MICROSOFT_ACCOUNT: AccountApp = {
  provider: "microsoft",
  label: "Microsoft",
  variables: {
    clientId: "DANWO_FIDELITY_MICROSOFT_CLIENT_ID",
    clientSecret: "DANWO_FIDELITY_MICROSOFT_CLIENT_SECRET",
    refreshToken: "DANWO_FIDELITY_MICROSOFT_REFRESH_TOKEN",
    redirectUri: "DANWO_FIDELITY_MICROSOFT_REDIRECT_URI",
    account: "DANWO_FIDELITY_MICROSOFT_ACCOUNT",
    tenant: "DANWO_FIDELITY_MICROSOFT_TENANT_ID",
  },
  scopes: [
    "openid",
    "email",
    "offline_access",
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.ReadWrite",
    "Files.ReadWrite",
  ],
  authorizeUrl: (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  tokenUrl: (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  offlineParams: { prompt: "select_account" },
  whoAmI: "https://graph.microsoft.com/v1.0/me",
  emailOf: (body) => field(body, "mail") ?? field(body, "userPrincipalName"),
  personal: /@(outlook|hotmail|live|msn)\.[a-z.]+$/i,
}

/** The account provider called `name`. */
export function accountApp(name: string): AccountApp {
  if (name === "google") return GOOGLE_ACCOUNT
  if (name === "microsoft") return MICROSOFT_ACCOUNT

  throw new Error(`no account sign-in for ${name}: use google or microsoft`)
}

/** The tenant `app` signs in through, from `env`: Microsoft's `common` unless one is set. */
export function tenantOf(
  app: AccountApp,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const name = app.variables.tenant

  return (name === undefined ? undefined : env[name]?.trim()) || "common"
}

/** Raised when the signed-in account looks like a work one the suites were not told to use. */
export class WorkAccountRefused extends Error {
  // fallow-ignore-next-line unused-class-member -- read by the CLI's exit code for errors, by name
  readonly code = "CONFIG_INVALID"

  constructor(app: AccountApp, email: string) {
    super(
      `${email} does not look like a personal ${app.label} account; the suites create and delete mail, events and files in it. Use a test account, or set ${app.variables.account}=${email} to allow this one`,
    )
    this.name = "WorkAccountRefused"
  }
}

/**
 * Refuses an account the suites should not touch: a personal address passes, any other one only
 * when it is the account named in `env`.
 */
export function checkAccount(
  app: AccountApp,
  email: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  const named = env[app.variables.account]?.trim().toLowerCase()

  if (app.personal.test(email) || named === email.toLowerCase()) return

  throw new WorkAccountRefused(app, email)
}
