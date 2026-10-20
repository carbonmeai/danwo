/**
 * The guides for coding agents as text, bundled into the server so `/llms.txt` and
 * `/llms-full.txt` carry them; their raw files are served under `/guides/`.
 */
const files = import.meta.glob<string>("../../../packages/skill/guides/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

/** One guide: its topic, its title (its first heading), its address and its text. */
interface GuideText {
  readonly topic: string
  readonly title: string
  readonly url: string
  readonly text: string
}

/** Every guide, by topic. */
const GUIDES: readonly GuideText[] = Object.entries(files)
  .map(([path, text]) => {
    const topic = path.slice(path.lastIndexOf("/") + 1, -".md".length)
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? topic

    return { topic, title, url: `/guides/${topic}.md`, text }
  })
  .toSorted((a, b) => a.topic.localeCompare(b.topic))

/** The guides' lines for `/llms.txt`, under a heading of their own. */
export function guidesIndex(): string {
  const lines = GUIDES.map((guide) => `- [${guide.title}](${guide.url})`)

  return `## Guides for coding agents\n\n${lines.join("\n")}\n`
}

/** Every guide in full, for `/llms-full.txt`. */
export function guidesFull(): string {
  return GUIDES.map((guide) => `# ${guide.title} (${guide.url})\n\n${guide.text.trim()}\n`).join(
    "\n",
  )
}
