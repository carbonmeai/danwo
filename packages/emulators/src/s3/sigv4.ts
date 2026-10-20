/**
 * AWS Signature Version 4 for S3: signing a request (in its `Authorization` header or as a
 * presigned URL) and checking one. The S3 emulator checks signatures only for access keys a seed
 * names, so any well-formed key still works by default; the fidelity suite signs its own requests
 * with the same code.
 */
import { createHash, createHmac } from "node:crypto"

const ALGORITHM = "AWS4-HMAC-SHA256"

/** What a presigned URL signs in place of a body hash. */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"

/** An access key and its secret. */
export interface SigningKey {
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

/** Where a signature is scoped: the region and service it was made for. */
export interface SigningScope {
  readonly region: string
  readonly service?: string
}

/** The parts of a signature a request carries, in its header or its query. */
export interface ParsedSignature {
  readonly accessKeyId: string
  readonly date: string
  readonly region: string
  readonly service: string
  readonly signedHeaders: readonly string[]
  readonly signature: string
  readonly amzDate: string
  readonly payloadHash: string
  readonly presigned: boolean
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest()
}

/** RFC 3986 encoding, as SigV4 wants it: everything but unreserved characters. */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** `20261020T120000Z` for `now`. */
function amzDateOf(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
}

/** The path as S3 signs it: each segment decoded once and encoded again, slashes kept. */
function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join("/")
}

/** The query sorted by encoded name then value, without the signature itself. */
function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
    .toSorted(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&")
}

/** A header value as signed: trimmed, with runs of spaces folded into one. */
function canonicalValue(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

/** The request SigV4 hashes: method, path, query, the signed headers and the payload hash. */
function canonicalRequest(
  method: string,
  url: URL,
  headerOf: (name: string) => string,
  signedHeaders: readonly string[],
  payloadHash: string,
): string {
  const headers = signedHeaders
    .map((name) => `${name}:${canonicalValue(headerOf(name))}\n`)
    .join("")

  return [
    method,
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    headers,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n")
}

/** The signature over `canonical` for `key` at `amzDate` within `scope`. */
function signatureOf(
  key: SigningKey,
  amzDate: string,
  scope: Required<SigningScope>,
  canonical: string,
): string {
  const date = amzDate.slice(0, 8)
  const credentialScope = `${date}/${scope.region}/${scope.service}/aws4_request`
  const toSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonical)].join("\n")
  const signingKey = [date, scope.region, scope.service, "aws4_request"].reduce<string | Buffer>(
    (current, part) => hmac(current, part),
    `AWS4${key.secretAccessKey}`,
  )

  return createHmac("sha256", signingKey).update(toSign).digest("hex")
}

function fullScope(scope: SigningScope): Required<SigningScope> {
  return { region: scope.region, service: scope.service ?? "s3" }
}

/**
 * `request` signed in its `Authorization` header, with `x-amz-date`, `x-amz-content-sha256` and
 * `host` signed. The body is hashed, so it is read once here and sent as bytes.
 */
export async function signRequest(
  request: Request,
  key: SigningKey,
  scope: SigningScope,
  now: Date = new Date(),
): Promise<Request> {
  const body = request.body === null ? undefined : new Uint8Array(await request.arrayBuffer())
  const url = new URL(request.url)
  const amzDate = amzDateOf(now)
  const headers = new Headers(request.headers)

  headers.set("x-amz-date", amzDate)
  headers.set("x-amz-content-sha256", sha256Hex(body ?? ""))

  const signed = ["host", ...headers.keys()]
    .map((name) => name.toLowerCase())
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => name === "host" || name.startsWith("x-amz-") || name === "content-type")
    .toSorted()
  const headerOf = (name: string) => (name === "host" ? url.host : (headers.get(name) ?? ""))
  const full = fullScope(scope)
  const canonical = canonicalRequest(
    request.method,
    url,
    headerOf,
    signed,
    headers.get("x-amz-content-sha256") ?? "",
  )
  const signature = signatureOf(key, amzDate, full, canonical)

  headers.set(
    "authorization",
    `${ALGORITHM} Credential=${key.accessKeyId}/${amzDate.slice(0, 8)}/${full.region}/${full.service}/aws4_request, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
  )

  return new Request(url, {
    method: request.method,
    headers,
    ...(body !== undefined && { body }),
  })
}

/** A presigned URL for `method` on `url`, valid for `expires` seconds from `now`. */
export function presignUrl(
  method: string,
  url: string,
  key: SigningKey,
  scope: SigningScope,
  expires: number,
  now: Date = new Date(),
): string {
  const target = new URL(url)
  const amzDate = amzDateOf(now)
  const full = fullScope(scope)

  target.searchParams.set("X-Amz-Algorithm", ALGORITHM)
  target.searchParams.set(
    "X-Amz-Credential",
    `${key.accessKeyId}/${amzDate.slice(0, 8)}/${full.region}/${full.service}/aws4_request`,
  )
  target.searchParams.set("X-Amz-Date", amzDate)
  target.searchParams.set("X-Amz-Expires", String(expires))
  target.searchParams.set("X-Amz-SignedHeaders", "host")

  const canonical = canonicalRequest(method, target, () => target.host, ["host"], UNSIGNED_PAYLOAD)

  target.searchParams.set("X-Amz-Signature", signatureOf(key, amzDate, full, canonical))

  return target.toString()
}

/** `Credential=<key>/<date>/<region>/<service>/aws4_request` split into its parts. */
function credentialParts(credential: string): [string, string, string, string] | undefined {
  const parts = credential.split("/")

  if (parts.length !== 5 || parts[4] !== "aws4_request") return undefined

  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""]
}

/** The signature in an `Authorization` header. */
function fromHeader(authorization: string, headerOf: (name: string) => string) {
  const fields = Object.fromEntries(
    authorization
      .slice(ALGORITHM.length)
      .split(",")
      .map((field) => {
        const trimmed = field.trim()
        const equals = trimmed.indexOf("=")

        return [trimmed.slice(0, equals), trimmed.slice(equals + 1)]
      }),
  )
  const credential = credentialParts(fields["Credential"] ?? "")

  if (credential === undefined) return undefined

  return {
    credential,
    signedHeaders: (fields["SignedHeaders"] ?? "").split(";").filter(Boolean),
    signature: fields["Signature"] ?? "",
    amzDate: headerOf("x-amz-date"),
    payloadHash: headerOf("x-amz-content-sha256") || UNSIGNED_PAYLOAD,
    presigned: false,
  }
}

/** The signature in a presigned URL's query. */
function fromQuery(params: URLSearchParams) {
  const credential = credentialParts(params.get("X-Amz-Credential") ?? "")

  if (credential === undefined) return undefined

  return {
    credential,
    signedHeaders: (params.get("X-Amz-SignedHeaders") ?? "").split(";").filter(Boolean),
    signature: params.get("X-Amz-Signature") ?? "",
    amzDate: params.get("X-Amz-Date") ?? "",
    payloadHash: UNSIGNED_PAYLOAD,
    presigned: true,
  }
}

/** The signature a request carries, or undefined when it carries none it can read. */
export function parseSignature(
  url: URL,
  headerOf: (name: string) => string,
): ParsedSignature | undefined {
  const authorization = headerOf("authorization")
  const found = authorization.startsWith(`${ALGORITHM} `)
    ? fromHeader(authorization, headerOf)
    : url.searchParams.get("X-Amz-Algorithm") === ALGORITHM
      ? fromQuery(url.searchParams)
      : undefined

  if (found === undefined) return undefined

  const [accessKeyId, date, region, service] = found.credential

  return { ...found, accessKeyId, date, region, service }
}

/**
 * Whether `parsed` is the signature `key` makes over the request. `headerOf` reads the request's
 * headers; `host` falls back to the URL's when the request carries no `host` header.
 */
export function signatureMatches(
  method: string,
  url: URL,
  headerOf: (name: string) => string,
  parsed: ParsedSignature,
  key: SigningKey,
): boolean {
  const read = (name: string) => (name === "host" ? headerOf("host") || url.host : headerOf(name))
  const canonical = canonicalRequest(method, url, read, parsed.signedHeaders, parsed.payloadHash)
  const expected = signatureOf(
    key,
    parsed.amzDate,
    { region: parsed.region, service: parsed.service },
    canonical,
  )

  return expected === parsed.signature
}
