import type { Entity } from "../store.ts"

/** The canned ACLs the emulator understands. */
export type Acl = "private" | "public-read" | "public-read-write"

/** Response headers S3 stores with an object and returns when it is read. */
export type ObjectHeaders = Partial<
  Record<
    "cache-control" | "content-disposition" | "content-encoding" | "content-language" | "expires",
    string
  >
>

export interface BucketRecord extends Entity {
  name: string
  region: string
  acl: Acl
}

/** The checksum algorithms a client may send with a write, by their header names. */
export const CHECKSUM_ALGORITHMS = ["crc32", "crc32c", "crc64nvme", "sha1", "sha256"] as const

export type ChecksumAlgorithm = (typeof CHECKSUM_ALGORITHMS)[number]

/** A checksum the writer sent (`x-amz-checksum-<algorithm>`), kept to answer reads with. */
export interface ObjectChecksum {
  readonly algorithm: ChecksumAlgorithm
  /** Base64, as the header carries it. */
  readonly value: string
}

/** What describes an object's content, apart from where it lives. */
export interface ObjectContent {
  /** The bytes, base64-encoded so the state stays plain JSON. */
  body: string
  size: number
  /** Hex digest without quotes; a multipart upload's ends in `-<parts>`. */
  etag: string
  contentType: string
  metadata: Record<string, string>
  headers: ObjectHeaders
  acl: Acl
  modified: string
  /** The checksum the writer sent, if any. */
  checksum?: ObjectChecksum
}

export interface ObjectRecord extends Entity, ObjectContent {
  bucket: string
  key: string
  /** `<bucket>/<key>`, for lookups. */
  path: string
}

/** A multipart upload in progress: what the finished object will be described with. */
export interface UploadRecord extends Entity {
  uploadId: string
  initiated: string
  bucket: string
  key: string
  contentType: string
  metadata: Record<string, string>
  headers: ObjectHeaders
  acl: Acl
}

export interface PartRecord extends Entity {
  uploadId: string
  number: number
  body: string
  size: number
  etag: string
  modified: string
}

/** An access key a seed names: requests signed with it have their signature checked. */
export interface AccessKeyRecord extends Entity {
  accessKeyId: string
  secretAccessKey: string
}
