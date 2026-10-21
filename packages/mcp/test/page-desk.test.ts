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
  "/board": `<!doctype html><title>Board</title><h1>Board</h1>
    <section aria-label="To do"><h2>To do</h2><p draggable="true" id="card">Write the invariant</p></section>
    <section aria-label="Done" id="done"><h2>Done</h2></section>
    <p role="status" id="count">0 done</p>
    <script>
      card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", card.id))
      done.addEventListener("dragover", (e) => e.preventDefault())
      done.addEventListener("drop", (e) => {
        e.preventDefault()
        done.append(document.getElementById(e.dataTransfer.getData("text/plain")))
        count.textContent = "1 done"
      })
    </script>`,
  "/tabs": `<!doctype html><title>Home</title><h1>Home</h1>
    <a href="/second" target="_blank">Open second</a>
    <button type="button" onclick="window.open('/third', 'third', 'popup')">Pop up</button>`,
  "/second": `<!doctype html><title>Second</title><h1>Second</h1>
    <button type="button" onclick="window.close()">Close me</button>`,
  "/third": `<!doctype html><title>Third</title><h1>Third</h1>`,
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

describe("drag", () => {
  it("drags an element onto another", async () => {
    const { desk } = await site.open("/board")
    const answer = await desk.act({
      kind: "drag",
      target: 'getByText("Write the invariant")',
      to: 'getByRole("region", { name: "Done" })',
    })

    expect(answer).toContain(
      'dragged screen.getByText("Write the invariant") onto screen.getByRole("region", { name: "Done" })',
    )
    expect(answer).toMatch(/\+ - status \[ref=e\d+\]: 1 done/)
    expect(await desk.snapshot()).toMatch(/region "Done"[^]*heading "Done"[^]*Write the invariant/)
  })

  it("says which end of the drag it cannot find", async () => {
    const { desk } = await site.open("/board")

    await expect(
      desk.act({
        kind: "drag",
        target: 'getByText("Write the invariant")',
        to: 'getByText("Nowhere")',
      }),
    ).rejects.toThrow(/getByText\("Nowhere"\) matches no element/)
  })
})

describe("tabs", () => {
  it("follows a new tab and a popup, lists, switches and closes them", async () => {
    const { desk } = await site.open("/tabs")
    const opened = await desk.act({
      kind: "click",
      target: 'getByRole("link", { name: "Open second" })',
    })

    expect(opened).toContain("tab: 2 of 2 (actions now go to it)")
    expect(opened).toContain('heading "Second"')
    expect(opened).toContain("a new tab opened, and actions now go to it")

    const listed = await desk.tabList()

    expect(listed).toMatch(/^ {2}1\. Home http:\/\/127\.0\.0\.1:\d+\/tabs$/m)
    expect(listed).toMatch(/^\* 2\. Second http:\/\/127\.0\.0\.1:\d+\/second$/m)

    const back = await desk.act({ kind: "switch_tab", tab: 1 })

    expect(back).toContain("switched to tab 1\ntab: 1 of 2 (actions now go to it)")
    expect(back).toContain('heading "Home"')
    expect(await desk.snapshot()).toMatch(/^tab: 1 of 2\n/)

    const popup = await desk.act({
      kind: "click",
      target: 'getByRole("button", { name: "Pop up" })',
    })

    expect(popup).toContain("tab: 3 of 3 (actions now go to it)")
    expect(popup).toContain('heading "Third"')

    const closed = await desk.act({ kind: "close_tab" })

    expect(closed).toContain("closed tab 3\ntab: 2 of 2 (actions now go to it)")
    expect(closed).toContain('heading "Second"')
  })

  it("moves on when a tab closes itself, and keeps the last tab open", async () => {
    const { desk } = await site.open("/tabs")

    await desk.act({ kind: "click", target: 'getByRole("link", { name: "Open second" })' })

    const gone = await desk.act({
      kind: "click",
      target: 'getByRole("button", { name: "Close me" })',
    })

    expect(gone).toContain("tab: 1 of 1 (actions now go to it)")
    expect(gone).toContain('heading "Home"')
    await expect(desk.act({ kind: "close_tab" })).rejects.toThrow(/the session's only tab/)
    await expect(desk.act({ kind: "switch_tab", tab: 5 })).rejects.toThrow(
      /there is no tab 5: 1 tab is open/,
    )
  })
})
