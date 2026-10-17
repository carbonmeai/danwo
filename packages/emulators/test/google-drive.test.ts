import { Readable } from "node:stream"

import { google as googleapis } from "googleapis"
import { afterEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import { type GoogleDrive, googleDrive } from "../src/google/index.ts"
import { AUTH, authFor, consent, failure, fetchVia, googleWith } from "./google-api.ts"

const DRIVE = `${AUTH}drive`
const FOLDER = "application/vnd.google-apps.folder"

let emulator: Emulator

afterEach(async () => {
  await emulator.close()
})

async function driveAs(email: string, scopes: readonly string[] = [DRIVE]) {
  const tokens = await consent(emulator, email, scopes)

  return googleapis.drive({
    version: "v3",
    auth: authFor(emulator, tokens),
    fetchImplementation: fetchVia(emulator),
  })
}

describe("Drive files", () => {
  it("uploads into a folder, lists with a query and partial fields, and downloads", async () => {
    emulator = googleWith()
    const ada = await driveAs("ada@danwo.test")
    const folder = await ada.files.create({ requestBody: { name: "Reports", mimeType: FOLDER } })
    const upload = await ada.files.create({
      requestBody: { name: "q1.csv", parents: [folder.data.id ?? ""] },
      media: { mimeType: "text/csv", body: Readable.from(["month,total\n", "jan,10\n"]) },
      fields: "id,name,mimeType,size,md5Checksum,version,parents",
    })

    expect(upload.data).toMatchObject({
      name: "q1.csv",
      mimeType: "text/csv",
      size: "19",
      version: "1",
      parents: [folder.data.id],
    })

    const listed = await ada.files.list({
      q: `'${folder.data.id ?? ""}' in parents and trashed = false`,
      fields: "files(id,name,owners/emailAddress)",
    })

    expect(listed.data).toEqual({
      files: [{ id: upload.data.id, name: "q1.csv", owners: [{ emailAddress: "ada@danwo.test" }] }],
    })

    const download = await ada.files.get(
      { fileId: upload.data.id ?? "", alt: "media" },
      { responseType: "text" },
    )

    expect(download.data).toBe("month,total\njan,10\n")
    expect((await ada.files.get({ fileId: upload.data.id ?? "" })).data).toEqual({
      kind: "drive#file",
      id: upload.data.id,
      name: "q1.csv",
      mimeType: "text/csv",
    })
  })

  it("updates content and metadata, trashes, copies and deletes", async () => {
    emulator = googleWith({
      drive: { "ada@danwo.test": [{ name: "notes.txt", mimeType: "text/plain", content: "v1" }] },
    })
    const ada = await driveAs("ada@danwo.test")
    const local: GoogleDrive = googleDrive(emulator, "ada@danwo.test")
    const id = local.files()[0]?.id ?? ""
    const updated = await ada.files.update({
      fileId: id,
      requestBody: { description: "draft" },
      media: { mimeType: "text/plain", body: "v2, longer" },
      fields: "version,size,description",
    })

    expect(updated.data).toEqual({ version: "2", size: "10", description: "draft" })
    expect(local.read(id)?.toString()).toBe("v2, longer")

    await ada.files.update({ fileId: id, requestBody: { trashed: true } })
    expect((await ada.files.list({ q: "trashed = false" })).data.files).toEqual([])

    const copy = await ada.files.copy({ fileId: id, requestBody: { name: "notes copy.txt" } })

    expect(local.read(copy.data.id ?? "")?.toString()).toBe("v2, longer")

    await ada.files.delete({ fileId: id })
    expect(await failure(ada.files.get({ fileId: id }))).toEqual({
      status: 404,
      reason: "notFound",
    })
    expect(await failure(ada.files.list({ q: "name containz 'x'" }))).toEqual({
      status: 400,
      reason: "invalid",
    })
  })

  it("shares files by permission and limits drive.file tokens to the app's own files", async () => {
    emulator = googleWith({
      drive: { "ada@danwo.test": [{ name: "plan.txt", content: "secret plan" }] },
    })
    const ada = await driveAs("ada@danwo.test")
    const id = googleDrive(emulator, "ada@danwo.test").files()[0]?.id ?? ""
    const bob = await driveAs("bob@danwo.test")

    expect(await failure(bob.files.get({ fileId: id }))).toEqual({
      status: 404,
      reason: "notFound",
    })

    const permission = await ada.permissions.create({
      fileId: id,
      requestBody: { type: "user", role: "reader", emailAddress: "bob@danwo.test" },
    })

    expect(
      (await bob.files.list({ q: "sharedWithMe", fields: "files(name,ownedByMe)" })).data.files,
    ).toEqual([{ name: "plan.txt", ownedByMe: false }])
    expect(await failure(bob.files.update({ fileId: id, requestBody: { name: "mine" } }))).toEqual({
      status: 403,
      reason: "insufficientFilePermissions",
    })
    expect(
      (await ada.permissions.list({ fileId: id })).data.permissions?.map((p) => [
        p.role,
        p.emailAddress,
      ]),
    ).toEqual([
      ["owner", "ada@danwo.test"],
      ["reader", "bob@danwo.test"],
    ])

    await ada.permissions.delete({ fileId: id, permissionId: permission.data.id ?? "" })
    expect(await failure(bob.files.get({ fileId: id }))).toEqual({
      status: 404,
      reason: "notFound",
    })

    const app = await driveAs("ada@danwo.test", [`${DRIVE}.file`])
    const made = await app.files.create({ requestBody: { name: "from-app.txt" } })

    expect((await app.files.list({})).data.files?.map((file) => file.id)).toEqual([made.data.id])
    expect(await failure(app.files.get({ fileId: id }))).toEqual({
      status: 404,
      reason: "notFound",
    })
  })

  it("takes a resumable upload in chunks", async () => {
    emulator = googleWith()
    const tokens = await consent(emulator, "ada@danwo.test", [DRIVE])
    const auth = { authorization: `Bearer ${tokens.access_token}` }
    const start = await emulator.fetch(
      new Request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ name: "big.bin", mimeType: "application/octet-stream" }),
      }),
    )
    const session = start.headers.get("location") ?? ""
    const put = (body: string, range: string) =>
      emulator.fetch(
        new Request(session, { method: "PUT", headers: { ...auth, "content-range": range }, body }),
      )
    const first = await put("hello ", "bytes 0-5/11")

    expect(first.status).toBe(308)
    expect(first.headers.get("range")).toBe("bytes=0-5")

    const last = await put("world", "bytes 6-10/11")
    const file = (await last.json()) as { id: string }

    expect(last.status).toBe(200)
    expect(googleDrive(emulator, "ada@danwo.test").read(file.id)?.toString()).toBe("hello world")
  })
})

describe("Drive changes and push", () => {
  it("lists changes from a start page token, including removals", async () => {
    emulator = googleWith()
    const ada = await driveAs("ada@danwo.test")
    const start = (await ada.changes.getStartPageToken({})).data.startPageToken ?? ""
    const local = googleDrive(emulator, "ada@danwo.test")
    const kept = local.add({ name: "kept.txt", content: "a" })
    const gone = local.add({ name: "gone.txt", content: "b" })

    local.remove(gone.id ?? "")

    const changes = await ada.changes.list({
      pageToken: start,
      fields: "newStartPageToken,changes(fileId,removed,file/name)",
    })

    expect(changes.data.changes).toEqual([
      { fileId: kept.id, removed: false, file: { name: "kept.txt" } },
      { fileId: gone.id, removed: true },
    ])
    expect(
      (await ada.changes.list({ pageToken: changes.data.newStartPageToken ?? "" })).data.changes,
    ).toEqual([])
  })

  it("sends file and change notifications on watch channels", async () => {
    const deliveries: Record<string, string>[] = []

    emulator = googleWith(
      { drive: { "ada@danwo.test": [{ name: "watched.txt", content: "x" }] } },
      {
        fetch: async (_url, init) => {
          deliveries.push(Object.fromEntries(new Headers(init?.headers)))

          return new Response(null, { status: 200 })
        },
      },
    )
    const ada = await driveAs("ada@danwo.test")
    const id = googleDrive(emulator, "ada@danwo.test").files()[0]?.id ?? ""
    const start = (await ada.changes.getStartPageToken({})).data.startPageToken ?? ""

    await ada.files.watch({
      fileId: id,
      requestBody: {
        id: "file-chan",
        type: "web_hook",
        address: "https://app.danwo.test/push/file",
      },
    })
    await ada.changes.watch({
      pageToken: start,
      requestBody: {
        id: "changes-chan",
        type: "web_hook",
        address: "https://app.danwo.test/push/changes",
      },
    })
    await ada.files.update({ fileId: id, requestBody: { name: "renamed.txt" } })
    await ada.files.update({ fileId: id, requestBody: { trashed: true } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await emulator.webhooks?.idle()

    expect(
      deliveries.map((headers) => [
        headers["x-goog-channel-id"],
        headers["x-goog-resource-state"],
        headers["x-goog-changed"],
      ]),
    ).toEqual([
      ["file-chan", "sync", undefined],
      ["changes-chan", "sync", undefined],
      ["file-chan", "update", "properties"],
      ["changes-chan", "change", undefined],
      ["file-chan", "trash", undefined],
      ["changes-chan", "change", undefined],
    ])
  })
})
