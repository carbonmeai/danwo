/**
 * `danwo guide`: short task guides shipped as markdown with this package. Each starts with a
 * `# Title` line and a one-paragraph summary; the file's name is its topic.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const GUIDES = fileURLToPath(new URL("../guides/", import.meta.url))

/** A guide's topic, title and summary, as `danwo guide` lists them. */
export interface GuideInfo {
  readonly topic: string
  readonly title: string
  readonly summary: string
}

/** The guides in the order `danwo guide` lists them: getting started first, then by task. */
const ORDER = [
  "first-test",
  "locators-vs-agent",
  "matrix",
  "lint",
  "providers",
  "llm",
  "email-and-otp",
  "sessions",
  "time",
  "secrets",
  "debugging",
  "dashboard",
  "ci",
  "playwright",
  "mobile",
]

/** Where a topic sorts: its place in `ORDER`, else after every listed one. */
function rank(topic: string): number {
  return ORDER.includes(topic) ? ORDER.indexOf(topic) : ORDER.length
}

function topics(): string[] {
  const found = readdirSync(GUIDES)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length))

  return found.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Every guide with its title and summary. */
export function listGuides(): GuideInfo[] {
  return topics().map((topic) => {
    const [heading = "", summary = ""] = readGuide(topic).split(/\n\s*\n/)

    return {
      topic,
      title: heading.replace(/^#\s*/, ""),
      summary: summary.replaceAll(/\s+/g, " ").trim(),
    }
  })
}

/** A guide's markdown; throws, naming the topics, for an unknown one. */
export function readGuide(topic: string): string {
  if (!topics().includes(topic))
    throw new Error(`no guide "${topic}" (guides: ${topics().join(", ")})`)

  return readFileSync(join(GUIDES, `${topic}.md`), "utf8")
}

/** The guide list as `danwo guide` prints it. */
export function guideIndex(): string {
  const guides = listGuides()
  const width = Math.max(...guides.map((guide) => guide.topic.length))

  return [
    ...guides.map((guide) => `${guide.topic.padEnd(width)}  ${guide.summary}`),
    "",
    "danwo guide <topic> prints one; danwo spec lists every API, option, fault and code.",
  ].join("\n")
}
