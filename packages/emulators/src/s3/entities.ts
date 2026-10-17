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
}
