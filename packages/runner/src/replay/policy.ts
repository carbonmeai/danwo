/**
 * How a replay finds a recorded element again, as a named and versioned policy. The policy is
 * part of every recording's key: a recording replays only under the policy it was made with, so
 * changing how elements are matched starts new recordings instead of silently replaying old ones
 * differently.
 *
 * - `exact`: the recorded role with its name or test id must pick out exactly one element.
 * - `similar-v1`: as `exact`, and when that fails, the one element of the same role that clearly
 *   looks most like it (name likeness, the part of the page, the test id) is taken instead.
 *
 * Strict replay always matches exactly, whatever the policy; the key still names the configured
 * policy, so strict trials read the recordings their clean run made.
 */

/** The matching policies, by name. */
export type RelocationPolicy = "exact" | "similar-v1"

/** The policy a session uses when none is configured. */
export const DEFAULT_RELOCATION: RelocationPolicy = "similar-v1"

/** The configured policy: `relocation` wins, then `relocate: false` (exact), then the default. */
export function relocationOf(options: {
  readonly relocation?: RelocationPolicy | undefined
  readonly relocate?: boolean | undefined
}): RelocationPolicy {
  if (options.relocation !== undefined) return options.relocation

  return options.relocate === false ? "exact" : DEFAULT_RELOCATION
}

/** Whether a policy looks for elements that moved. */
export function relocates(policy: RelocationPolicy): boolean {
  return policy !== "exact"
}
