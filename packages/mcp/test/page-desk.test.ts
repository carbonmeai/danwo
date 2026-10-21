import { readdirSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { MAX_UPLOAD_BYTES } from "../src/sessions/upload.ts"
import { DESK_SECRET, type DeskSite, deskSite } from "./desk.ts"

const PAGES: Readonly<Record<string, string>> = {
  "/upload": `<!doctype html><title>Upload</title><h1>Upload</h1>
    <label>Receipt <input type="file" id="receipt" multiple></label>
    <button type="button" id="pick">Choose photo</button><input type="file" id="photo" hidden>
    <button type="button">Plain</button>
    <p role="status" id="chosen">nothing chosen</p>
    <script>
      const chosen = document.getElementById("chosen")
      const show = (input) => {
        chosen.textContent =
          [...input.files].map((f) => f.name + " " + f.size + " " + f.type).join(", ") || "nothing chosen"
      }
      receipt.onchange = () => show(receipt)
      photo.onchange = () => show(photo)
      pick.onclick = () => photo.click()
    </script>`,
  "/clicks": `<!doctype html><title>Clicks</title><h1>Clicks</h1>
    <button type="button" id="item">Item</button>
    <p role="status" id="seen">no click</p>
    <script>
      const seen = document.getElementById("seen")
      const held = (e) =>
        ["shift", "meta", "ctrl", "alt"].filter((key) => e[key + "Key"]).join("+") || "no keys"
      for (const type of ["click", "dblclick", "contextmenu"])
        item.addEventListener(type, (e) => {
          if (type === "contextmenu") e.preventDefault()
          seen.textContent = type + " button " + e.button + " " + held(e)
        })
    </script>`,
}

let site: DeskSite

beforeAll(async () => {
  site = await deskSite(PAGES)
  await mkdir(join(site.root, "fixtures"))
  await writeFile(join(site.root, "fixtures", "receipt.txt"), "paid 12.00\n")
}, 60_000)

afterAll(async () => {
  await site.close()
})

describe("upload", () => {
  it("puts a project file and passed bytes into a file input", async () => {
    const { desk } = await site.open("/upload")
    const answer = await desk.act({
      kind: "upload",
      target: 'getByLabel("Receipt")',
      files: [
        { path: "fixtures/receipt.txt" },
        { name: "photo.png", base64: Buffer.from("png!").toString("base64") },
      ],
    })

    expect(answer).toContain(
      'uploaded receipt.txt (11 B), photo.png (4 B) into screen.getByLabel("Receipt")',
    )
    expect(answer).toContain("receipt.txt 11 text/plain, photo.png 4 image/png")
    expect(answer).toContain("add the files under files in danwo.config.ts")
  })

  it("uploads through the file chooser a button opens, and by the config's names", async () => {
    const { desk } = await site.open("/upload", { files: { receipt: "fixtures/receipt.txt" } })
    const answer = await desk.act({
      kind: "upload",
      target: 'getByRole("button", { name: "Choose photo" })',
      files: [{ file: "receipt" }],
    })

    expect(answer).toContain("uploaded receipt.txt (11 B)")
    expect(answer).toContain("receipt.txt 11 text/plain")
    expect(answer).not.toContain("add the files under files")
  })

  it("clears an input with an empty list", async () => {
    const { desk } = await site.open("/upload")

    await desk.act({
      kind: "upload",
      target: 'getByLabel("Receipt")',
      files: [{ name: "a.txt", text: "a" }],
    })
    expect(
      await desk.act({ kind: "upload", target: 'getByLabel("Receipt")', files: [] }),
    ).toContain('cleared the files of screen.getByLabel("Receipt")')
  })

  it("refuses files outside the project, too large, unnamed or not offered", async () => {
    const { desk } = await site.open("/upload")
    const upload = (files: Parameters<typeof desk.act>[0] & { kind: "upload" }) => desk.act(files)
    const input = 'getByLabel("Receipt")'

    await expect(
      upload({ kind: "upload", target: input, files: [{ path: "../x.txt" }] }),
    ).rejects.toThrow(/outside the project folder/)
    await expect(
      upload({
        kind: "upload",
        target: input,
        files: [{ name: "big.bin", base64: Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64") }],
      }),
    ).rejects.toThrow(/over the 10\.0 MB one upload may put into the page/)
    await expect(
      upload({ kind: "upload", target: input, files: [{ name: "a/b.txt", text: "x" }] }),
    ).rejects.toThrow(/is not a file name/)
    await expect(
      upload({ kind: "upload", target: input, files: [{ file: "nope" }] }),
    ).rejects.toThrow(/no file named "nope"/)
    await expect(
      upload({
        kind: "upload",
        target: 'getByRole("button", { name: "Plain" })',
        files: [{ name: "a.txt", text: "a" }],
      }),
    ).rejects.toThrow(/opened no file chooser/)
  }, 30_000)

  it("never shows a secret a file holds, and records a frame for the upload", async () => {
    const { desk } = await site.open("/upload")

    await desk.startRecording(false)

    const answer = await desk.act({
      kind: "upload",
      target: 'getByLabel("Receipt")',
      files: [{ name: `${DESK_SECRET}.txt`, text: "x" }],
    })

    expect(answer).not.toContain(DESK_SECRET)
    expect(await desk.stopRecording()).toContain("recorded 3 screenshots")
    expect(readdirSync(join(site.root, "recording"))).toContain("002-upload.png")
  })
})

describe("click", () => {
  const item = 'getByRole("button", { name: "Item" })'

  it("holds modifier keys", async () => {
    const { desk } = await site.open("/clicks")
    const answer = await desk.act({ kind: "click", target: item, modifiers: ["Shift", "Meta"] })

    expect(answer).toContain(
      `clicked screen.getByRole("button", { name: "Item" }), holding Shift+Meta`,
    )
    expect(answer).toContain("click button 0 shift+meta")
    /* Control alone would be a context click on macOS, as it is for a person there. */
    expect(await desk.act({ kind: "click", target: item, modifiers: ["Alt"] })).toContain(
      "click button 0 alt",
    )
  })

  it("double-clicks and right-clicks", async () => {
    const { desk } = await site.open("/clicks")
    const double = await desk.act({ kind: "click", target: item, double: true })
    const right = await desk.act({ kind: "click", target: item, button: "right" })

    expect(double).toContain("double-clicked screen.getByRole")
    expect(double).toContain("dblclick button 0 no keys")
    expect(right).toContain(
      'clicked screen.getByRole("button", { name: "Item" }) with the right button',
    )
    expect(right).toContain("contextmenu button 2 no keys")
  })
})
