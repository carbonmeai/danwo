/**
 * Conditional requests: `If-Match`, `If-None-Match`, `If-Modified-Since` and
 * `If-Unmodified-Since` on reads, and `If-None-Match: *` and `If-Match` on writes, answered as S3
 * answers them (304 Not Modified for a read whose copy is current, 412 PreconditionFailed for a
 * condition that does not hold).
 */
import type { Context } from "../http.ts"
import type { ObjectRecord } from "./entities.ts"
import { noSuchKey, S3Error } from "./helpers.ts"

const preconditionFailed = () =>
  new S3Error(
    "PreconditionFailed",
    "At least one of the pre-conditions you specified did not hold",
    412,
  )

/** Whether an `If-Match`/`If-None-Match` list names `etag`; `*` names any object. */
function names(header: string, etag: string): boolean {
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, "").replaceAll('"', ""))
    .some((tag) => tag === "*" || tag === etag)
}

/** Seconds since the epoch, the precision `Last-Modified` dates carry. */
function seconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000)
}

/** A date header in seconds, or undefined when absent or unreadable. */
function dateHeader(c: Context, name: string): number | undefined {
  const value = c.req.header(name)
  const time = value === undefined ? Number.NaN : Date.parse(value)

  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined
}

/** The `If-Match` and `If-Unmodified-Since` checks: a failure is 412. */
function mustHold(c: Context, object: ObjectRecord): void {
  const match = c.req.header("if-match")
  const unmodifiedSince = dateHeader(c, "if-unmodified-since")

  if (match !== undefined && !names(match, object.etag)) throw preconditionFailed()
  if (
    match === undefined &&
    unmodifiedSince !== undefined &&
    seconds(object.modified) > unmodifiedSince
  )
    throw preconditionFailed()
}

/** The `If-None-Match` and `If-Modified-Since` checks: whether the reader's copy is current. */
function isCurrent(c: Context, object: ObjectRecord): boolean {
  const noneMatch = c.req.header("if-none-match")
  const modifiedSince = dateHeader(c, "if-modified-since")

  if (noneMatch !== undefined) return names(noneMatch, object.etag)

  return modifiedSince !== undefined && seconds(object.modified) <= modifiedSince
}

/**
 * Applies a GET's or HEAD's conditions to `object`: throws 412 when one does not hold, and
 * answers whether the read is a 304 Not Modified.
 */
export function readNotModified(c: Context, object: ObjectRecord): boolean {
  mustHold(c, object)

  return isCurrent(c, object)
}

/**
 * Applies a PUT's conditions: `If-None-Match: *` refuses to overwrite, and `If-Match` needs the
 * current object to have one of the named ETags (an absent object is NoSuchKey).
 */
export function checkWrite(c: Context, current: ObjectRecord | undefined): void {
  const noneMatch = c.req.header("if-none-match")
  const match = c.req.header("if-match")

  if (noneMatch !== undefined && current !== undefined && names(noneMatch, current.etag))
    throw preconditionFailed()
  if (match === undefined) return
  if (current === undefined) throw noSuchKey()
  if (!names(match, current.etag)) throw preconditionFailed()
}
