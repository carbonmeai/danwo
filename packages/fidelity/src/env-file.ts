/** Writing one value into `.env.fidelity` without disturbing the rest of the file. */
import { chmod, readFile, writeFile } from "node:fs/promises"

import { parseEnvLine } from "./provider.ts"

/** Quotes a value only when dotenv would otherwise read it differently. */
function envValue(value: string): string {
  return /[\s#"']/.test(value) ? JSON.stringify(value) : value
}

/**
 * The file's text with `name` set to `value`: an existing line for it is replaced where it stands,
 * otherwise one is added at the end. Every other line, comments included, is kept as written.
 */
export function withEnvValue(text: string, name: string, value: string): string {
  const line = `${name}=${envValue(value)}`
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n")
  const at = lines.findIndex((existing) => parseEnvLine(existing)?.[0] === name)

  if (at === -1) lines.push(line)
  else lines[at] = line

  return `${lines.join("\n")}\n`
}

/** Sets `name` in the env file at `path`, creating it if needed; the file is left readable by its owner only. */
export async function writeEnvValue(path: string, name: string, value: string): Promise<void> {
  let text = ""

  try {
    text = await readFile(path, "utf8")
  } catch {
    /* No file yet: it is created. */
  }

  await writeFile(path, withEnvValue(text, name, value), { mode: 0o600 })
  await chmod(path, 0o600)
}
