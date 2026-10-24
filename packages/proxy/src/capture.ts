import { decodeBody } from "./bodies.ts"

/** Headers by lower-case name, repeated ones as arrays. */
type HeaderRecord = Readonly<Record<string, string | readonly string[] | undefined>>

/** Bytes of one body an exchange keeps; the rest is dropped and the body marked truncated. */
export const MAX_CAPTURED_BODY_BYTES = 16 * 1024

/** Parts of a `multipart/form-data` body an exchange keeps; the rest are dropped. */
const MAX_FORM_PARTS = 100
/** Characters of one text field a form part keeps. */
const MAX_FIELD_CHARS = 2000

/** One part of a `multipart/form-data` body: a text field, or a file kept without its content. */
export type FormPart =
  | { readonly name: string; readonly value: string }
  | {
      readonly name: string
      /** The file's name as the client sent it. */
      readonly file: string
      /** Its content type; empty when the client gave none. */
      readonly type: string
      readonly bytes: number
    }

/**
 * One side of an exchange as the proxy saw it: headers, and the body as text when its type is
 * text-like (JSON, XML, forms, `text/*`), cut at `MAX_CAPTURED_BODY_BYTES`. A `multipart/form-data`
 * body is kept as its parts instead. Captured raw: secrets are in here, so whatever persists it
 * redacts it first (the runner's flight recorder does).
 */
export interface CapturedMessage {
  readonly headers: Readonly<Record<string, string>>
  /** Null for an empty, binary or multipart body; `bytes` still counts it. */
  readonly body: string | null
  readonly bytes: number
  readonly truncated: boolean
  /** A `multipart/form-data` body's fields and files, when it could be read. */
  readonly form?: readonly FormPart[]
}

const TEXT_TYPES = /^(text\/|application\/(.+\+)?(json|xml|x-www-form-urlencoded|javascript))/i

function flatHeaders(headers: HeaderRecord): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !name.startsWith(":"))
      out[name] = typeof value === "string" ? value : value.join(", ")
  }

  return out
}

/** A form entry as a part: a field's text, clipped, or a file's name, type and size. */
function partOf(name: string, entry: FormDataEntryValue): FormPart {
  if (typeof entry === "string") return { name, value: entry.slice(0, MAX_FIELD_CHARS) }

  return { name, file: entry.name, type: entry.type, bytes: entry.size }
}

/** The parts of a `multipart/form-data` body; undefined for another type or one that does not parse. */
async function formOf(bytes: Buffer, contentType: string): Promise<FormPart[] | undefined> {
  if (bytes.length === 0 || !/^multipart\/form-data\b/i.test(contentType)) return undefined

  try {
    const form = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": contentType },
    }).formData()

    return [...form].slice(0, MAX_FORM_PARTS).map(([name, entry]) => partOf(name, entry))
  } catch {
    return undefined
  }
}

/**
 * A body as the record keeps it: decoded when all of it was kept and its encoding is known, and
 * its size, decoded or as it crossed the wire.
 */
async function decodedBody(
  body: { readonly bytes: Buffer; readonly total: number },
  encoding: string | undefined,
) {
  const whole = body.bytes.length === body.total
  const decoded = whole ? await decodeBody(body.bytes, encoding) : undefined

  return decoded === undefined
    ? { bytes: body.bytes, size: body.total, whole }
    : { bytes: decoded, size: decoded.length, whole }
}

/**
 * Captures headers and a bounded text body; never throws (an undecodable body is kept as binary).
 * `body` holds the bytes as they crossed the wire, which may be only the start of a body of
 * `total` bytes: one that large is counted, and kept as the start of its text, undecoded.
 */
export async function captureMessage(
  headers: HeaderRecord,
  body: { readonly bytes: Buffer; readonly total: number },
): Promise<CapturedMessage> {
  const flat = flatHeaders(headers)
  const type = flat["content-type"] ?? ""
  const { bytes, size, whole } = await decodedBody(body, flat["content-encoding"])
  /* The start of a compressed body is not text, whatever its type says. */
  const readable = whole || /^(?:identity)?$/i.test((flat["content-encoding"] ?? "").trim())
  const text = readable && size > 0 && TEXT_TYPES.test(type)
  const truncated = text && size > MAX_CAPTURED_BODY_BYTES
  const form = whole ? await formOf(bytes, type) : undefined

  return {
    headers: flat,
    body: text ? bytes.subarray(0, MAX_CAPTURED_BODY_BYTES).toString("utf8") : null,
    bytes: size,
    truncated,
    ...(form && { form }),
  }
}
