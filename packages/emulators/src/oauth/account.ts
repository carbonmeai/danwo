/** How a person is named on an identity provider's account. */
export type PersonName = Record<"name" | "given_name" | "family_name", string>

/** A display name, with first and last names taken from it unless given. */
export function personName(email: string, given: Partial<PersonName>): PersonName {
  const name = given.name ?? email.split("@")[0] ?? email
  const [first = name, ...rest] = name.split(" ")

  return {
    name,
    given_name: given.given_name ?? first,
    family_name: given.family_name ?? rest.join(" "),
  }
}
