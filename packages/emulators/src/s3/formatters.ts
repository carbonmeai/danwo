/**
 * S3's XML documents. Each is first built as a plain object whose field names are the XML
 * element names, then written out by one serializer: arrays repeat their element, dates are ISO
 * timestamps and text is escaped.
 */
import type { BucketRecord, ObjectRecord, PartRecord, UploadRecord } from "./entities.ts"

const NAMESPACE = "http://s3.amazonaws.com/doc/2006-03-01/"

type Node = string | number | boolean | Date | null | undefined | Node[] | { [name: string]: Node }

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => XML_ENTITIES[char] ?? char)
}

function writeValue(value: Exclude<Node, Node[]>): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") return writeFields(value)

  return escapeXml(String(value))
}

function writeElement(name: string, value: Node): string {
  if (Array.isArray(value)) return value.map((item) => writeElement(name, item)).join("")
  if (value === undefined) return ""

  return `<${name}>${writeValue(value)}</${name}>`
}

function writeFields(fields: { [name: string]: Node }): string {
  return Object.entries(fields)
    .map(([name, value]) => writeElement(name, value))
    .join("")
}

/** A whole document: the XML declaration and `root` in S3's namespace. */
export function document(
  root: string,
  fields: { [name: string]: Node },
  namespaced = true,
): string {
  const open = namespaced ? `<${root} xmlns="${NAMESPACE}">` : `<${root}>`

  return `<?xml version="1.0" encoding="UTF-8"?>\n${open}${writeFields(fields)}</${root}>`
}

/** What an error document names besides its code: the path asked for, the bucket and the key. */
export interface ErrorSubject {
  readonly resource: string
  readonly bucket?: string | undefined
  readonly key?: string | undefined
}

/** S3's error document, naming the resource, and the bucket and key when the request had them. */
export function errorDocument(
  code: string,
  message: string,
  requestId: string,
  subject: ErrorSubject = { resource: "/" },
): string {
  return document(
    "Error",
    {
      Code: code,
      Message: message,
      Resource: subject.resource,
      RequestId: requestId,
      Key: subject.key,
      BucketName: subject.bucket,
    },
    false,
  )
}

const OWNER = { ID: "danwo", DisplayName: "danwo" }

export function bucketList(buckets: readonly BucketRecord[]): string {
  return document("ListAllMyBucketsResult", {
    Owner: OWNER,
    Buckets: {
      Bucket: buckets.map((bucket) => ({
        Name: bucket.name,
        CreationDate: new Date(bucket.created_at),
        BucketRegion: bucket.region,
      })),
    },
  })
}

/** `us-east-1` is S3's default region and is reported as an empty constraint. */
export function bucketLocation(region: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<LocationConstraint xmlns="${NAMESPACE}">${
    region === "us-east-1" ? "" : escapeXml(region)
  }</LocationConstraint>`
}

const quoted = (etag: string) => `"${etag}"`

/** One object in a listing; Tigris adds an empty `Owner` to each. */
export function listedObject(object: ObjectRecord, withOwner = false) {
  return {
    Key: object.key,
    LastModified: new Date(object.modified),
    ETag: quoted(object.etag),
    Size: object.size,
    ...(withOwner && { Owner: { ID: "" } }),
    StorageClass: "STANDARD",
  }
}

/** ListParts: an upload's parts in number order. */
export function partList(upload: UploadRecord, parts: readonly PartRecord[]): string {
  return document("ListPartsResult", {
    Bucket: upload.bucket,
    Key: upload.key,
    UploadId: upload.uploadId,
    PartNumberMarker: 0,
    NextPartNumberMarker: parts.at(-1)?.number ?? 0,
    MaxParts: 1000,
    IsTruncated: false,
    Part: parts.map((part) => ({
      ETag: quoted(part.etag),
      LastModified: new Date(part.modified),
      PartNumber: part.number,
      Size: part.size,
    })),
  })
}

/**
 * ListMultipartUploads: the uploads under way in a bucket, by key. Tigris names each upload's
 * checksum algorithm, empty when it has none.
 */
export function uploadList(
  bucket: string,
  prefix: string,
  uploads: readonly UploadRecord[],
  tigris = false,
): string {
  return document("ListMultipartUploadsResult", {
    Bucket: bucket,
    Prefix: prefix,
    KeyMarker: "",
    UploadIdMarker: "",
    IsTruncated: false,
    MaxUploads: 1000,
    Upload: uploads.map((upload) => ({
      Key: upload.key,
      UploadId: upload.uploadId,
      ...(tigris && { ChecksumAlgorithm: "" }),
      Initiated: new Date(upload.initiated),
    })),
  })
}

export function copyResult(object: ObjectRecord): string {
  return document("CopyObjectResult", {
    ETag: quoted(object.etag),
    LastModified: new Date(object.modified),
  })
}

export function deleteResult(keys: readonly string[]): string {
  return document("DeleteResult", { Deleted: keys.map((key) => ({ Key: key })) })
}

export function uploadStarted(bucket: string, key: string, uploadId: string): string {
  return document("InitiateMultipartUploadResult", { Bucket: bucket, Key: key, UploadId: uploadId })
}

/** CompleteMultipartUpload's answer; Tigris leaves out the `Location`. */
export function uploadCompleted(location: string | undefined, object: ObjectRecord): string {
  return document("CompleteMultipartUploadResult", {
    Location: location,
    Bucket: object.bucket,
    Key: object.key,
    ETag: quoted(object.etag),
  })
}

export function formPosted(location: string, object: ObjectRecord): string {
  return document(
    "PostResponse",
    { Location: location, Bucket: object.bucket, Key: object.key, ETag: quoted(object.etag) },
    false,
  )
}

/** The checksum headers of an object written with one: the value and how it covers the object. */
export function checksumHeaders(object: Pick<ObjectRecord, "checksum">): Record<string, string> {
  return object.checksum === undefined
    ? {}
    : {
        [`x-amz-checksum-${object.checksum.algorithm}`]: object.checksum.value,
        "x-amz-checksum-type": "FULL_OBJECT",
      }
}

/** The headers a GET or HEAD of `object` answers with. */
export function objectHeaders(object: ObjectRecord): Record<string, string> {
  const metadata = Object.entries(object.metadata).map(([name, value]) => [
    `x-amz-meta-${name}`,
    value,
  ])

  return {
    "content-type": object.contentType,
    "content-length": String(object.size),
    etag: quoted(object.etag),
    "last-modified": new Date(object.modified).toUTCString(),
    "accept-ranges": "bytes",
    ...object.headers,
    ...Object.fromEntries(metadata),
  }
}
