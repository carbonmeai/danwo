/**
 * Just enough RFC 2822 / MIME for Gmail and multipart uploads: headers (folded and encoded words),
 * nested multipart bodies, base64 and quoted-printable transfer encodings, and building a message
 * from plain fields. Bodies are handled as latin1 strings so bytes survive unchanged.
 */

/** A parsed MIME entity: its headers in order, and either a body or child parts. */
export interface MimePart {
  readonly headers: readonly (readonly [string, string])[]
  readonly mimeType: string
  readonly filename: string
  /** The decoded body bytes; empty for multipart entities. */
  readonly body: Buffer
  readonly parts: readonly MimePart[]
}

const LINE = /\r?\n/

/** Splits headers from body at the first blank line. */
function splitEntity(text: string): { readonly head: string; readonly body: string } {
  const match = /\r?\n\r?\n/.exec(text)

  if (!match) return { head: text, body: "" }

  return { head: text.slice(0, match.index), body: text.slice(match.index + match[0].length) }
}

/** Decodes `=?charset?B|Q?…?=` words in a header value. */
export function decodeWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_, _charset: string, encoding: string, text: string) => {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(decodeQuotedPrintable(text.replaceAll("_", " ")), "latin1")

      return bytes.toString("utf8")
    },
  )
}

/** Unfolds and splits a header block into `[name, value]` pairs. */
export function parseHeaders(head: string): [string, string][] {
  const headers: [string, string][] = []

  for (const line of head.split(LINE)) {
    const last = headers.at(-1)

    if (/^[ \t]/.test(line) && last) last[1] = `${last[1]} ${line.trim()}`
    else {
      const colon = line.indexOf(":")

      if (colon > 0) headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
    }
  }

  return headers
}

/** The first header called `name` (case-insensitive). */
export function headerOf(
  headers: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase()

  return headers.find(([key]) => key.toLowerCase() === lower)?.[1]
}

/** A `key=value` parameter of a structured header such as `Content-Type`. */
export function headerParam(value: string, key: string): string | undefined {
  const match = new RegExp(`;\\s*${key}\\*?=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(value)

  return match?.[2] ?? match?.[1]
}

/** Quoted-printable to latin1 bytes-as-text. */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}

/** A body's bytes after its `Content-Transfer-Encoding`. */
function decodeBody(body: string, encoding: string | undefined): Buffer {
  switch (encoding?.toLowerCase()) {
    case "base64":
      return Buffer.from(body.replace(/\s+/g, ""), "base64")
    case "quoted-printable":
      return Buffer.from(decodeQuotedPrintable(body), "latin1")
    default:
      return Buffer.from(body, "latin1")
  }
}

/** The bodies between `--boundary` lines, without the preamble and epilogue. */
export function splitParts(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`
  const chunks = body.split(delimiter).slice(1)
  const parts: string[] = []

  for (const chunk of chunks) {
    if (chunk.startsWith("--")) break
    parts.push(chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
  }

  return parts
}

/** Parses one MIME entity, recursing into multipart bodies. */
export function parseMime(text: string): MimePart {
  const { head, body } = splitEntity(text)
  const headers = parseHeaders(head)
  const contentType = headerOf(headers, "content-type") ?? "text/plain"
  const mimeType = (contentType.split(";")[0] ?? "text/plain").trim().toLowerCase()
  const boundary = headerParam(contentType, "boundary")
  const disposition = headerOf(headers, "content-disposition") ?? ""
  const filename = headerParam(disposition, "filename") ?? headerParam(contentType, "name") ?? ""

  if (mimeType.startsWith("multipart/") && boundary)
    return {
      headers,
      mimeType,
      filename,
      body: Buffer.alloc(0),
      parts: splitParts(body, boundary).map(parseMime),
    }

  return {
    headers,
    mimeType,
    filename: decodeWords(filename),
    body: decodeBody(body, headerOf(headers, "content-transfer-encoding")),
    parts: [],
  }
}

/** Every leaf part, depth first. */
export function leaves(part: MimePart): MimePart[] {
  return part.parts.length === 0 ? [part] : part.parts.flatMap(leaves)
}

/** The first leaf of `mimeType` that is not an attachment, as UTF-8 text. */
export function bodyText(part: MimePart, mimeType: string): string | undefined {
  const found = leaves(part).find((leaf) => leaf.mimeType === mimeType && leaf.filename === "")

  return found?.body.toString("utf8")
}

/** A file attached to a message being composed. */
export interface Attachment {
  readonly filename: string
  readonly mimeType: string
  readonly content: Buffer
}

/** The text fields a message may be composed with, besides its sender. */
type ComposedText = "to" | "cc" | "bcc" | "subject" | "text" | "html"

/** The threading headers a composed message may carry. */
type ThreadingHeader = "messageIdHeader" | "inReplyTo" | "references"

/** The fields a message is composed from. Addresses are header values (`"Ada <ada@x>"`). */
export type Composition = Readonly<
  { from: string; date?: Date; attachments?: readonly Attachment[] } & Partial<
    Record<ComposedText | ThreadingHeader, string>
  >
>

/** A UTF-8 header value, encoded as a MIME word when it is not plain ASCII. */
function encodeHeader(value: string): string {
  return Buffer.byteLength(value, "utf8") === value.length
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
}

function textPart(mimeType: string, text: string): string {
  return [
    `Content-Type: ${mimeType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
  ].join("\r\n")
}

function attachmentPart(attachment: Attachment): string {
  return [
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    attachment.content.toString("base64"),
  ].join("\r\n")
}

function multipart(subtype: string, boundary: string, parts: readonly string[]): string {
  return [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n")
}

/** The message body: plain, HTML or both as alternatives, then any attachments. */
function composeBody(fields: Composition, boundary: string): string {
  const texts = [
    ...(fields.text !== undefined ? [textPart("text/plain", fields.text)] : []),
    ...(fields.html !== undefined ? [textPart("text/html", fields.html)] : []),
  ]
  const content = texts.length > 1 ? multipart("alternative", `${boundary}a`, texts) : texts[0]
  const files = (fields.attachments ?? []).map(attachmentPart)

  if (files.length === 0) return content ?? textPart("text/plain", "")

  return multipart("mixed", `${boundary}m`, [content ?? textPart("text/plain", ""), ...files])
}

/** An RFC 2822 message built from `fields`. */
export function composeMessage(fields: Composition, boundary: string): string {
  const optional: [string, string | undefined][] = [
    ["To", fields.to],
    ["Cc", fields.cc],
    ["Bcc", fields.bcc],
    ["In-Reply-To", fields.inReplyTo],
    ["References", fields.references],
  ]
  const headers = [
    `From: ${encodeHeader(fields.from)}`,
    ...optional
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => `${name}: ${encodeHeader(value)}`),
    `Subject: ${encodeHeader(fields.subject ?? "")}`,
    `Date: ${(fields.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    ...(fields.messageIdHeader ? [`Message-ID: ${fields.messageIdHeader}`] : []),
    "MIME-Version: 1.0",
  ]

  return `${headers.join("\r\n")}\r\n${composeBody(fields, boundary)}`
}

/** The bare addresses in an address-list header (`"Ada" <ada@x>, bob@y`), lower-cased. */
export function addressesIn(value: string | undefined): string[] {
  if (!value) return []

  return [...value.matchAll(/[^\s<>,;"]+@[^\s<>,;"]+/g)].map((match) => match[0].toLowerCase())
}
