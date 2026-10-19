/**
 * Tiptap documents as ProseMirror JSON and as the Yjs tree collaborative editors keep them in: a
 * `Y.XmlFragment` (`default` by convention) whose elements are nodes named by type, with their
 * attributes, and whose text runs carry marks as formatting attributes (`{ bold: {} }`).
 */
import * as Y from "yjs"

import { asRecord } from "../json.ts"

/** A ProseMirror node as JSON. */
export interface ProseMirrorNode {
  type: string
  attrs?: Record<string, unknown>
  content?: ProseMirrorNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** A text run's marks from its Yjs formatting attributes. */
function marksOf(attributes: unknown): ProseMirrorNode["marks"] {
  const record = asRecord(attributes)

  if (record === undefined) return undefined

  const marks = Object.entries(record).map(([type, attrs]) => {
    const fields = asRecord(attrs)

    return fields && Object.keys(fields).length > 0 ? { type, attrs: fields } : { type }
  })

  return marks.length > 0 ? marks : undefined
}

function textNodes(text: Y.XmlText): ProseMirrorNode[] {
  return text.toDelta().flatMap((op: { insert?: unknown; attributes?: unknown }) => {
    if (typeof op.insert !== "string" || op.insert === "") return []

    const marks = marksOf(op.attributes)

    return [{ type: "text", text: op.insert, ...(marks && { marks }) }]
  })
}

function nodesOf(parent: Y.XmlFragment | Y.XmlElement): ProseMirrorNode[] {
  return parent.toArray().flatMap((child): ProseMirrorNode[] => {
    if (child instanceof Y.XmlText) return textNodes(child)
    if (!(child instanceof Y.XmlElement)) return []

    const attrs = child.getAttributes()
    const content = nodesOf(child)

    return [
      {
        type: child.nodeName,
        ...(Object.keys(attrs).length > 0 && { attrs }),
        ...(content.length > 0 && { content }),
      },
    ]
  })
}

/** The fragment as a ProseMirror `doc`. */
export function fragmentToJson(fragment: Y.XmlFragment): ProseMirrorNode {
  return { type: "doc", content: nodesOf(fragment) }
}

/** The formatting attributes a text node's marks become. */
function attributesOf(marks: ProseMirrorNode["marks"]): Record<string, unknown> {
  return Object.fromEntries((marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]))
}

/** The Yjs children of a node's content: runs of text nodes join into one `XmlText`. */
function childrenOf(content: readonly ProseMirrorNode[]): (Y.XmlElement | Y.XmlText)[] {
  const children: (Y.XmlElement | Y.XmlText)[] = []
  let run: ProseMirrorNode[] = []

  const flush = () => {
    if (run.length === 0) return

    const text = new Y.XmlText()

    text.applyDelta(
      run.map((node) => ({ insert: node.text ?? "", attributes: attributesOf(node.marks) })),
    )
    children.push(text)
    run = []
  }

  for (const node of content) {
    if (node.type === "text") {
      run.push(node)
      continue
    }

    flush()

    const element = new Y.XmlElement(node.type)

    for (const [name, value] of Object.entries(node.attrs ?? {}))
      if (value !== null && value !== undefined)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Yjs keeps any JSON attribute value (a heading's numeric level), though its types say string
        element.setAttribute(name, value as string)
    element.insert(0, childrenOf(node.content ?? []))
    children.push(element)
  }

  flush()

  return children
}

/** Replaces the fragment's content with a ProseMirror `doc`'s, in one transaction on its document. */
export function replaceFragment(fragment: Y.XmlFragment, doc: ProseMirrorNode): void {
  const apply = () => {
    fragment.delete(0, fragment.length)
    fragment.insert(0, childrenOf(doc.content ?? []))
  }

  if (fragment.doc) fragment.doc.transact(apply, "rest")
  else apply()
}

/** A ProseMirror node from JSON a client sent, or undefined when it is not one. */
export function proseMirrorNodeOf(value: unknown): ProseMirrorNode | undefined {
  const record = asRecord(value)

  if (typeof record?.["type"] !== "string") return undefined

  const content = Array.isArray(record["content"])
    ? record["content"].flatMap((child) => proseMirrorNodeOf(child) ?? [])
    : undefined
  const marks = Array.isArray(record["marks"])
    ? record["marks"].flatMap((mark) => {
        const fields = asRecord(mark)

        const attrs = asRecord(fields?.["attrs"])

        return typeof fields?.["type"] === "string"
          ? [{ type: fields["type"], ...(attrs && { attrs }) }]
          : []
      })
    : undefined

  const attrs = asRecord(record["attrs"])

  return {
    type: record["type"],
    ...(attrs && { attrs }),
    ...(content && { content }),
    ...(typeof record["text"] === "string" && { text: record["text"] }),
    ...(marks && { marks }),
  }
}

/** The plain text of a ProseMirror node, blocks on their own lines. */
export function textOf(node: ProseMirrorNode): string {
  if (node.type === "text") return node.text ?? ""

  const inner = (node.content ?? []).map(textOf)
  const isBlockList = (node.content ?? []).some((child) => child.type !== "text")

  return inner.join(isBlockList ? "\n" : "")
}
