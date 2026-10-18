import type { Emphasis, Parent, PhrasingContent, Root, RootContent, Text } from "mdast"

/** Chips placed after a plain-text offset of the rendered document, in the order given. */
export type MarkerPlacement = [offset: number, indexes: number[]]

type Leaf = {
  node: RootContent
  parent: Parent
  start: number
  end: number
  /** Where the node starts in the Markdown source, when it came from there. */
  source: number | undefined
}

/** Nodes whose children are one line of reading text; leaves in different blocks never join. */
const INLINE_BLOCKS = new Set(["paragraph", "heading", "tableCell"])

/** The reading text of a node, without Markdown syntax. */
const plainOf = (node: RootContent | Root): string => {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value
    case "break":
      return "\n"
    case "code":
      return ""
    default:
      return "children" in node
        ? node.children.map((child: RootContent) => plainOf(child)).join("")
        : ""
  }
}

/** Collects text, inline code and breaks in reading order, with their offsets in the joined text. */
const collectLeaves = (tree: Root) => {
  const leaves: Leaf[] = []
  let plain = ""
  let block: Parent | null = null

  const visit = (parent: Parent, owner: Parent | null) => {
    for (const node of parent.children) {
      switch (node.type) {
        case "text":
        case "inlineCode":

        case "break": {
          if (block && block !== owner) plain += "\n"
          block = owner
          const value = node.type === "break" ? "\n" : node.value

          leaves.push({
            node,
            parent,
            start: plain.length,
            end: plain.length + value.length,
            source: node.position?.start.offset,
          })
          plain += value
          break
        }

        case "code":
          break
        default:
          if ("children" in node) visit(node, INLINE_BLOCKS.has(node.type) ? node : owner)
      }
    }
  }

  visit(tree, null)

  return { leaves, plain }
}

/** Containers whose children are blocks, where escaped HTML needs its own paragraph. */
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"])

/** Turns raw HTML into literal text, so a value never renders markup but keeps what it says. */
export const remarkHtmlAsText = () => (tree: Root) => {
  const visit = (parent: Parent) => {
    parent.children = parent.children.map((node) => {
      if (node.type !== "html") {
        if ("children" in node) visit(node)

        return node
      }

      const text: Text = { type: "text", value: node.value }

      return BLOCK_PARENTS.has(parent.type) ? { type: "paragraph", children: [text] } : text
    }) as Parent["children"]
  }

  visit(tree)
}

const marker = (index: number): Text => ({
  type: "text",
  value: "",
  data: { hName: "span", hProperties: { dataCitation: index } },
})

/** The last word before chips and the chips themselves, in one span that never breaks, so a chip cannot wrap alone. */
const keepTogether = (word: string, markers: Text[]): Emphasis => ({
  type: "emphasis",
  children: [{ type: "text", value: word }, ...markers],
  data: { hName: "span", hProperties: { dataCitationGroup: true } },
})

/** Maps an offset in the Markdown source to the reading text, within the text it falls in or at the end of the text before it. */
const readingOffset = (leaves: Leaf[]) => (offset: number) => {
  const leaf = leaves.findLast(
    (candidate) => candidate.source !== undefined && candidate.source < offset,
  )

  return leaf ? leaf.start + Math.min(offset - leaf.source!, leaf.end - leaf.start) : 0
}

/** Places chips for the reading text and a source-offset mapper, so a caller can place them by either. */
export type PlaceMarkers = (
  plain: string,
  fromSource: (offset: number) => number,
) => MarkerPlacement[]

/** Inserts citation chip nodes after the offsets `place` picks in the document's reading text. */
export const remarkCitationMarkers =
  ({ place }: { place: PlaceMarkers }) =>
  (tree: Root) => {
    const { leaves, plain } = collectLeaves(tree)
    const placements = place(plain, readingOffset(leaves)).toSorted(([a], [b]) => b - a)

    for (const [offset, indexes] of placements) {
      const markers = indexes.map(marker)
      const leaf = leaves.findLast((candidate) => candidate.start < offset)

      if (!leaf) {
        const first = leaves[0]

        if (first)
          first.parent.children.splice(first.parent.children.indexOf(first.node), 0, ...markers)
        else tree.children.push({ type: "paragraph", children: markers })
        continue
      }

      const at = leaf.parent.children.indexOf(leaf.node)

      if (leaf.node.type !== "text") {
        leaf.parent.children.splice(at + 1, 0, ...markers)
        continue
      }

      // An earlier placement may already have moved this text's end into a group.
      const value = leaf.node.value
      const cut = Math.min(Math.min(offset, leaf.end) - leaf.start, value.length)
      const before = value.slice(0, cut)
      const word = /\S+$/u.exec(before)?.[0] ?? ""

      leaf.node.value = before.slice(0, before.length - word.length)
      const after = value.slice(cut)

      leaf.parent.children.splice(
        at + 1,
        0,
        ...(word ? [keepTogether(word, markers)] : markers),
        ...(after ? [{ type: "text", value: after } as Text] : []),
      )
    }
  }

/** The first match of a quote in reading text, ignoring whitespace, case and the Markdown or table syntax it was copied with. */
export const findQuote = (plain: string, quote: string) => {
  const words = quote
    .replace(/[*`#|]|__|~~/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))

  if (!words.length) return null
  const match = new RegExp(words.join("\\s+"), "iu").exec(plain)

  return match ? { start: match.index, end: match.index + match[0].length } : null
}

/** Wraps the reading text a quote matches in mark elements, one per text piece, so it shows in place. */
export const remarkQuoteHighlight =
  ({ quote }: { quote: string }) =>
  (tree: Root) => {
    const { leaves, plain } = collectLeaves(tree)
    const range = findQuote(plain, quote)

    if (!range) return

    for (const leaf of leaves.toReversed()) {
      if (leaf.node.type !== "text" || leaf.end <= range.start) continue
      if (leaf.start >= range.end) continue
      const value = leaf.node.value
      const from = Math.max(range.start, leaf.start) - leaf.start
      const to = Math.min(range.end, leaf.end) - leaf.start
      const marked: Emphasis = {
        type: "emphasis",
        children: [{ type: "text", value: value.slice(from, to) }],
        data: { hName: "mark", hProperties: { dataCited: true } },
      }
      const pieces: PhrasingContent[] = [
        ...(from ? [{ type: "text", value: value.slice(0, from) } as Text] : []),
        marked,
        ...(to < value.length ? [{ type: "text", value: value.slice(to) } as Text] : []),
      ]

      leaf.parent.children.splice(
        leaf.parent.children.indexOf(leaf.node),
        1,
        ...(pieces as Parent["children"]),
      )
    }
  }

/** The inline content of a paragraph or heading up to its first line break. */
const firstLineOf = (children: PhrasingContent[]): PhrasingContent[] => {
  const line: PhrasingContent[] = []

  for (const child of children) {
    if (child.type === "break") break

    if (child.type === "text" && child.value.includes("\n")) {
      line.push({ type: "text", value: child.value.split("\n")[0] ?? "" })
      break
    }

    line.push(child)
  }

  return line
}

/** The first line a reader would see, as inline content without its block syntax. */
const firstMeaningfulLine = (nodes: readonly RootContent[]): PhrasingContent[] => {
  for (const node of nodes) {
    let line: PhrasingContent[] = []

    switch (node.type) {
      case "paragraph":
      case "heading":
        line = firstLineOf(node.children)
        break
      case "blockquote":
      case "list":
      case "listItem":
        line = firstMeaningfulLine(node.children)
        break
      case "table":
        line = (node.children[0]?.children ?? []).flatMap((cell, index) => [
          ...(index ? [{ type: "text", value: " · " } as const] : []),
          ...firstLineOf(cell.children),
        ])
        break
      case "code":
        line = [{ type: "text", value: node.value.split("\n")[0] ?? "" }]
        break
    }

    if (line.some((child) => plainOf(child).trim())) return line
  }

  return []
}

/** Reduces the document to one paragraph holding its first meaningful line. */
export const remarkFirstLine = () => (tree: Root) => {
  const line = firstMeaningfulLine(tree.children)

  tree.children = line.length ? [{ type: "paragraph", children: line }] : []
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

/** Keeps absolute http, https and mailto links; any other URL is dropped. */
export const safeMarkdownUrl = (url: string): string | null => {
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}
