import type { PersonName } from "../oauth/account.ts"
import type { Entity } from "../store.ts"

/**
 * A Google account that can sign in. `uid` is the numeric `sub` Google gives it; `hd` is the
 * Workspace domain, for accounts that have one.
 */
export type GoogleUser = Entity &
  PersonName & {
    uid: string
    email: string
    email_verified: boolean
    picture: string | null
    locale: string
    hd: string | null
  }

/** An OAuth client registered in the Google Cloud console. */
export type GoogleOAuthClient = Entity &
  Record<"client_id" | "client_secret" | "name", string> & { redirect_uris: string[] }
