/**
 * How the S3 fidelity suite sees S3's answers. S3 answers in XML and puts much of what clients
 * read in headers, so every answer is recorded as one JSON envelope, `{ headers, body }`: the
 * headers SDKs read, and the body parsed from XML (or JSON, for Tigris's own calls). The official
 * AWS SDK drives the scenarios through a request handler that records each call it makes as a
 * scenario step and hands the SDK the provider's real answer.
 */
import { Readable } from "node:stream"

import type { ScenarioContext, StepOptions, Target } from "../scenario.ts"

/** Headers an SDK reads from S3's answers, compared by presence. */
const READ_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "x-amz-checksum-crc32",
  "x-amz-checksum-crc32c",
  "x-amz-checksum-crc64nvme",
  "x-amz-checksum-sha1",
  "x-amz-checksum-sha256",
  "x-amz-checksum-type",
  "x-amz-delete-marker",
  "x-amz-request-id",
  "x-amz-version-id",
]

/** Elements S3 repeats in a list, kept as arrays even when one appears once. */
const LIST_ELEMENTS = new Set(["CommonPrefixes", "Contents", "Deleted", "Part", "Upload"])

type Xml = string | { [name: string]: Xml | Xml[] }

interface Element {
  readonly name: string
  readonly children: Element[]
  text: string
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
}

/** The element tree of a small XML document; attributes and the declaration are left out. */
function elementTree(xml: string): Element | undefined {
  const root: Element = { name: "", children: [], text: "" }
  const open: Element[] = [root]

  for (const match of xml.matchAll(/<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>|([^<]+)/g)) {
    const [, closing, name, selfClosing, text] = match
    const current = open.at(-1) ?? root

    if (text !== undefined) current.text += decodeEntities(text)
    else if (closing === "/") open.pop()
    else if (name !== undefined) {
      const element: Element = { name, children: [], text: "" }

      current.children.push(element)
      if (selfClosing !== "/") open.push(element)
    }
  }

  return root.children[0]
}

/** An element as JSON: its text when it has no children, else its children by name. */
function asJson(element: Element, nested: boolean): Xml {
  if (element.children.length === 0) return element.text.trim()

  const fields: { [name: string]: Xml | Xml[] } = {}

  for (const child of element.children) {
    const value = asJson(child, true)
    const listed = LIST_ELEMENTS.has(child.name) || (nested && child.name === "Error")
    const existing = fields[child.name]

    if (listed) fields[child.name] = [...(Array.isArray(existing) ? existing : []), value]
    else fields[child.name] = value
  }

  return fields
}

/** An XML document as `{ <Root>: … }`, or undefined when the text is not XML. */
function xmlAsJson(xml: string): Xml | undefined {
  const tree = elementTree(xml.replace(/<\?xml[^>]*\?>/, ""))

  return tree === undefined ? undefined : { [tree.name]: asJson(tree, false) }
}

/** The body as JSON: XML parsed, JSON kept, other bytes as their text, nothing as null. */
function bodyOf(text: string, contentType: string): unknown {
  if (text === "") return null
  if (contentType.includes("json")) return JSON.parse(text)
  if (text.trimStart().startsWith("<")) return xmlAsJson(text) ?? text

  return text
}

/** The headers SDKs read, from `headers`, with every `x-amz-meta-*` header. */
function readHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].filter(
      ([name]) => READ_HEADERS.includes(name) || name.startsWith("x-amz-meta-"),
    ),
  )
}

/** Answers kept as the provider sent them, for the SDK, keyed by the request that got them. */
const rawAnswers = new WeakMap<Request, Response>()

/**
 * The provider's own answer to `request`, unredacted, for a scenario that must use a value in it
 * (a URL the service signed, whose key id redaction would change).
 */
export function keptAnswer(request: Request): Response | undefined {
  return rawAnswers.get(request)?.clone()
}

/** Each envelope target's own target, which answers as the provider does. */
const rawTargets = new WeakMap<Target, Target>()

/** The target under an envelope target, for calls that are not recorded. */
export function rawTargetOf(target: Target): Target {
  return rawTargets.get(target) ?? target
}

/**
 * `target` answering with envelopes: each answer's headers and parsed body as one JSON object,
 * so a scenario step shapes S3's XML and headers together. The provider's own answer is kept
 * for the SDK request handler.
 */
export function envelopeTarget<T extends Target>(target: T): T {
  const wrapped: T = {
    ...target,
    async send(request) {
      const response = await target.send(request)

      rawAnswers.set(request, response.clone())

      const text = await response.text()
      const envelope = {
        headers: readHeaders(response.headers),
        body: bodyOf(text, response.headers.get("content-type") ?? ""),
      }

      return new Response(JSON.stringify(envelope), {
        status: response.status,
        headers: { "content-type": "application/json" },
      })
    },
  }

  rawTargets.set(wrapped, target)

  return wrapped
}

/** The request the SDK hands its HTTP handler, as far as this handler reads it. */
interface SdkRequest {
  readonly method: string
  readonly protocol: string
  readonly hostname: string
  readonly port?: number | undefined
  readonly path: string
  readonly query?: Record<string, string | (string | null)[] | null>
  readonly headers: Record<string, string>
  readonly body?: unknown
}

/** The answer the SDK expects back from its HTTP handler. */
interface SdkResponse {
  readonly statusCode: number
  readonly headers: Record<string, string>
  readonly body: Readable
}

function queryString(query: SdkRequest["query"] = {}): string {
  const pairs = Object.entries(query).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((one) =>
      one === null
        ? encodeURIComponent(name)
        : `${encodeURIComponent(name)}=${encodeURIComponent(one)}`,
    ),
  )

  return pairs.length === 0 ? "" : `?${pairs.join("&")}`
}

/** A request body the SDK built, as bytes fetch can send. */
async function bytesOf(body: unknown): Promise<Uint8Array<ArrayBuffer> | string | undefined> {
  if (body === undefined || body === null) return undefined
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return new Uint8Array(body)

  if (body instanceof Readable) {
    const chunks: Buffer[] = []

    for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

    return new Uint8Array(Buffer.concat(chunks))
  }

  throw new Error("the SDK built a request body this handler cannot send")
}

/** Headers fetch sets itself and refuses to be given (`expect: 100-continue` among them). */
const TRANSPORT_HEADERS = new Set(["host", "expect", "connection", "transfer-encoding"])

/** The SDK's request as a fetch `Request` to the same URL, with its signed headers. */
async function asFetchRequest(request: SdkRequest): Promise<Request> {
  const port = request.port === undefined ? "" : `:${request.port}`
  const url = `${request.protocol}//${request.hostname}${port}${request.path}${queryString(request.query)}`
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !TRANSPORT_HEADERS.has(name.toLowerCase())),
  )
  const body = await bytesOf(request.body)

  return new Request(url, { method: request.method, headers, ...(body !== undefined && { body }) })
}

/** An answer as the SDK reads it, its body read into one buffer (answers here are small). */
async function asSdkResponse(response: Response): Promise<SdkResponse> {
  const bytes = Buffer.from(await response.arrayBuffer())

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: Readable.from(bytes.length === 0 ? [] : [bytes]),
  }
}

/** What the next SDK call is recorded as; none means it is sent without a step. */
interface Pending {
  readonly name: string
  readonly options: StepOptions
}

/**
 * The HTTP handler the AWS SDK sends through (its `requestHandler`): a call named by
 * {@link sdkStep} becomes a scenario step (its answer shaped and recorded), any other goes
 * straight to the target.
 */
export interface RecordingHandler {
  /** Names the SDK's next request, recorded with `options`. */
  record(name: string, options: StepOptions): void
  /** Sends one request the SDK built and answers it as the SDK expects. */
  handle(request: SdkRequest): Promise<{ response: SdkResponse }>
  updateHttpClientConfig(): void
  httpHandlerConfigs(): Record<string, never>
  destroy(): void
}

/** A {@link RecordingHandler} recording into `context`, sending unrecorded calls to `raw`. */
export function recordingHandler(context: ScenarioContext, raw: Target): RecordingHandler {
  let pending: Pending | undefined

  return {
    record(name, options) {
      pending = { name, options }
    },
    async handle(request) {
      const fetchRequest = await asFetchRequest(request)
      const recorded = pending

      pending = undefined

      if (recorded === undefined)
        return { response: await asSdkResponse(await raw.send(fetchRequest)) }

      await context.step(recorded.name, fetchRequest, recorded.options)

      const answer = rawAnswers.get(fetchRequest)

      if (answer === undefined) throw new Error(`no answer was kept for ${recorded.name}`)

      return { response: await asSdkResponse(answer) }
    },
    updateHttpClientConfig() {
      /* Nothing to configure: every request goes through the scenario's target. */
    },
    httpHandlerConfigs: () => ({}),
    destroy() {
      /* Nothing held open. */
    },
  }
}

/** A client call recorded as one step: the call's result, or the error the SDK raised. */
export async function sdkStep<T>(
  handler: RecordingHandler,
  name: string,
  call: () => Promise<T>,
  options: StepOptions = {},
): Promise<T | Error> {
  handler.record(name, options)

  try {
    return await call()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
