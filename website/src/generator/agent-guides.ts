/**
 * The guides danwo hands coding agents, served as they are: each copied into `public/guides/` so
 * its raw markdown is one address away, and listed on the docs' one "For coding agents" page.
 * People read the pages under `content/docs`; agents read these.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { GUIDES_DIR, readGuide } from "./danwo.ts"
import { frontmatter, guidePage } from "./markdown.ts"

/** Where the raw guides are served from, under the site. */
const GUIDES_URL = "/guides"

/** One guide: its topic (the file name), its title and the address of its raw markdown. */
interface AgentGuide {
  readonly topic: string
  readonly title: string
  readonly description: string
  readonly url: string
}

/** Every guide in `packages/skill/guides`, by topic. */
function agentGuides(): AgentGuide[] {
  return readdirSync(GUIDES_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length))
    .toSorted()
    .map((topic) => {
      const { title, description } = guidePage(readGuide(topic))

      return { topic, title, description, url: `${GUIDES_URL}/${topic}.md` }
    })
}

/** Copies every guide into `publicDir/guides/` and returns how many were written. */
export function copyGuides(publicDir: string): number {
  const folder = join(publicDir, "guides")
  let written = 0

  mkdirSync(folder, { recursive: true })

  for (const guide of agentGuides()) {
    const target = join(folder, `${guide.topic}.md`)
    const text = readGuide(guide.topic)

    if (existsSync(target) && readFileSync(target, "utf8") === text) continue

    writeFileSync(target, text)
    written += 1
  }

  return written
}

/** A table cell's text, with its pipes escaped. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|")
}

/** The docs' "For coding agents" page: what the guides are, how agents get them, and the list. */
export function agentGuidesPage(place: {
  readonly title: string
  readonly icon: string
  readonly section: string
}): string {
  const rows = agentGuides().map(
    (guide) => `| [${cell(guide.title)}](${guide.url}) | \`${guide.topic}\` |`,
  )

  return `${frontmatter({
    title: place.title,
    description:
      "danwo's guides for coding agents: the same knowledge as these docs, written densely, as raw markdown.",
    icon: place.icon,
    section: place.section,
    source: "packages/skill/guides",
  })}
These docs are written for people. Coding agents get the same knowledge from danwo's **guides**:
short, dense markdown files with every option and rule, meant to be read in full by a model.

You don't need to read them yourself. They're listed here so you can see what your agent knows.

## How an agent gets them

| Way | What it gives the agent |
| --- | --- |
| The skill | \`danwo init\` installs danwo's skill, which tells your agent to read the guide for a task first. |
| \`danwo guide <topic>\` | Prints one guide in the terminal. \`danwo guide\` lists them. |
| The MCP server | Serves the guides as resources, next to its tools. |
| [\`/llms.txt\`](/llms.txt) | An index of these docs and the guides. |
| [\`/llms-full.txt\`](/llms-full.txt) | Every docs page and every guide in one file. |
| Each docs page as \`.md\` | Add \`.md\` to a docs address for its markdown. |

See [Coding agents](/docs/coding-agents) to set up your agent.

## The guides

Each link opens the guide's raw markdown.

| Guide | Topic |
| --- | --- |
${rows.join("\n")}
`
}
