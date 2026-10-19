/**
 * Finding what earlier Clerk runs left in a development instance: users with a tagged email
 * address and organizations with a tagged name, both deleted. Users at Clerk's test addresses and
 * organizations named the way runs named them before they were tagged are listed, never touched.
 */
import type { Target } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json, readJson } from "../shape.ts"
import { isTagged, type Leftover } from "../sweep.ts"
import { backend } from "./clerk-backend.ts"

/** How many pages of 100 each list is read to. */
const PAGES = 10

/** Organizations that earlier, untagged runs made. */
const OLD_ORGANIZATION = /^Fidelity [0-9a-z]+( b)?$/

/** The objects of a Backend API list: a bare array, or `{ data }` for organizations. */
function objectsOf(body: Json): Array<Readonly<Record<string, Json>>> {
  const list = isJsonArray(body) ? body : asJsonObject(body)?.["data"]

  if (list === undefined || !isJsonArray(list)) return []

  return list.flatMap((value) => {
    const fields = asJsonObject(value)

    return fields === undefined ? [] : [fields]
  })
}

/** Every object a search finds, page by page. */
async function search(
  target: Target,
  path: string,
  query: string,
): Promise<Array<Readonly<Record<string, Json>>>> {
  const found: Array<Readonly<Record<string, Json>>> = []

  for (let page = 0; page < PAGES; page++) {
    const answer = await target.send(
      backend(
        { target },
        "GET",
        `${path}?query=${encodeURIComponent(query)}&limit=100&offset=${page * 100}`,
      ),
    )
    const items = objectsOf(await readJson(answer))

    found.push(...items)
    if (items.length < 100) break
  }

  return found
}

/** A user's email addresses. */
function emails(user: Readonly<Record<string, Json>>): string[] {
  const addresses = user["email_addresses"]

  if (addresses === undefined || !isJsonArray(addresses)) return []

  return addresses.flatMap((address) => {
    const email = asJsonObject(address)?.["email_address"]

    return typeof email === "string" ? [email] : []
  })
}

function idOf(fields: Readonly<Record<string, Json>>): string {
  const id = fields["id"]

  return typeof id === "string" ? id : ""
}

/** Users the sweep would remove (tagged) or list (at Clerk's test addresses). */
async function users(target: Target): Promise<Leftover[]> {
  const seen = new Set<string>()
  const found = [
    ...(await search(target, "/users", "danwo-fidelity")),
    ...(await search(target, "/users", "clerk_test")),
  ]

  return found.flatMap((user) => {
    const id = idOf(user)
    const addresses = emails(user)
    const tagged = addresses.some(isTagged)

    if (id === "" || seen.has(id)) return []
    if (!tagged && !addresses.some((email) => email.endsWith("+clerk_test@example.com"))) return []

    seen.add(id)

    return [
      {
        kind: "user",
        id,
        label: addresses[0] ?? "",
        tagged,
        remove: () => target.send(backend({ target }, "DELETE", `/users/${id}`)),
      },
    ]
  })
}

/** Organizations the sweep would remove (tagged) or list (named as untagged runs named them). */
async function organizations(target: Target): Promise<Leftover[]> {
  const seen = new Set<string>()
  const found = [
    ...(await search(target, "/organizations", "danwo-fidelity")),
    ...(await search(target, "/organizations", "Fidelity")),
  ]

  return found.flatMap((org) => {
    const id = idOf(org)
    const name = typeof org["name"] === "string" ? org["name"] : ""
    const tagged = isTagged(name)

    if (id === "" || seen.has(id) || (!tagged && !OLD_ORGANIZATION.test(name))) return []

    seen.add(id)

    return [
      {
        kind: "organization",
        id,
        label: name,
        tagged,
        remove: () => target.send(backend({ target }, "DELETE", `/organizations/${id}`)),
      },
    ]
  })
}

/** The sweep for a Clerk development instance. */
export async function clerkSweep(target: Target): Promise<Leftover[]> {
  return [...(await organizations(target)), ...(await users(target))]
}
