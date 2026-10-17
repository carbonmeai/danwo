import { createHash } from "node:crypto"
import { once } from "node:events"
import type { Server } from "node:http"
import { Readable } from "node:stream"

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  paginateListObjectsV2,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { s3, s3Hosts, s3Objects, s3OutboundFaults, seedS3 } from "../src/s3/index.ts"

const BUCKET = "media"
const SIGNED =
  "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261017/auto/s3/aws4_request, SignedHeaders=host, Signature=0"

let emulator: Emulator
let server: Server
let baseUrl: string
let client: S3Client
/** Moves the emulator clock, e.g. past a presigned URL's expiry. */
let clockOffset = 0

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(s3, { baseUrl, clock: () => new Date(Date.now() + clockOffset) })
  // Like Tigris's SDK: any key works; region "auto". An IP endpoint makes the SDK use path style.
  client = new S3Client({
    endpoint: baseUrl,
    region: "auto",
    credentials: { accessKeyId: "tid_emulated", secretAccessKey: "tsec_emulated" },
    maxAttempts: 1,
  })
})

afterAll(async () => {
  client.destroy()
  server.close()
  await emulator.close()
})

beforeEach(() => {
  clockOffset = 0
  emulator.reset()
  seedS3(emulator.store, { buckets: [{ name: BUCKET }] })
})

async function rejection(promise: Promise<unknown>): Promise<S3ServiceException> {
  try {
    await promise
  } catch (error) {
    return error as S3ServiceException
  }

  throw new Error("expected the call to fail")
}

async function put(
  key: string,
  body: string | Uint8Array,
  extra: Partial<ConstructorParameters<typeof PutObjectCommand>[0]> = {},
) {
  return client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ...extra }))
}

async function getText(key: string, bucket = BUCKET): Promise<string> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))

  return (await res.Body?.transformToString()) ?? ""
}

describe("credentials", () => {
  it("refuses an unsigned request with S3's AccessDenied document", async () => {
    const res = await fetch(`${baseUrl}/${BUCKET}?list-type=2`)

    expect(res.status).toBe(403)
    expect(await res.text()).toMatch(/<Error><Code>AccessDenied<\/Code>/)
  })

  it("accepts any SigV4-signed request", async () => {
    const res = await client.send(new ListBucketsCommand({}))

    expect(res.Buckets?.map((b) => b.Name)).toEqual([BUCKET])
  })
})

describe("buckets", () => {
  it("creates, heads, lists and deletes through the official client", async () => {
    await client.send(
      new CreateBucketCommand({
        Bucket: "reports",
        CreateBucketConfiguration: { LocationConstraint: "eu-west-1" },
      }),
    )

    const head = await client.send(new HeadBucketCommand({ Bucket: "reports" }))

    expect(head.BucketRegion).toBe("eu-west-1")
    expect(
      (await client.send(new GetBucketLocationCommand({ Bucket: "reports" }))).LocationConstraint,
    ).toBe("eu-west-1")

    const listed = await client.send(new ListBucketsCommand({}))

    expect(listed.Buckets?.map((b) => b.Name)).toEqual([BUCKET, "reports"])
    expect(listed.Buckets?.[0]?.CreationDate).toBeInstanceOf(Date)

    await client.send(new DeleteBucketCommand({ Bucket: "reports" }))
    expect(s3Objects(emulator).buckets()).toEqual([BUCKET])
  })

  it("raises the errors S3 raises", async () => {
    expect((await rejection(client.send(new CreateBucketCommand({ Bucket: BUCKET })))).name).toBe(
      "BucketAlreadyOwnedByYou",
    )
    expect(
      (await rejection(client.send(new CreateBucketCommand({ Bucket: "Bad_Name" })))).name,
    ).toBe("InvalidBucketName")
    expect((await rejection(client.send(new HeadBucketCommand({ Bucket: "missing" })))).name).toBe(
      "NotFound",
    )

    await put("a.txt", "a")
    expect((await rejection(client.send(new DeleteBucketCommand({ Bucket: BUCKET })))).name).toBe(
      "BucketNotEmpty",
    )
  })
})

describe("objects", () => {
  it("puts, gets and heads with content type, metadata, headers and ETag", async () => {
    const put1 = await put("docs/report.pdf", "%PDF-1.7 hello", {
      ContentType: "application/pdf",
      ContentDisposition: 'attachment; filename="report.pdf"',
      Metadata: { owner: "qa" },
    })

    expect(put1.ETag).toBe(`"${createHash("md5").update("%PDF-1.7 hello").digest("hex")}"`)
    const get = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: "docs/report.pdf" }))

    expect(get.ContentType).toBe("application/pdf")
    expect(get.ContentDisposition).toBe('attachment; filename="report.pdf"')
    expect(get.Metadata).toEqual({ owner: "qa" })
    expect(get.ETag).toBe(put1.ETag)
    expect(get.LastModified).toBeInstanceOf(Date)
    expect(await get.Body?.transformToString()).toBe("%PDF-1.7 hello")

    const head = await client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: "docs/report.pdf" }),
    )

    expect(head.ContentLength).toBe(14)
    expect(head.ETag).toBe(put1.ETag)
    expect(s3Objects(emulator).get(BUCKET, "docs/report.pdf")?.etag).toBe(
      put1.ETag?.replace(/"/g, ""),
    )
  })

  it("keeps arbitrary bytes and keys with spaces and unicode", async () => {
    const bytes = new Uint8Array([0, 1, 2, 0x7f, 0x80, 0xfe, 0xff])

    await put("uploads/my file ü.bin", bytes)
    const get = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: "uploads/my file ü.bin" }),
    )

    expect(new Uint8Array(await get.Body!.transformToByteArray())).toEqual(bytes)
    expect(
      s3Objects(emulator)
        .list(BUCKET)
        .map((o) => o.key),
    ).toEqual(["uploads/my file ü.bin"])
  })

  it("decodes a streamed (aws-chunked) body", async () => {
    await put(
      "stream.txt",
      Readable.from([Buffer.from("hello "), Buffer.from("stream")]) as unknown as Uint8Array,
      {
        ContentLength: 12,
      },
    )

    expect(await getText("stream.txt")).toBe("hello stream")
  })

  it("serves a byte range", async () => {
    await put("digits.txt", "0123456789")
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: "digits.txt", Range: "bytes=2-5" }),
    )

    expect(res.ContentRange).toBe("bytes 2-5/10")
    expect(await res.Body?.transformToString()).toBe("2345")
  })

  it("raises NoSuchKey, NotFound and NoSuchBucket as the SDK parses them", async () => {
    const missing = await rejection(
      client.send(new GetObjectCommand({ Bucket: BUCKET, Key: "nope" })),
    )

    expect(missing.name).toBe("NoSuchKey")
    expect(missing.$metadata.httpStatusCode).toBe(404)
    expect(
      (await rejection(client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: "nope" })))).name,
    ).toBe("NotFound")
    expect(
      (await rejection(client.send(new GetObjectCommand({ Bucket: "missing", Key: "a" })))).name,
    ).toBe("NoSuchBucket")
  })

  it("deletes one key, then several", async () => {
    await Promise.all(["a", "b", "c"].map((k) => put(k, k)))
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "a" }))
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "never-existed" }))

    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: [{ Key: "b" }, { Key: "c" }] },
      }),
    )

    expect(res.Deleted?.map((d) => d.Key)).toEqual(["b", "c"])
    expect(s3Objects(emulator).list(BUCKET)).toEqual([])
  })
})

describe("listing", () => {
  beforeEach(async () => {
    for (const key of ["a.txt", "docs/1.txt", "docs/2.txt", "docs/sub/3.txt", "img/x.png", "z.txt"])
      await put(key, key)
  })

  it("lists by prefix and rolls keys up into common prefixes at the delimiter", async () => {
    const res = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" }))

    expect(res.Contents?.map((o) => o.Key)).toEqual(["a.txt", "z.txt"])
    expect(res.CommonPrefixes?.map((p) => p.Prefix)).toEqual(["docs/", "img/"])
    expect(res.KeyCount).toBe(4)

    const docs = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "docs/", Delimiter: "/" }),
    )

    expect(docs.Contents?.map((o) => o.Key)).toEqual(["docs/1.txt", "docs/2.txt"])
    expect(docs.CommonPrefixes?.map((p) => p.Prefix)).toEqual(["docs/sub/"])
    expect(docs.Contents?.[0]).toMatchObject({ Size: 10, StorageClass: "STANDARD" })
  })

  it("paginates with continuation tokens without repeating entries", async () => {
    const keys: string[] = []

    for await (const page of paginateListObjectsV2({ client, pageSize: 2 }, { Bucket: BUCKET })) {
      expect(page.Contents?.length).toBeLessThanOrEqual(2)
      keys.push(...(page.Contents ?? []).map((o) => o.Key ?? ""))
    }

    expect(keys).toEqual([
      "a.txt",
      "docs/1.txt",
      "docs/2.txt",
      "docs/sub/3.txt",
      "img/x.png",
      "z.txt",
    ])

    const prefixes: string[] = []

    for await (const page of paginateListObjectsV2(
      { client, pageSize: 1 },
      { Bucket: BUCKET, Delimiter: "/" },
    ))
      prefixes.push(...(page.CommonPrefixes ?? []).map((p) => p.Prefix ?? ""))

    expect(prefixes).toEqual(["docs/", "img/"])
  })

  it("answers ListObjects (v1) with markers", async () => {
    const first = await client.send(new ListObjectsCommand({ Bucket: BUCKET, MaxKeys: 2 }))

    expect(first.IsTruncated).toBe(true)
    expect(first.Contents?.map((o) => o.Key)).toEqual(["a.txt", "docs/1.txt"])

    const next = await client.send(
      new ListObjectsCommand({ Bucket: BUCKET, Marker: "docs/1.txt", MaxKeys: 10 }),
    )

    expect(next.Contents?.[0]?.Key).toBe("docs/2.txt")
  })
})

describe("copy", () => {
  it("copies body, type and metadata, or replaces them", async () => {
    await put("src file.txt", "copy me", { ContentType: "text/plain", Metadata: { a: "1" } })

    const copy = await client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: "dst.txt",
        CopySource: `${BUCKET}/${encodeURIComponent("src file.txt")}`,
      }),
    )

    expect(copy.CopyObjectResult?.ETag).toMatch(/^"[0-9a-f]{32}"$/)
    expect(copy.CopyObjectResult?.LastModified).toBeInstanceOf(Date)
    expect(await getText("dst.txt")).toBe("copy me")
    expect(s3Objects(emulator).get(BUCKET, "dst.txt")).toMatchObject({
      contentType: "text/plain",
      metadata: { a: "1" },
    })

    await client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: "replaced.txt",
        CopySource: `${BUCKET}/dst.txt`,
        MetadataDirective: "REPLACE",
        ContentType: "text/markdown",
        Metadata: { b: "2" },
      }),
    )
    expect(s3Objects(emulator).get(BUCKET, "replaced.txt")).toMatchObject({
      contentType: "text/markdown",
      metadata: { b: "2" },
    })
  })

  it("renames with Tigris's X-Tigris-Rename copy", async () => {
    await put("staging/upload", "moved")
    const res = await emulator.fetch(
      new Request(`https://t3.storage.dev/${BUCKET}/final/doc?x-id=CopyObject`, {
        method: "PUT",
        headers: {
          authorization: SIGNED,
          "x-amz-copy-source": `${BUCKET}/staging/upload`,
          "x-tigris-rename": "true",
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(
      s3Objects(emulator)
        .list(BUCKET)
        .map((o) => o.key),
    ).toEqual(["final/doc"])
  })
})

describe("multipart uploads", () => {
  it("uploads in parts with lib-storage and stores the joined bytes with a multipart ETag", async () => {
    const body = Buffer.alloc(11 * 1024 * 1024, 7)

    body.write("start", 0)
    body.write("end", body.length - 3)
    const upload = new Upload({
      client,
      params: { Bucket: BUCKET, Key: "big.bin", Body: body, ContentType: "application/x-big" },
      partSize: 5 * 1024 * 1024,
      queueSize: 2,
    })
    const done = await upload.done()

    expect(done.ETag).toMatch(/^"[0-9a-f]{32}-3"$/)
    const stored = s3Objects(emulator).get(BUCKET, "big.bin")

    expect(stored?.size).toBe(body.length)
    expect(stored?.contentType).toBe("application/x-big")
    expect(stored?.bytes().equals(body)).toBe(true)
    expect(emulator.store.collection("s3.uploads").count()).toBe(0)
  })

  it("refuses parts below 5 MiB except the last, and aborts", async () => {
    const { UploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: "small" }),
    )
    const parts = await Promise.all(
      [1, 2].map(async (PartNumber) => {
        const { ETag } = await client.send(
          new UploadPartCommand({
            Bucket: BUCKET,
            Key: "small",
            UploadId,
            PartNumber,
            Body: "tiny",
          }),
        )

        return { PartNumber, ETag }
      }),
    )
    const tooSmall = await rejection(
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKET,
          Key: "small",
          UploadId,
          MultipartUpload: { Parts: parts },
        }),
      ),
    )

    expect(tooSmall.name).toBe("EntityTooSmall")
    await client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: "small", UploadId }))
    expect(
      (
        await rejection(
          client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: "small", UploadId })),
        )
      ).name,
    ).toBe("NoSuchUpload")
  })
})

describe("presigned URLs", () => {
  it("uploads with a presigned PUT and downloads with a presigned GET and response overrides", async () => {
    const putUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: BUCKET, Key: "p.txt", ContentType: "text/plain" }),
      {
        expiresIn: 60,
      },
    )
    const uploaded = await fetch(putUrl, {
      method: "PUT",
      body: "presigned",
      headers: { "content-type": "text/plain" },
    })

    expect(uploaded.status).toBe(200)

    const getUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: "p.txt",
        ResponseContentDisposition: 'attachment; filename="p.txt"',
      }),
      { expiresIn: 60 },
    )
    const downloaded = await fetch(getUrl)

    expect(downloaded.status).toBe(200)
    expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="p.txt"')
    expect(await downloaded.text()).toBe("presigned")
  })

  it("refuses a presigned URL after it expires", async () => {
    await put("p.txt", "x")
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: "p.txt" }), {
      expiresIn: 60,
    })

    clockOffset = 61_000
    const res = await fetch(url)

    expect(res.status).toBe(403)
    expect(await res.text()).toContain("Request has expired")
  })

  it("accepts a presigned POST form within its policy", async () => {
    const post = await createPresignedPost(client, {
      Bucket: BUCKET,
      Key: "avatars/${filename}",
      Conditions: [
        ["content-length-range", 1, 16],
        ["starts-with", "$Content-Type", "image/"],
      ],
      Fields: { "Content-Type": "image/png" },
    })

    const form = (file: Blob) => {
      const data = new FormData()

      for (const [name, value] of Object.entries(post.fields)) data.append(name, value)
      data.append("file", file, "me.png")

      return data
    }

    const ok = await fetch(post.url, { method: "POST", body: form(new Blob(["png bytes"])) })

    expect(ok.status).toBe(204)
    expect(s3Objects(emulator).get(BUCKET, "avatars/me.png")).toMatchObject({
      contentType: "image/png",
      size: 9,
    })

    const tooBig = await fetch(post.url, { method: "POST", body: form(new Blob(["x".repeat(17)])) })

    expect(tooBig.status).toBe(400)
    expect(await tooBig.text()).toContain("EntityTooLarge")
  })
})

describe("ACLs", () => {
  it("lets anyone read a public-read object and no one read a private one", async () => {
    await put("public.txt", "hi", { ACL: "public-read" })
    await put("private.txt", "secret")

    expect((await fetch(`${baseUrl}/${BUCKET}/public.txt`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/${BUCKET}/private.txt`)).status).toBe(403)

    await client.send(
      new PutObjectAclCommand({ Bucket: BUCKET, Key: "private.txt", ACL: "public-read" }),
    )
    expect(await (await fetch(`${baseUrl}/${BUCKET}/private.txt`)).text()).toBe("secret")
  })
})

describe("addressing", () => {
  it("takes the bucket from a virtual-hosted Tigris or AWS host", async () => {
    await put("v.txt", "virtual")

    for (const host of [
      `${BUCKET}.t3.storage.dev`,
      `${BUCKET}.fly.storage.tigris.dev`,
      `${BUCKET}.s3.us-east-1.amazonaws.com`,
    ]) {
      const res = await emulator.fetch(
        new Request(`https://${host}/v.txt`, { headers: { authorization: SIGNED } }),
      )

      expect(await res.text()).toBe("virtual")
    }
  })

  it("answers 501 for subresources it does not emulate", async () => {
    await put("v.txt", "virtual")
    const res = await emulator.fetch(
      new Request(`https://t3.storage.dev/${BUCKET}/v.txt?tagging`, {
        headers: { authorization: SIGNED },
      }),
    )

    expect(res.status).toBe(501)
    expect(await res.text()).toContain("NotImplemented")
  })

  it("lists the hosts to route for a bucket", () => {
    expect(s3Hosts(["media"], ["t3.storage.dev"])).toEqual([
      "t3.storage.dev",
      "media.t3.storage.dev",
    ])
  })
})

describe("state", () => {
  it("seeds objects and clears them on reset", () => {
    seedS3(emulator.store, {
      buckets: [
        {
          name: BUCKET,
          objects: [{ key: "seed.json", body: "{}", contentType: "application/json" }],
        },
      ],
    })

    expect(s3Objects(emulator).get(BUCKET, "seed.json")?.text()).toBe("{}")
    emulator.reset()
    expect(s3Objects(emulator).buckets()).toEqual([])
  })
})

describe("outbound faults", () => {
  it("offers S3 error documents and resets, and reset-after only for writes", () => {
    const get = s3OutboundFaults({ method: "GET" })

    expect(get.map((f) => ("status" in f ? f.status : f.kind))).toEqual([500, 503, "reset"])
    expect(get[1]).toMatchObject({ body: expect.stringContaining("<Code>SlowDown</Code>") })
    expect(s3OutboundFaults({ method: "PUT" }).at(-1)).toEqual({ kind: "reset-after" })
  })
})
