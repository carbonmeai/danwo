import { describe, expect, it } from "vitest"

import {
  frontmatter,
  guidePage,
  oneLine,
  plainText,
  referenceBody,
  referenceEntry,
  section,
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

describe("referenceEntry", () => {
  it("gives an entry a section of its own, its members in a table with their bars escaped", () => {
    const text = referenceEntry({
      name: "Locator",
      kind: "interface",
      signature: "Locator extends Screen",
      doc: "An element on the screen.",
      members: [
        { name: "click", signature: "click: Action", doc: "Clicks it.\nOnce it is ready." },
        { name: "state", signature: "state: 'on' | 'off'", doc: "" },
      ],
    })

    expect(text).toBe(
      [
        "## Locator",
        "_interface_",
        "```ts\nLocator extends Screen\n```",
        "An element on the screen.",
        [
          "| Member | Description |",
          "| --- | --- |",
          "| `click: Action` | Clicks it. Once it is ready. |",
          "| `state: 'on' \\| 'off'` |   |",
        ].join("\n"),
      ].join("\n\n"),
    )
  })
})

describe("referenceEntry at another level", () => {
  it("fences a command's signature as shell, under the heading level asked for", () => {
    const text = referenceEntry(
      {
        name: "test",
        kind: "command",
        signature: "danwo test",
        doc: "",
        members: [{ name: "--lint", signature: "", doc: "" }],
      },
      3,
    )

    expect(text).toBe(
      "### test\n\n_command_\n\n```sh\ndanwo test\n```\n\n| Member | Description |\n| --- | --- |\n| `--lint` |   |",
    )
  })
})

describe("referenceBody", () => {
  it("puts what a section covers before its entries, as sections of their own", () => {
    const text = referenceBody([
      {
        topic: "agent",
        title: "Agent",
        about: "Plain-English steps.",
        entries: [
          {
            name: "Agent",
            kind: "interface",
            signature: "",
            doc: "",
            members: [{ name: "act", signature: "act(goal: string)", doc: "Does it." }],
          },
        ],
      },
    ])

    expect(text.startsWith("Plain-English steps.\n\n## Agent\n")).toBe(true)
  })

  it("lists one-line entries as a single table", () => {
    const text = referenceBody([
      {
        topic: "cache",
        title: "Cache outcomes",
        about: "What each step's replay came to.",
        entries: [
          { name: "replayed", kind: "outcome", signature: "", doc: "as recorded", members: [] },
          {
            name: "missed",
            kind: "outcome",
            signature: "exit 1",
            doc: "no recording",
            members: [],
          },
        ],
      },
    ])

    expect(text).toBe(
      [
        "What each step's replay came to.",
        [
          "| Name | Kind | Description |",
          "| --- | --- | --- |",
          "| `replayed` | outcome | as recorded |",
          "| `missed` | outcome | `exit 1` — no recording |",
        ].join("\n"),
      ].join("\n\n"),
    )
  })
})
