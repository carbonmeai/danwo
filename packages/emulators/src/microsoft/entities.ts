import type { PersonName } from "../oauth/account.ts"
import type { Entity } from "../store.ts"

/**
 * A Microsoft account (personal or work) that can sign in: `oid` is its object id, `tenant_id`
 * the directory it lives in (personal accounts share the consumer tenant).
 */
export type MicrosoftUser = Entity & PersonName & Record<"oid" | "email" | "tenant_id", string>

/** An app registration in Microsoft Entra ID. */
export type MicrosoftOAuthClient = Entity &
  Record<"client_id" | "client_secret" | "name" | "tenant_id", string> & { redirect_uris: string[] }
