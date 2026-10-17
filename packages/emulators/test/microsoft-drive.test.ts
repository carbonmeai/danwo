import { OneDriveLargeFileUploadTask, ResponseType } from "@microsoft/microsoft-graph-client"
import type { DriveItem } from "@microsoft/microsoft-graph-types"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import {
  type DriveEntry,
  microsoftOutboundFaults,
  type OneDrive,
  oneDrive,
} from "../src/microsoft/index.ts"
import { ADA, GRACE, graphClient, graphEmulator, graphFetch, tokensFor } from "./microsoft-graph.ts"

const FILES = "Files.ReadWrite"

let emulator: Emulator

beforeEach(() => {
  emulator = graphEmulator({
    files: [
      { user: ADA, path: "/Documents/plan.md", content: "# Plan\n", mimeType: "text/markdown" },
      { user: ADA, path: "/Documents/Archive", folder: true },
      {
        user: ADA,
        path: "/photo.png",
        content: Buffer.from([137, 80, 78, 71]),
        mimeType: "image/png",
      },
      { user: GRACE, path: "/secret.txt", content: "grace only" },
    ],
  })
})

afterEach(async () => {
  await emulator.close()
})

const names = (items: DriveItem[]) => items.map((i) => i.name)

describe("browsing and downloading", () => {
  it("lists the root, reads items by path and id, and downloads through the redirect", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const drive = await client.api("/me/drive").get()
    const root = await client.api("/me/drive/root/children").get()
    const plan: DriveItem = await client.api("/me/drive/root:/Documents/plan.md").get()
    const byId = await client.api(`/me/drive/items/${plan.id}`).get()
    const bytes: ArrayBuffer = await client
      .api(`/me/drive/items/${plan.id}/content`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get()

    expect(drive).toMatchObject({ driveType: "business", quota: { used: 11 } })
    expect(names(root.value)).toEqual(["Documents", "photo.png"])
    expect(plan).toMatchObject({
      name: "plan.md",
      size: 7,
      file: { mimeType: "text/markdown" },
      parentReference: { path: "/drive/root:/Documents" },
    })
    expect(byId.id).toBe(plan.id)
    expect(Buffer.from(bytes).toString()).toBe("# Plan\n")
  })

  it("answers missing items and other people's drives with itemNotFound", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const graceDrive = await graphClient(emulator, GRACE, FILES).api("/me/drive").get()

    await expect(client.api("/me/drive/root:/nope.txt").get()).rejects.toMatchObject({
      statusCode: 404,
      code: "itemNotFound",
    })
    await expect(client.api(`/drives/${graceDrive.id}/root/children`).get()).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe("uploading and changing files", () => {
  it("uploads small files by path, creating folders, and honours conflict behaviour", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const created = await client.api("/me/drive/root:/Reports/2026/q3.csv:/content").put("a,b\n1,2")
    const replaced = await client
      .api("/me/drive/root:/Reports/2026/q3.csv:/content")
      .put("a,b\n3,4")
    const renamed = await client
      .api("/me/drive/root:/Reports/2026/q3.csv:/content?@microsoft.graph.conflictBehavior=rename")
      .put("x")

    expect(created).toMatchObject({ name: "q3.csv", size: 7 })
    expect(replaced.id).toBe(created.id)
    expect(renamed.name).toBe("q3 1.csv")
    expect(oneDrive(emulator, ADA).read("/Reports/2026/q3.csv")?.toString()).toBe("a,b\n3,4")
    await expect(
      client.api("/me/drive/root/children").post({ name: "Documents", folder: {} }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "nameAlreadyExists",
    })
  })

  it("uploads a large file in ranges with the official upload task", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const file = Buffer.alloc(800 * 1024, 7)
    const task = await OneDriveLargeFileUploadTask.create(client, file, {
      fileName: "big.bin",
      path: "/Uploads",
      rangeSize: 320 * 1024,
    })
    const result = await task.upload()

    expect(result.responseBody).toMatchObject({ name: "big.bin", size: file.length })
    expect(oneDrive(emulator, ADA).read("/Uploads/big.bin")?.equals(file)).toBe(true)
  })

  it("refuses an out-of-order fragment with 416", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const session = await client.api("/me/drive/root:/late.bin:/createUploadSession").post({})
    const response = await emulator.fetch(
      new Request(session.uploadUrl, {
        method: "PUT",
        headers: { "content-range": "bytes 10-19/20" },
        body: Buffer.alloc(10),
      }),
    )

    expect(response.status).toBe(416)
    expect(await response.json()).toMatchObject({ error: { code: "invalidRange" } })
  })

  it("renames and moves with PATCH, checks If-Match, copies, links and deletes", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const plan: DriveItem = await client.api("/me/drive/root:/Documents/plan.md").get()
    const archive: DriveItem = await client.api("/me/drive/root:/Documents/Archive").get()
    const moved = await client
      .api(`/me/drive/items/${plan.id}`)
      .header("If-Match", plan.eTag ?? "")
      .patch({ name: "plan-v1.md", parentReference: { id: archive.id } })

    expect(moved).toMatchObject({
      name: "plan-v1.md",
      parentReference: { id: archive.id, path: "/drive/root:/Documents/Archive" },
    })
    await expect(
      client
        .api(`/me/drive/items/${plan.id}`)
        .header("If-Match", plan.eTag ?? "")
        .patch({ name: "x" }),
    ).rejects.toMatchObject({
      statusCode: 412,
      code: "resourceModified",
    })

    const { access } = tokensFor(emulator, ADA, FILES)
    const copy = await graphFetch(emulator, access, `/v1.0/me/drive/items/${plan.id}/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "plan-copy.md" }),
    })
    const monitor = await emulator.fetch(new Request(copy.headers.get("location") ?? ""))

    expect(copy.status).toBe(202)
    expect(await monitor.json()).toMatchObject({ status: "completed" })

    const link = await client
      .api(`/me/drive/items/${plan.id}/createLink`)
      .post({ type: "view", scope: "anonymous" })
    const permissions = await client.api(`/me/drive/items/${plan.id}/permissions`).get()

    expect(link).toMatchObject({ roles: ["read"], link: { type: "view", scope: "anonymous" } })
    expect(permissions.value.map((p: { roles: string[] }) => p.roles[0])).toEqual(["owner", "read"])

    await client.api(`/me/drive/items/${plan.id}`).delete()
    expect(
      oneDrive(emulator, ADA)
        .list()
        .map((e: DriveEntry) => e.path),
    ).toContain("/Documents/Archive/plan-copy.md")
    expect(oneDrive(emulator, ADA).read("/Documents/Archive/plan-v1.md")).toBeUndefined()
  })

  it("needs Files.ReadWrite to change anything", async () => {
    const reader = graphClient(emulator, ADA, "Files.Read")

    await expect(reader.api("/me/drive/root/children").get()).resolves.toMatchObject({
      value: expect.any(Array),
    })
    await expect(reader.api("/me/drive/root:/x.txt:/content").put("x")).rejects.toMatchObject({
      statusCode: 403,
      code: "accessDenied",
    })
  })
})

describe("the drive delta", () => {
  it("returns every item first, then what changed, with deletions marked", async () => {
    const client = graphClient(emulator, ADA, FILES)
    const first = await client.api("/me/drive/root/delta").get()

    expect(first.value[0].root).toEqual({})
    expect(names(first.value).toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "Archive",
      "Documents",
      "photo.png",
      "plan.md",
      "root",
    ])

    const photo = first.value.find((i: DriveItem) => i.name === "photo.png")

    const drive: OneDrive = oneDrive(emulator, ADA)

    drive.put({ path: "/notes.txt", content: "hi" })
    await client.api(`/me/drive/items/${photo.id}`).delete()

    const changes = await client.api(first["@odata.deltaLink"]).get()

    expect(changes.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "notes.txt" }),
        expect.objectContaining({ id: photo.id, deleted: { state: "deleted" } }),
      ]),
    )

    const latest = await client.api("/me/drive/root/delta?token=latest").get()

    expect(latest.value).toEqual([])
    await expect(client.api("/me/drive/root/delta?token=garbage").get()).rejects.toMatchObject({
      statusCode: 410,
      code: "resyncRequired",
    })
  })

  it("offers 423 locked and 410 resync faults on drive calls", () => {
    const upload = microsoftOutboundFaults({
      method: "PUT",
      path: "/v1.0/me/drive/root:/a.txt:/content",
    })
    const delta = microsoftOutboundFaults({ method: "GET", path: "/v1.0/me/drive/root/delta" })

    expect(upload).toContainEqual(expect.objectContaining({ status: 423 }))
    expect(delta).toContainEqual(
      expect.objectContaining({ status: 410, body: expect.stringContaining("resyncRequired") }),
    )
  })
})
