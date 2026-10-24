/** Who the browser is signed in as, shared by every page and the frame around them. */
import { ref } from "vue"

import { type Account, getSession } from "./api.ts"

/** The signed-in account: undefined until the API has answered, null when signed out. */
export const account = ref<Account | null | undefined>(undefined)

/** Asks the API who the browser is signed in as, and keeps the answer. */
export async function refreshSession(): Promise<Account | null> {
  const signedIn = await getSession()

  account.value = signedIn

  return signedIn
}
