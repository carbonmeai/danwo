/** The spec as text for a terminal or an agent's context, and as compact JSON. */
import type { Spec, SpecEntry, SpecMember, SpecSection } from "./model.ts"

/** An entry's doc, indented under its heading line. */
function indented(text: string, prefix: string): string[] {
  return text === "" ? [] : text.split("\n\n").map((paragraph) => `${prefix}${paragraph}`)
}

function memberLines(member: SpecMember): string[] {
  const head = member.signature === "" ? member.name : member.signature

  return [`    - ${head}`, ...indented(member.doc, "      ")]
}

function entryLines(entry: SpecEntry): string[] {
  const head =
    entry.signature === ""
      ? `${entry.name} (${entry.kind})`
      : `${entry.name} (${entry.kind}): ${entry.signature}`

  return [`  ${head}`, ...indented(entry.doc, "    "), ...entry.members.flatMap(memberLines)]
}

function sectionLines(section: SpecSection): string[] {
  return [
    `## ${section.title} [${section.topic}]`,
    section.about,
    "",
    ...section.entries.flatMap((entry) => [...entryLines(entry), ""]),
  ]
}

/** The spec as plain text: one block per section, one entry per export, code or command. */
export function renderSpec(spec: Spec): string {
  return spec.sections.flatMap(sectionLines).join("\n").trimEnd()
}

/** The spec as compact JSON, with empty fields left out. */
export function specJson(spec: Spec): string {
  return JSON.stringify(spec, (_key, value: unknown) =>
    value === "" || (Array.isArray(value) && value.length === 0) ? undefined : value,
  )
}
