/**
 * The S3 fidelity suite, run against Tigris (S3-compatible object storage) with a key scoped to
 * one empty test bucket. Every call goes through the official AWS SDK (`@aws-sdk/client-s3`,
 * `lib-storage`, `s3-request-presigner`), as real apps make them, except the few a scenario has to
 * send by hand (a malformed body, an unsigned read, Tigris's own presign call). Answers are
 * compared as `{ headers, body }` envelopes: the headers SDKs read and the XML as JSON.
 *
 * Nothing outside the bucket is touched and no bucket is created or deleted. Every object a
 * scenario writes lives under `danwo-fidelity/<run>/` and every object and multipart upload it
 * starts is removed afterwards, whether the scenario finishes or not.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { s3, seedS3, signRequest, type SigningKey } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepOptions, Target } from "../scenario.ts"
import { asJsonObject, type Json } from "../shape.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"
import {
  envelopeTarget,
  keptAnswer,
  rawTargetOf,
  type RecordingHandler,
  recordingHandler,
  sdkStep,
} from "./s3-wire.ts"

const ACCESS_KEY = "DANWO_FIDELITY_TIGRIS_ACCESS_KEY_ID"
const SECRET = "DANWO_FIDELITY_TIGRIS_SECRET_ACCESS_KEY"
const BUCKET = "DANWO_FIDELITY_TIGRIS_BUCKET"
const ENDPOINT = "DANWO_FIDELITY_TIGRIS_ENDPOINT"
const REGION = "DANWO_FIDELITY_TIGRIS_REGION"

const TIGRIS_ENDPOINT = "https://t3.storage.dev"

/** The emulator's stand-ins: a seeded key, so signatures are checked as the service checks them. */
const EMULATED = {
  accessKeyId: "tid_danwo_fidelity",
  secretAccessKey: "tsec_danwo_fidelity",
  bucket: "danwo-fidelity",
  endpoint: TIGRIS_ENDPOINT,
  region: "auto",
}

/** A part as small as S3 allows for any part but the last. */
const PART_SIZE = 5 * 1024 * 1024

/** Values that are part of the API and kept in a shape: error codes and fixed enumerations. */
const LITERALS = [
  "body.Error.Code",
  "headers.x-amz-checksum-type",
  "headers.accept-ranges",
  "body.ListBucketResult.IsTruncated",
  "body.ListBucketResult.Contents[].StorageClass",
  "body.ListPartsResult.IsTruncated",
  "body.ListMultipartUploadsResult.IsTruncated",
]
const STEP: StepOptions = { literals: LITERALS }

/** What a scenario works with: the client, its recording handler, the run's key prefix. */
interface Bucket {
  readonly client: S3Client
  readonly handler: RecordingHandler
  readonly bucket: string
  readonly prefix: string
  readonly key: SigningKey
  readonly region: string
  readonly endpoint: URL
}

function signingKey(target: Target): SigningKey {
  return {
    accessKeyId: credential(target, "accessKeyId"),
    secretAccessKey: credential(target, "secretAccessKey"),
  }
}

/** A client that sends through `handler`, signed with `key`. */
function clientOf(target: Target, handler: RecordingHandler, key: SigningKey): S3Client {
  return new S3Client({
    endpoint: credential(target, "endpoint"),
    region: credential(target, "region"),
    credentials: key,
    requestHandler: handler,
    maxAttempts: 1,
  })
}

/**
 * The scenario's bucket view, with cleanup registered: every key under the run's prefix is
 * deleted and every multipart upload under it aborted once the scenario ends.
 */
function bucketOf(context: ScenarioContext): Bucket {
  const handler = recordingHandler(context, rawTargetOf(context.target))
  const key = signingKey(context.target)
  const view: Bucket = {
    client: clientOf(context.target, handler, key),
    handler,
    bucket: credential(context.target, "bucket"),
    prefix: `danwo-fidelity/${context.unique}/`,
    key,
    region: credential(context.target, "region"),
    endpoint: new URL(credential(context.target, "endpoint")),
  }

  context.cleanup(() => emptyPrefix(view))

  return view
}

/** Aborts the uploads and deletes the objects under the run's prefix; unrecorded. */
async function emptyPrefix(view: Bucket): Promise<void> {
  const { client, bucket, prefix } = view
  const uploads = await client.send(
    new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix }),
  )

  for (const upload of uploads.Uploads ?? [])
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }),
    )

  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
  const keys = (listed.Contents ?? []).flatMap((object) =>
    object.Key ? [{ Key: object.Key }] : [],
  )

  if (keys.length > 0)
    await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
    )

  client.destroy()
}

/** A virtual-hosted URL for `key` in the bucket, or for the bucket itself. */
function urlOf(view: Bucket, key = "", query = ""): string {
  const path = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")

  return `https://${view.bucket}.${view.endpoint.host}/${path}${query}`
}

/** A request signed with the bucket's key, sent as a recorded step. */
async function signedStep(
  context: ScenarioContext,
  view: Bucket,
  name: string,
  request: Request,
): Promise<void> {
  await context.step(name, await signRequest(request, view.key, { region: view.region }), STEP)
}

function put(view: Bucket, key: string, body: string, extra: Record<string, unknown> = {}) {
  return () =>
    view.client.send(
      new PutObjectCommand({
        Bucket: view.bucket,
        Key: `${view.prefix}${key}`,
        Body: body,
        ...extra,
      }),
    )
}

const objects: Scenario = {
  name: "objects: put, head, get, range, copy, delete",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view

    await sdkStep(
      handler,
      "put an object with a type, metadata and a checksum",
      put(view, "a.txt", "hello fidelity", {
        ContentType: "text/plain",
        Metadata: { purpose: "fidelity" },
        ChecksumAlgorithm: "CRC32",
      }),
      STEP,
    )
    await sdkStep(
      handler,
      "head it",
      () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}a.txt` })),
      STEP,
    )

    const got = await sdkStep(
      handler,
      "get it with its checksum",
      () =>
        client.send(
          new GetObjectCommand({ Bucket: bucket, Key: `${prefix}a.txt`, ChecksumMode: "ENABLED" }),
        ),
      STEP,
    )

    context.fact(
      "the SDK reads the body back",
      got instanceof Error
        ? got.name
        : await (got.Body?.transformToString() ?? Promise.resolve("")),
    )

    const range = await sdkStep(
      handler,
      "get the first five bytes",
      () =>
        client.send(
          new GetObjectCommand({ Bucket: bucket, Key: `${prefix}a.txt`, Range: "bytes=0-4" }),
        ),
      STEP,
    )

    context.fact(
      "a range reads only its bytes",
      range instanceof Error
        ? range.name
        : await (range.Body?.transformToString() ?? Promise.resolve("")),
    )
    await sdkStep(
      handler,
      "copy it",
      () =>
        client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: `${prefix}b.txt`,
            CopySource: `${bucket}/${prefix}a.txt`,
          }),
        ),
      STEP,
    )

    const deleted = await sdkStep(
      handler,
      "delete both at once",
      () =>
        client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: [{ Key: `${prefix}a.txt` }, { Key: `${prefix}b.txt` }] },
          }),
        ),
      STEP,
    )

    context.fact(
      "delete-many reports both keys",
      deleted instanceof Error ? -1 : (deleted.Deleted?.length ?? 0),
    )
    await sdkStep(
      handler,
      "delete one that is gone",
      () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefix}a.txt` })),
      STEP,
    )
  },
}

const listing: Scenario = {
  name: "listing: prefixes, delimiter, pages",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view

    for (const key of ["d/1", "d/2", "e/1", "f", "g"]) await put(view, key, key)()

    await sdkStep(
      handler,
      "list with a delimiter",
      () =>
        client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" })),
      STEP,
    )

    const pages: string[] = []
    let token: string | undefined

    for (let page = 1; page <= 3; page++) {
      const answer = await sdkStep(
        handler,
        `list page ${page} of two keys`,
        () =>
          client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              MaxKeys: 2,
              ContinuationToken: token,
            }),
          ),
        STEP,
      )

      if (answer instanceof Error) break

      pages.push(
        ...(answer.Contents ?? []).map((object) => (object.Key ?? "").slice(prefix.length)),
      )
      token = answer.NextContinuationToken

      if (token === undefined) break
    }

    context.fact("pages list every key once, in order", pages.join(","))
    await sdkStep(
      handler,
      "list (v1) two keys",
      () => client.send(new ListObjectsCommand({ Bucket: bucket, Prefix: prefix, MaxKeys: 2 })),
      STEP,
    )
  },
}

const multipart: Scenario = {
  name: "multipart: parts, listings, complete, abort",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view
    const key = `${prefix}multi.bin`
    const started = await sdkStep(
      handler,
      "start an upload",
      () =>
        client.send(
          new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            ContentType: "application/octet-stream",
          }),
        ),
      STEP,
    )

    if (started instanceof Error || started.UploadId === undefined) return

    const uploadId = started.UploadId
    const part = (number: number, body: Uint8Array | string) =>
      sdkStep(
        handler,
        `upload part ${number}`,
        () =>
          client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: number,
              Body: body,
            }),
          ),
        STEP,
      )
    const first = await part(1, new Uint8Array(PART_SIZE))
    const second = await part(2, "tail")

    await sdkStep(
      handler,
      "list its parts",
      () => client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId })),
      STEP,
    )
    await sdkStep(
      handler,
      "list the uploads under way",
      () => client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix })),
      STEP,
    )
    await sdkStep(
      handler,
      "complete it",
      () =>
        client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [
                { PartNumber: 1, ETag: first instanceof Error ? "" : first.ETag },
                { PartNumber: 2, ETag: second instanceof Error ? "" : second.ETag },
              ],
            },
          }),
        ),
      STEP,
    )

    const joined = await sdkStep(
      handler,
      "head the joined object",
      () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
      STEP,
    )

    context.fact(
      "the joined object is both parts",
      joined instanceof Error ? -1 : (joined.ContentLength ?? 0),
    )
    context.fact(
      "its ETag counts the parts",
      joined instanceof Error ? "" : (joined.ETag ?? "").replace(/^"[0-9a-f]+/, ""),
    )

    const aborted = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: `${prefix}aborted.bin` }),
    )

    await sdkStep(
      handler,
      "abort an upload",
      () =>
        client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: `${prefix}aborted.bin`,
            UploadId: aborted.UploadId,
          }),
        ),
      STEP,
    )
    await sdkStep(
      handler,
      "list an aborted upload's parts",
      () =>
        client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: `${prefix}aborted.bin`,
            UploadId: aborted.UploadId,
          }),
        ),
      STEP,
    )

    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: `${prefix}library.bin`, Body: Buffer.alloc(PART_SIZE + 1) },
      partSize: PART_SIZE,
    })

    await upload.done()

    const stored = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}library.bin` }),
    )

    context.fact("lib-storage uploads a large body in parts", stored.ContentLength ?? 0)
  },
}

const presigned: Scenario = {
  name: "presigned URLs: put, get, expired",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix } = view
    const key = `${prefix}presigned.txt`
    const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 60,
    })

    await context.step(
      "put through a presigned URL",
      new Request(putUrl, { method: "PUT", body: "via presign" }),
      STEP,
    )

    const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 60,
    })
    const read = await context.step("get through a presigned URL", new Request(getUrl), STEP)

    context.fact(
      "a presigned GET reads what the presigned PUT wrote",
      fieldIn(read.body, "body") ?? "",
    )

    const expiredUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      {
        expiresIn: 1,
        signingDate: new Date(Date.now() - 60_000),
      },
    )

    await context.step("get through an expired presigned URL", new Request(expiredUrl), STEP)
  },
}

const conditional: Scenario = {
  name: "conditional requests: if-match, if-none-match, dates",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view
    const key = `${prefix}c.txt`

    await put(view, "c.txt", "current")()

    const { ETag } = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    const get = (name: string, extra: Record<string, unknown>) =>
      sdkStep(
        handler,
        name,
        () => client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...extra })),
        STEP,
      )

    await get("get with its own ETag in If-None-Match", { IfNoneMatch: ETag })
    await get("get with another ETag in If-Match", {
      IfMatch: '"00000000000000000000000000000000"',
    })
    await get("get modified since tomorrow", { IfModifiedSince: new Date(Date.now() + 86_400_000) })
    await get("get unmodified since 1970", { IfUnmodifiedSince: new Date(0) })
    await sdkStep(
      handler,
      "put over it with If-None-Match: *",
      put(view, "c.txt", "again", { IfNoneMatch: "*" }),
      STEP,
    )
    await sdkStep(
      handler,
      "put over another ETag with If-Match",
      put(view, "c.txt", "again", { IfMatch: '"00000000000000000000000000000000"' }),
      STEP,
    )
  },
}

const errors: Scenario = {
  name: "errors: missing key and bucket, bad range, signatures, malformed body",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view

    await put(view, "e.txt", "short")()
    await sdkStep(
      handler,
      "get a missing key",
      () => client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}missing` })),
      STEP,
    )
    await sdkStep(
      handler,
      "head a missing key",
      () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}missing` })),
      STEP,
    )
    await sdkStep(
      handler,
      "get a range past the end",
      () =>
        client.send(
          new GetObjectCommand({ Bucket: bucket, Key: `${prefix}e.txt`, Range: "bytes=500-600" }),
        ),
      STEP,
    )
    await sdkStep(
      handler,
      "list a bucket that does not exist",
      () =>
        client.send(
          new ListObjectsV2Command({ Bucket: `danwo-fidelity-missing-${context.unique}` }),
        ),
      STEP,
    )

    for (const [name, key] of [
      [
        "get with a wrong secret",
        { ...view.key, secretAccessKey: `${view.key.secretAccessKey}-wrong` },
      ],
      [
        "get with an unknown key",
        { accessKeyId: "tid_danwo_fidelity_unknown", secretAccessKey: "unknown" },
      ],
    ] as const) {
      const other = clientOf(context.target, handler, key)

      await sdkStep(
        handler,
        name,
        () => other.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}e.txt` })),
        STEP,
      )
      other.destroy()
    }

    await context.step("get without a signature", new Request(urlOf(view, `${prefix}e.txt`)), STEP)
    await signedStep(
      context,
      view,
      "delete with a malformed body",
      new Request(urlOf(view, "", "?delete"), {
        method: "POST",
        body: "<Delete><Object><Key>x</Key>",
      }),
    )
  },
}

const tigrisCalls: Scenario = {
  name: "tigris: the presign call and renames",
  async run(context) {
    const view = bucketOf(context)
    const { client, bucket, prefix, handler } = view

    await put(view, "t.txt", "renamed later")()

    const presign = await signRequest(
      new Request(`${view.endpoint.origin}/?func=presign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bucket,
          expires_in: 60,
          key: `${prefix}t.txt`,
          key_id: view.key.accessKeyId,
          type: "get",
        }),
      }),
      view.key,
      { region: view.region },
    )

    await context.step("ask the service for a presigned GET", presign, STEP)

    const answer: unknown = await keptAnswer(presign)
      ?.json()
      .catch(() => undefined)
    const url =
      typeof answer === "object" &&
      answer !== null &&
      "url" in answer &&
      typeof answer.url === "string"
        ? answer.url
        : undefined

    if (url !== undefined)
      await context.step("get through the service's URL", new Request(url), STEP)

    await signedStep(
      context,
      view,
      "rename with X-Tigris-Rename",
      new Request(urlOf(view, `${prefix}moved.txt`), {
        method: "PUT",
        headers: { "x-amz-copy-source": `/${bucket}/${prefix}t.txt`, "x-tigris-rename": "true" },
      }),
    )
    await sdkStep(
      handler,
      "head the renamed source",
      () => client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}t.txt` })),
      STEP,
    )
  },
}

/** The text field `name` of a JSON object, such as an envelope's `body` or a presign's `url`. */
function fieldIn(value: Json | undefined, name: string): string | undefined {
  const field = asJsonObject(value)?.[name]

  return typeof field === "string" ? field : undefined
}

export const s3Fidelity: FidelityProvider = {
  name: "s3",
  credentials: [
    { name: ACCESS_KEY, description: "a Tigris access key scoped to one empty test bucket" },
    { name: SECRET, description: "that key's secret" },
    {
      name: BUCKET,
      description:
        "the test bucket; the suite writes only under danwo-fidelity/<run>/ and removes all it writes",
    },
    { name: ENDPOINT, description: `the S3 endpoint (default ${TIGRIS_ENDPOINT})`, optional: true },
    { name: REGION, description: "the signing region (default auto)", optional: true },
  ],
  scenarios: [objects, listing, multipart, presigned, conditional, errors, tigrisCalls],
  async emulator() {
    return envelopeTarget(
      await emulatorTarget(s3, EMULATED, (emulator) =>
        seedS3(emulator.store, {
          buckets: [{ name: EMULATED.bucket }],
          credentials: [
            { accessKeyId: EMULATED.accessKeyId, secretAccessKey: EMULATED.secretAccessKey },
          ],
        }),
      ),
    )
  },
  live(env) {
    const found = requiredCredentials(this, env)

    if (found === undefined) return undefined

    return envelopeTarget(
      liveTarget({
        accessKeyId: found[ACCESS_KEY] ?? "",
        secretAccessKey: found[SECRET] ?? "",
        bucket: found[BUCKET] ?? "",
        endpoint: found[ENDPOINT] ?? TIGRIS_ENDPOINT,
        region: found[REGION] ?? "auto",
      }),
    )
  },
}
