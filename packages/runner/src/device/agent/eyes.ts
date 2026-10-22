/**
 * The device's screen as an image, for the vision fallback: a screenshot halved (a phone screen at
 * full size is more pixels than a model reads), password fields and fields a secret went into
 * painted over, and the elements worth tapping listed as numbered marks with their places. An
 * action on the image is recorded as a gray patch of the screen around its point; a replay finds
 * the patch again (where it was, or, when it may relocate, wherever it moved) with no model.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PNG } from "pngjs"

import type { VisualTarget } from "../../replay/trace.ts"
import {
  type Box,
  crop,
  decodeGray,
  encodeGray,
  type Gray,
  likeness,
  search,
  shrink,
} from "../../vision/image.ts"
import type { DeviceBox, DeviceNode, DeviceTarget } from "../types.ts"

/** The screenshot the model sees is the screen made this many times smaller. */
export const SCALE = 2
/** Side of a stored patch, in screen pixels. */
const PATCH = 96
/** Likeness at the recorded spot that counts as the same picture. */
const ACCEPT = 0.9
/** Likeness a searched place needs, and how far it must beat any other place, to count as moved. */
const RELOCATE = 0.85
const MARGIN = 0.05
/** Searching works on the screen made this many times smaller first. */
const COARSE = 4
const REFINE = 8
/** Roles a person taps or types into, which the marks list. */
const TAPPABLE = new Set(["button", "link", "textbox", "checkbox", "switch", "radio", "img"])

/** A numbered place on the latest look: an element and where its middle is, in look pixels. */
export interface Mark {
  readonly number: number
  readonly node: DeviceNode
  readonly x: number
  readonly y: number
}

/** One look at the screen. */
export interface Look {
  /** The halved screenshot, secrets painted over. */
  readonly png: Buffer
  readonly width: number
  readonly height: number
  readonly marks: readonly Mark[]
}

/** The middle of a box. */
function middle(box: DeviceBox): { readonly x: number; readonly y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Paints `boxes` black on an RGBA image. */
function paint(image: PNG, boxes: readonly DeviceBox[]): void {
  for (const box of boxes) {
    const top = Math.max(0, Math.floor(box.y))
    const bottom = Math.min(image.height, Math.ceil(box.y + box.height))
    const left = Math.max(0, Math.floor(box.x))
    const right = Math.min(image.width, Math.ceil(box.x + box.width))

    for (let y = top; y < bottom; y++)
      image.data.fill(0, (y * image.width + left) * 4, (y * image.width + right) * 4)
  }
}

/** The average of one channel over the `factor`×`factor` pixels from (x, y) on. */
function averageAt(image: PNG, x: number, y: number, factor: number, channel: number): number {
  let sum = 0

  for (let dy = 0; dy < factor; dy++)
    for (let dx = 0; dx < factor; dx++)
      sum += image.data[((y + dy) * image.width + x + dx) * 4 + channel] ?? 0

  return Math.round(sum / factor ** 2)
}

/** `image` made `factor` times smaller, each pixel the average of the ones it covers. */
function halve(image: PNG, factor: number): PNG {
  const width = Math.floor(image.width / factor)
  const height = Math.floor(image.height / factor)
  const out = new PNG({ width, height })

  for (let at = 0; at < width * height * 4; at++) {
    const pixel = Math.floor(at / 4)
    const x = (pixel % width) * factor
    const y = Math.floor(pixel / width) * factor

    out.data[at] = averageAt(image, x, y, factor, at % 4)
  }

  return out
}

function patchBox(point: { readonly x: number; readonly y: number }): Box {
  return { x: point.x - PATCH / 2, y: point.y - PATCH / 2, width: PATCH, height: PATCH }
}

/** Where a replay found a recorded place, in screen pixels. */
export interface PlaceFound {
  readonly x: number
  readonly y: number
  readonly moved: boolean
}

/** The device's screen as images, for one session. */
export class DeviceEyes {
  private readonly target: DeviceTarget
  /** Elements a secret was typed into, by how they are found: painted over in every image. */
  private readonly secretFields = new Set<string>()
  private dir: string | undefined

  constructor(target: DeviceTarget) {
    this.target = target
  }

  /** Paints the field with `ref` over from now on (its test id, else its name). */
  holdsSecret(node: DeviceNode): void {
    this.secretFields.add(node.testId ?? `${node.role}|${node.name}`)
  }

  /** The boxes painted over in `nodes`: password fields and fields a secret went into. */
  private hidden(nodes: readonly DeviceNode[]): DeviceBox[] {
    return nodes.flatMap((node) => {
      const secret =
        node.password || this.secretFields.has(node.testId ?? `${node.role}|${node.name}`)

      return secret && node.box !== undefined ? [node.box] : []
    })
  }

  /** The screen at full size, secrets painted over; undefined when no screenshot could be taken. */
  async screen(nodes: readonly DeviceNode[]): Promise<PNG | undefined> {
    this.dir ??= await mkdtemp(join(tmpdir(), "danwo-eyes-"))

    const file = join(this.dir, "screen.png")

    if (!(await this.target.screenshot(file))) return undefined

    const image = PNG.sync.read(await readFile(file))

    paint(image, this.hidden(nodes))

    return image
  }

  /** A look at the screen with numbered marks over what can be tapped. */
  async look(nodes: readonly DeviceNode[]): Promise<Look | undefined> {
    const image = await this.screen(nodes)

    if (image === undefined) return undefined

    const small = halve(image, SCALE)
    const marks = nodes
      .filter((node) => node.box !== undefined && TAPPABLE.has(node.role))
      .map((node, at) => {
        const point = middle(node.box ?? { x: 0, y: 0, width: 0, height: 0 })

        return {
          number: at + 1,
          node,
          x: Math.round(point.x / SCALE),
          y: Math.round(point.y / SCALE),
        }
      })

    return { png: PNG.sync.write(small), width: small.width, height: small.height, marks }
  }

  /** The screen in gray, for patches. */
  private async gray(nodes: readonly DeviceNode[]): Promise<Gray | undefined> {
    const image = await this.screen(nodes)

    return image === undefined ? undefined : decodeGray(PNG.sync.write(image))
  }

  /** Records the place at `point` (screen pixels) for a replay to find again. */
  async capture(
    nodes: readonly DeviceNode[],
    point: { readonly x: number; readonly y: number },
    description: string,
  ): Promise<VisualTarget | undefined> {
    const screen = await this.gray(nodes)

    if (screen === undefined) return undefined

    return {
      description,
      patch: encodeGray(crop(screen, patchBox(point))).toString("base64"),
      point: { x: Math.round(point.x), y: Math.round(point.y) },
    }
  }

  /** Where a recorded place is now, or why it is not there. */
  async find(
    nodes: readonly DeviceNode[],
    visual: VisualTarget,
    relocating: boolean,
  ): Promise<PlaceFound | string> {
    const screen = await this.gray(nodes)

    if (screen === undefined) return "no screenshot could be taken"

    const patch = decodeGray(Buffer.from(visual.patch, "base64"))
    const here = likeness(crop(screen, patchBox(visual.point)), patch)

    if (here >= ACCEPT) return { ...visual.point, moved: false }
    if (!relocating) return `"${visual.description}" does not look the same where it was`

    const coarse = search(shrink(screen, COARSE), shrink(patch, COARSE))
    const fine =
      coarse &&
      search(screen, patch, {
        x: coarse.x * COARSE - REFINE,
        y: coarse.y * COARSE - REFINE,
        width: patch.width + 2 * REFINE,
        height: patch.height + 2 * REFINE,
      })

    if (fine === undefined || coarse === undefined || fine.score < RELOCATE)
      return `"${visual.description}" is not on the screen`
    if (fine.score - coarse.runnerUp < MARGIN)
      return `"${visual.description}" matches more than one place on the screen`

    return { x: fine.x + PATCH / 2, y: fine.y + PATCH / 2, moved: true }
  }

  /** Removes the session's screenshots. */
  async close(): Promise<void> {
    if (this.dir !== undefined)
      await rm(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** The marks as the model reads them. */
export function marksText(look: Look, redact: (text: string) => string): string {
  const lines = look.marks.map((mark) => {
    const name = mark.node.name || mark.node.text

    return `${mark.number}: ${mark.node.role}${name ? ` ${JSON.stringify(redact(name))}` : ""} at (${mark.x}, ${mark.y})`
  })

  return `The screen, ${look.width}×${look.height} pixels. Marks:\n${lines.join("\n") || "(none)"}`
}

/** Elements a person could tap that the view cannot name: icons and unlabeled controls. */
export function unnamed(nodes: readonly DeviceNode[]): number {
  return nodes.filter(
    (node) =>
      (node.role === "button" || node.role === "img") && node.name === "" && node.text === "",
  ).length
}
