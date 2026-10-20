import { once } from "node:events"
import type { Server } from "node:http"

import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { copy, get, getPresignedUrl, head, list, move, put, remove } from "@tigrisdata/storage"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { s3, s3Objects, seedS3 } from "../src/s3/index.ts"
import { signRequest } from "../src/s3/sigv4.ts"

const BUCKET = "media"
const KEY = { accessKeyId: "tid_fidelity_key", secretAccessKey: "tsec_fidelity_secret" }

let emulator: Emulator
let server: Server
let baseUrl: string
let client: S3Client

function clientWith(key = KEY): S3Client {
  return new S3Client({ endpoint: baseUrl, region: "auto", credentials: key, maxAttempts: 1 })
}

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(s3, { baseUrl })
  client = clientWith()
})

afterAll(async () => {
  client.destroy()
  server.close()
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
  seedS3(emulator.store, { buckets: [{ name: BUCKET }], credentials: [KEY] })
})

async function rejection(promise: Promise<unknown>): Promise<S3ServiceException> {
  try {
    await promise
  } catch (error) {
    if (error instanceof S3ServiceException) return error

    throw error
  }

  throw new Error("expected the call to fail")
}

/** The Tigris SDK's settings for the emulator, as an app passes them per call. */
function config() {
  return { endpoint: baseUrl, bucket: BUCKET, ...KEY }
}

/** A request to the emulator signed with the seeded key. */
async function signed(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(await signRequest(new Request(`${baseUrl}${path}`, init), KEY, { region: "auto" }))
}

describe("signatures with seeded keys", () => {
  it("accepts the seeded key's signature through the official client", async () => {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: "a.txt", Body: "signed" }))

    expect(s3Objects(emulator).get(BUCKET, "a.txt")?.text()).toBe("signed")
  })

  it("refuses a wrong secret and an unknown key as S3 does", async () => {
    const wrong = clientWith({ ...KEY, secretAccessKey: "not-the-secret" })
    const unknown = clientWith({ accessKeyId: "tid_unknown", secretAccessKey: "x" })

    expect(
      (await rejection(wrong.send(new HeadObjectCommand({ Bucket: BUCKET, Key: "x" })))).$metadata
        .httpStatusCode,
    ).toBe(403)
    expect(
      (await rejection(wrong.send(new GetObjectCommand({ Bucket: BUCKET, Key: "x" })))).name,
    ).toBe("SignatureDoesNotMatch")
    expect(
      (await rejection(unknown.send(new GetObjectCommand({ Bucket: BUCKET, Key: "x" })))).name,
    ).toBe("InvalidAccessKeyId")

    wrong.destroy()
    unknown.destroy()
  })
})

describe("conditional requests", () => {
  beforeEach(async () => {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: "c.txt", Body: "current" }))
  })

  it("answers 304 for a current copy and 412 for a condition that fails", async () => {
    const { ETag } = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: "c.txt" }))

    expect(
      (await signed(`/${BUCKET}/c.txt`, { headers: { "if-none-match": ETag ?? "" } })).status,
    ).toBe(304)
    expect((await signed(`/${BUCKET}/c.txt`, { headers: { "if-match": '"0000"' } })).status).toBe(
      412,
    )
    expect(
      (
        await signed(`/${BUCKET}/c.txt`, {
          headers: { "if-modified-since": new Date(Date.now() + 86_400_000).toUTCString() },
        })
      ).status,
    ).toBe(304)
    expect(
      (
        await signed(`/${BUCKET}/c.txt`, {
          headers: { "if-unmodified-since": new Date(0).toUTCString() },
        })
      ).status,
    ).toBe(412)
  })

  it("refuses to overwrite with If-None-Match: * and to write over a changed ETag", async () => {
    const overwrite = client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: "c.txt", Body: "again", IfNoneMatch: "*" }),
    )
    const stale = client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: "c.txt", Body: "again", IfMatch: '"0000"' }),
    )

    expect((await rejection(overwrite)).name).toBe("PreconditionFailed")
    expect((await rejection(stale)).name).toBe("PreconditionFailed")
    expect(s3Objects(emulator).get(BUCKET, "c.txt")?.text()).toBe("current")
  })
})

describe("checksums", () => {
  it("keeps the checksum a write sends and answers reads that ask for it", async () => {
    const written = await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: "k.txt",
        Body: "checked",
        ChecksumAlgorithm: "CRC32",
      }),
    )
    const read = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: "k.txt", ChecksumMode: "ENABLED" }),
    )

    expect(written.ChecksumCRC32).toBeDefined()
    expect(read.ChecksumCRC32).toBe(written.ChecksumCRC32)
    expect(await read.Body?.transformToString()).toBe("checked")
  })
})

describe("multipart listings", () => {
  it("lists an upload's parts and the uploads under way", async () => {
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: "big.bin" }),
    )

    await client.send(
      new UploadPartCommand({
        Bucket: BUCKET,
        Key: "big.bin",
        UploadId,
        PartNumber: 1,
        Body: "one",
      }),
    )

    const parts = await client.send(
      new ListPartsCommand({ Bucket: BUCKET, Key: "big.bin", UploadId }),
    )
    const uploads = await client.send(new ListMultipartUploadsCommand({ Bucket: BUCKET }))

    expect(parts.Parts?.map((part) => [part.PartNumber, part.Size])).toEqual([[1, 3]])
    expect(uploads.Uploads?.map((upload) => upload.Key)).toEqual(["big.bin"])

    await client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: "big.bin", UploadId }))

    const gone = client.send(new ListPartsCommand({ Bucket: BUCKET, Key: "big.bin", UploadId }))

    expect((await rejection(gone)).name).toBe("NoSuchUpload")
  })
})

describe("error documents and headers", () => {
  it("names the resource, bucket and key, and refuses a malformed delete", async () => {
    const missing = await signed(`/${BUCKET}/nope.txt`)
    const malformed = await signed(`/${BUCKET}?delete`, {
      method: "POST",
      body: "<Delete><Object><Key>x</Key>",
    })

    expect(await missing.text()).toMatch(
      /<Code>NoSuchKey<\/Code>.*<Resource>\/media\/nope.txt<\/Resource>.*<Key>nope.txt<\/Key><BucketName>media<\/BucketName>/,
    )
    expect(malformed.status).toBe(400)
    expect(await malformed.text()).toMatch(/<Code>MalformedXML<\/Code>/)
  })

  it("gives every answer a request id and a length", async () => {
    const written = await signed(`/${BUCKET}/r.txt`, { method: "PUT", body: "x" })

    expect(written.headers.get("x-amz-request-id")).toMatch(/^[0-9A-F]{16}$/)
    expect(written.headers.get("content-length")).toBe("0")
  })

  it("lists objects with Tigris's details on a Tigris host", async () => {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: "t.txt", Body: "t" }))

    const request = await signRequest(
      new Request(`https://${BUCKET}.t3.storage.dev/?list-type=2`),
      KEY,
      { region: "auto" },
    )
    const xml = await (await emulator.fetch(request)).text()

    expect(xml).toContain("<Owner><ID></ID></Owner>")
    expect(xml).toContain("<ContinuationToken></ContinuationToken>")
  })
})

describe("the Tigris SDK", () => {
  it("puts, heads, reads, lists, copies, moves and removes through the emulator", async () => {
    expect(
      (await put("notes/a.txt", "from tigris", { config: config(), contentType: "text/plain" }))
        .error,
    ).toBeUndefined()

    const meta = await head("notes/a.txt", { config: config() })
    const body = await get("notes/a.txt", "string", { config: config() })

    expect(meta.data?.contentType).toBe("text/plain")
    expect(body.data).toBe("from tigris")

    expect((await copy("notes/a.txt", "notes/b.txt", { config: config() })).error).toBeUndefined()
    expect((await move("notes/b.txt", "notes/c.txt", { config: config() })).error).toBeUndefined()

    const listed = await list({ prefix: "notes/", config: config() })

    expect(listed.data?.items.map((item) => item.name)).toEqual(["notes/a.txt", "notes/c.txt"])

    await remove("notes/a.txt", { config: config() })
    await remove("notes/c.txt", { config: config() })

    expect(s3Objects(emulator).list(BUCKET)).toEqual([])
  })

  it("refuses an overwrite when asked not to overwrite", async () => {
    await put("once.txt", "first", { config: config() })

    const again = await put("once.txt", "second", { config: config(), allowOverwrite: false })

    expect(again.error?.message).toMatch(/already exists/)
  })

  it("gets a presigned URL from the service's presign call and uses it", async () => {
    await put("p.txt", "presigned", { config: config() })

    const signedUrl = await getPresignedUrl("p.txt", {
      operation: "get",
      expiresIn: 60,
      config: config(),
    })
    const response = await fetch(signedUrl.data?.url ?? "")

    expect(signedUrl.error).toBeUndefined()
    expect(await response.text()).toBe("presigned")
  })
})
