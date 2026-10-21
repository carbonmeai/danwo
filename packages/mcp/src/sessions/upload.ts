/**
 * `upload`: puts files into a file input, or into the file chooser an element opens when clicked.
 * A file comes from a path in the project, from a file the config offers tests by name, or from
 * the bytes the agent passes. Every file is read into memory first, so one call stays under a
 * size limit however its files are given.
 */
import { readFile, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, relative, resolve } from "node:path"

import type { Locator } from "playwright-core"

import type { UploadFile } from "./protocol.ts"

/** The most one `upload` call puts into the page, all files together. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** The most files one `upload` call takes. */
export const MAX_UPLOAD_FILES = 20

/** A file ready for the browser: its name, type and bytes. */
export interface FilePayload {
  readonly name: string
  readonly mimeType: string
  readonly buffer: Buffer
}

/** Where files come from: the project folder, and the files its config offers tests by name. */
export interface FileSource {
  readonly root: string
  readonly offered: Readonly<Record<string, string>>
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
}

const BASE64 = /^[\d+/A-Za-z\s]*={0,2}\s*$/

function mimeTypeOf(name: string): string {
  return MIME_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream"
}

/** A byte count as a person reads it: `512 B`, `12.3 KB`, `4.0 MB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function tooLarge(bytes: number): Error {
  return new Error(
    `the files come to ${sizeText(bytes)}, over the ${sizeText(MAX_UPLOAD_BYTES)} one upload may put into the page`,
  )
}

/** The path a file of the project is at; refuses one outside the project folder. */
function projectPath(root: string, path: string): string {
  const full = resolve(root, path)
  const inside = relative(root, full)

  if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
    throw new Error(
      `${JSON.stringify(path)} is outside the project folder: pass the file's bytes instead ({ name, base64 })`,
    )

  return full
}

/** Reads a file from disk, refusing it before reading when it alone is over what is left. */
async function fromDisk(path: string, left: number, shown: string): Promise<FilePayload> {
  const info = await stat(path).catch(() => undefined)

  if (info === undefined || !info.isFile()) throw new Error(`there is no file at ${shown}`)
  if (info.size > left) throw tooLarge(MAX_UPLOAD_BYTES - left + info.size)

  return { name: basename(path), mimeType: mimeTypeOf(path), buffer: await readFile(path) }
}

function fromBytes(file: Extract<UploadFile, { name: string }>): FilePayload {
  const name = basename(file.name)

  if (name === "" || name !== file.name)
    throw new Error(`${JSON.stringify(file.name)} is not a file name: give a name without folders`)

  let buffer: Buffer

  if ("text" in file) buffer = Buffer.from(file.text, "utf8")
  else if (BASE64.test(file.base64)) buffer = Buffer.from(file.base64, "base64")
  else throw new Error(`the bytes of ${name} are not base64`)

  return { name, mimeType: file.mimeType ?? mimeTypeOf(name), buffer }
}

/** One file of the call, read; `left` is how many bytes the call may still take. */
function payloadOf(file: UploadFile, source: FileSource, left: number): Promise<FilePayload> {
  if ("path" in file) return fromDisk(projectPath(source.root, file.path), left, file.path)

  if ("file" in file) {
    const path = source.offered[file.file]
    const offered = Object.keys(source.offered)

    if (path === undefined)
      throw new Error(
        `no file named ${JSON.stringify(file.file)} is under files in the config${offered.length > 0 ? `; it offers: ${offered.join(", ")}` : ""}`,
      )

    return fromDisk(resolve(source.root, path), left, file.file)
  }

  return Promise.resolve(fromBytes(file))
}

/** Reads every file of an `upload` call, under the call's size limit. */
export async function filePayloads(
  files: readonly UploadFile[],
  source: FileSource,
): Promise<FilePayload[]> {
  if (files.length > MAX_UPLOAD_FILES)
    throw new Error(`one upload takes at most ${MAX_UPLOAD_FILES} files`)

  const payloads: FilePayload[] = []
  let total = 0

  for (const file of files) {
    const payload = await payloadOf(file, source, MAX_UPLOAD_BYTES - total)

    total += payload.buffer.length
    if (total > MAX_UPLOAD_BYTES) throw tooLarge(total)
    payloads.push(payload)
  }

  return payloads
}

/**
 * Puts `payloads` into the file input `element` is, or into the file chooser it opens when
 * clicked (a styled "Choose file" button over a hidden input).
 */
export async function putFiles(
  element: Locator,
  payloads: readonly FilePayload[],
  timeout: number,
): Promise<void> {
  const type = await element.evaluate(
    (node) => (node instanceof HTMLInputElement ? node.type : node.tagName.toLowerCase()),
    undefined,
    { timeout },
  )

  if (type === "file") return element.setInputFiles([...payloads], { timeout })

  const chooser = element
    .page()
    .waitForEvent("filechooser", { timeout })
    .catch(() => {
      throw new Error("it is not a file input, and clicking it opened no file chooser")
    })

  await element.click({ timeout })
  await (await chooser).setFiles([...payloads], { timeout })
}

/** What an upload answers with: the files put in, and how a test would upload them. */
export function uploadAnswer(
  files: readonly UploadFile[],
  payloads: readonly FilePayload[],
  name: string,
): string {
  if (payloads.length === 0) return `cleared the files of ${name}`

  const list = payloads.map((payload) => `${payload.name} (${sizeText(payload.buffer.length)})`)
  const unnamed = files.some((file) => !("file" in file))

  return [
    `uploaded ${list.join(", ")} into ${name}`,
    ...(unnamed
      ? [
          "a test uploads by name: add the files under files in danwo.config.ts, then setInputFiles(names)",
        ]
      : []),
  ].join("\n")
}
