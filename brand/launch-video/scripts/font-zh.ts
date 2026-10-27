/**
 * Cuts Noto Sans SC down to the characters the Chinese copy uses, so the film carries a font of a
 * few hundred kilobytes rather than the whole 17 MB of it.
 *
 * Usage: `node scripts/font-zh.ts <NotoSansSC[wght].ttf>`, the variable font from Google Fonts
 * (github.com/google/fonts, ofl/notosanssc). Needs fontTools with brotli: `pip install fonttools
 * brotli`. Run it again after changing the Chinese copy.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { ZH } from "../src/copy.ts"

const source = process.argv[2]

if (source === undefined) throw new Error("usage: node scripts/font-zh.ts <NotoSansSC[wght].ttf>")

/** Every string in `value`, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (typeof value !== "object" || value === null) return []

  return Object.values(value).flatMap(strings)
}

const characters = [...new Set(strings(ZH).join(""))].join("")
const textFile = join(mkdtempSync(join(tmpdir(), "font-zh-")), "characters.txt")
const output = fileURLToPath(new URL("../public/fonts/NotoSansSC-subset.woff2", import.meta.url))

writeFileSync(textFile, characters)

const result = spawnSync(
  "pyftsubset",
  [
    source,
    `--text-file=${textFile}`,
    "--flavor=woff2",
    "--layout-features=*",
    `--output-file=${output}`,
  ],
  { stdio: "inherit" },
)

if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`${characters.length} characters into ${output}`)
