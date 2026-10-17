/*
 * An app under test that knows nothing about the proxy: the official S3 client configured the
 * way Tigris's SDK configures it (endpoint https://t3.storage.dev, region "auto", virtual-hosted
 * addressing). Prints what it saw as JSON.
 */
import { Readable } from "node:stream"

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

/** What the app saw, printed as JSON for the test to read. */
interface Seen {
  streamed?: string | undefined
  body?: string | undefined
  keys?: (string | undefined)[]
  presignedHost?: string
  presignedBody?: string
  error?: string
}

const bucket = process.env["TIGRIS_STORAGE_BUCKET"]
const client = new S3Client({
  endpoint: "https://t3.storage.dev",
  region: "auto",
  credentials: {
    accessKeyId: process.env["TIGRIS_STORAGE_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["TIGRIS_STORAGE_SECRET_ACCESS_KEY"] ?? "",
  },
})
const out: Seen = {}

/** Reads one object's body as text. */
async function read(key: string): Promise<string | undefined> {
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))

  return got.Body?.transformToString()
}

try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "docs/hello.txt",
      Body: "hello tigris",
      ContentType: "text/plain",
    }),
  )
  // A stream goes up as aws-chunked with a trailing checksum.
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: "docs/streamed.txt",
      Body: Readable.from(["streamed ", "body"]),
      ContentLength: 13,
    }),
  )
  out.streamed = await read("docs/streamed.txt")
  out.body = await read("docs/hello.txt")

  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }))

  out.keys = (listed.Contents ?? []).map((o) => o.Key)

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: "docs/hello.txt" }),
    { expiresIn: 300 },
  )

  out.presignedHost = new URL(url).host
  out.presignedBody = await (await fetch(url)).text()
} catch (error) {
  out.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

client.destroy()
console.log(JSON.stringify(out))
