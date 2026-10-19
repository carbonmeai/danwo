import { describe, expect, it } from "vitest"

import {
  entryMarkdown,
  frontmatter,
  guidePage,
  oneLine,
  plainText,
  section,
  sectionMarkdown,
  withoutSections,
} from "../src/generator/markdown.ts"

const GUIDE = `# Saved sessions

Sign in once per worker and start every test
that needs it already signed in.

## Defining one

\`\`\`ts
# not a heading inside code
test.session("admin", setup)
\`\`\`

### Checking it

A check runs first.

## Using one

\`test.use({ session: "admin" })\`.
`

describe("guidePage", () => {
  it("takes the title from the heading and the description from the paragraph under it", () => {
    const page = guidePage(GUIDE)

    expect(page.title).toBe("Saved sessions")
    expect(page.description).toBe(
      "Sign in once per worker and start every test that needs it already signed in.",
    )
    expect(page.body.startsWith("## Defining one")).toBe(true)
    expect(page.body).not.toContain("# Saved sessions")
  })
})

describe("section", () => {
  it("returns the text under a heading, up to the next heading of its level", () => {
    const text = section(GUIDE, "Defining one")

    expect(text).toContain('test.session("admin", setup)')
    expect(text).not.toContain("Using one")
  })

  it("does not take a line in fenced code for a heading", () => {
    expect(section(GUIDE, "Defining one")).toContain("# not a heading inside code")
  })

  it("raises subheadings so the section reads as a page", () => {
    const readme = "# danwo\n\n## Coding agents\n\nIntro.\n\n### Skill\n\nText.\n\n## Next\n"

    expect(section(readme, "Coding agents")).toBe("Intro.\n\n## Skill\n\nText.")
  })

  it("fails loudly when the heading is gone", () => {
    expect(() => section(GUIDE, "Renamed")).toThrow(/no "Renamed" heading/)
  })
})

describe("withoutSections", () => {
  it("drops the named sections and keeps the rest", () => {
    const body = guidePage(GUIDE).body
    const kept = withoutSections(body, ["Defining one"])

    expect(kept).not.toContain("Defining one")
    expect(kept).not.toContain("Checking it")
    expect(kept).toContain("## Using one")
  })
})

describe("frontmatter", () => {
  it("quotes every value and drops missing ones", () => {
    expect(frontmatter({ title: 'Say "hi": now', source: undefined })).toBe(
      '---\ntitle: "Say \\"hi\\": now"\n---\n',
    )
  })

  it("keeps titles and descriptions plain text", () => {
    expect(frontmatter({ description: "Run `danwo test`, see [CI](/docs/ci)." })).toBe(
      '---\ndescription: "Run danwo test, see CI."\n---\n',
    )
  })

  it("leaves other fields as they are", () => {
    expect(frontmatter({ icon: "/icons/a.svg|/icons/b.svg" })).toContain(
      '"/icons/a.svg|/icons/b.svg"',
    )
  })
})

describe("plainText and oneLine", () => {
  it("strip marks and fold whitespace", () => {
    expect(plainText("`a` and [b](/c)")).toBe("a and b")
    expect(oneLine("  one\n  two  ")).toBe("one two")
  })
})

describe("entryMarkdown", () => {
  it("gives a spec entry its heading, kind, signature, doc and members", () => {
    const text = entryMarkdown({
      name: "settle",
      kind: "function",
      signature: "settle(): Promise<void>",
      doc: "Plays pending webhooks.",
      members: [
        { name: "ms", signature: "ms: number", doc: "How far.\nIn milliseconds." },
        { name: "--lint", signature: "", doc: "" },
      ],
    })

    expect(text).toBe(
      [
        "### `settle`",
        "_function_",
        "```ts\nsettle(): Promise<void>\n```",
        "Plays pending webhooks.",
        "- `ms: number` — How far. In milliseconds.\n- `--lint`",
      ].join("\n\n"),
    )
  })

  it("fences a command's signature as shell", () => {
    const text = entryMarkdown(
      { name: "test", kind: "command", signature: "danwo test", doc: "", members: [] },
      2,
    )

    expect(text).toBe("## `test`\n\n_command_\n\n```sh\ndanwo test\n```")
  })
})

describe("sectionMarkdown", () => {
  it("puts what the section covers before its entries", () => {
    const text = sectionMarkdown({
      topic: "cache",
      title: "Cache outcomes",
      about: "What each step's replay came to.",
      entries: [
        { name: "replayed", kind: "outcome", signature: "", doc: "as recorded", members: [] },
      ],
    })

    expect(text.startsWith("What each step's replay came to.\n\n### `replayed`")).toBe(true)
  })
})
