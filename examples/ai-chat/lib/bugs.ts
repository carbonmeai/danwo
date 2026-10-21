/**
 * Safeguards the app can turn off on purpose, so the tests and `danwo matrix` show what catches
 * each one:
 * - `AI_CHAT_BUG=no-tool-validation` trusts the model's tool input: no schema check, and a call
 *   whose input broke off is "repaired" by finishing its JSON, so a malformed call writes whatever
 *   it carries;
 * - `AI_CHAT_BUG=no-retry` calls the model once, with no retries, and shows its error as it came.
 */
export type Bug = "no-tool-validation" | "no-retry"

/** Whether `bug` is switched on for this run. */
export function broken(bug: Bug): boolean {
  return process.env.AI_CHAT_BUG === bug
}
