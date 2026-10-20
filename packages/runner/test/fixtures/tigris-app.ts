/**
 * A small app on the Tigris SDK, as an app would use it: everything from `TIGRIS_STORAGE_*`.
 * It puts, reads, lists, copies, moves, presigns and removes objects, then prints what it saw.
 */
import { copy, get, getPresignedUrl, list, move, put, remove } from "@tigrisdata/storage"

const written = await put("reports/a.txt", "hello tigris", { contentType: "text/plain" })
const read = await get("reports/a.txt", "string")
const copied = await copy("reports/a.txt", "reports/b.txt")
const moved = await move("reports/b.txt", "reports/c.txt")
const listed = await list({ prefix: "reports/" })
const presigned = await getPresignedUrl("reports/a.txt", { operation: "get", expiresIn: 60 })
const viaUrl = presigned.data === undefined ? "" : await (await fetch(presigned.data.url)).text()

await remove("reports/c.txt")

const errors = [written, read, copied, moved, listed, presigned].flatMap((result) =>
  result.error === undefined ? [] : [result.error.message],
)

console.log(
  JSON.stringify({
    read: read.data,
    keys: listed.data?.items.map((item) => item.name),
    viaUrl,
    errors,
  }),
)
