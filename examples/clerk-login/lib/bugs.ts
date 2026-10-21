/**
 * Safeguards the app can turn off on purpose, so `danwo matrix` shows which trials catch each one.
 * `CLERK_LOGIN_BUG=no-webhook-verify` takes webhooks without checking their signature;
 * `CLERK_LOGIN_BUG=no-upsert` inserts a user for every `user.created` it gets.
 */
export type Bug = "no-webhook-verify" | "no-upsert"

/** Whether `bug` is switched on for this run. */
export function broken(bug: Bug): boolean {
  return process.env.CLERK_LOGIN_BUG === bug
}
