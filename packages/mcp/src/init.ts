/**
 * `danwo init`: registers danwo's MCP server with the coding agents a project uses (Claude Code's
 * `.mcp.json`, Cursor's `.cursor/mcp.json`, Codex's `.codex/config.toml`, and when asked VS Code's
 * `.vscode/mcp.json` for GitHub Copilot), merging into files that
 * exist and leaving their other servers alone, and installs danwo's skill for those agents, keeping
 * any copy the user edited. Optionally writes a starter `danwo.config.ts`. It asks nothing and
 * reports each file it created, updated or left as it was.
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { installSkill } from "@danwo/skill"
import { z } from "zod"

export interface InitOptions {
  /** The project folder. */
  readonly cwd: string
  /** The command that starts the server. Default `npx @danwo/cli mcp`. */
  readonly command?: readonly string[]
  /** Also write a starter `danwo.config.ts` when the project has no config. */
  readonly starterConfig?: boolean
  /** Install danwo's skill into `.claude/skills` and `.agents/skills` (default true). */
  readonly skill?: boolean
  /**
   * The client configs to register the server in: `.mcp.json`, `.cursor/mcp.json`,
   * `.codex/config.toml` and `.vscode/mcp.json`. Default the first three.
   */
  readonly clients?: readonly string[]
}

export interface InitChange {
  /** Relative to the project folder. */
  readonly file: string
  /** `kept`: a skill file the user edited, left as it is. */
  readonly outcome: "created" | "updated" | "unchanged" | "kept"
}

const SERVER = "danwo"
const CODEX_FILE = ".codex/config.toml"

/** A JSON client config: the key its servers sit under, and the entry it expects for one. */
interface JsonClient {
  readonly file: string
  readonly key: string
  readonly entry: (command: string | undefined, args: readonly string[]) => unknown
}

/** Claude Code and Cursor list servers under `mcpServers`; VS Code lists typed ones under `servers`. */
const JSON_CLIENTS: readonly JsonClient[] = [
  { file: ".mcp.json", key: "mcpServers", entry: (command, args) => ({ command, args }) },
  { file: ".cursor/mcp.json", key: "mcpServers", entry: (command, args) => ({ command, args }) },
  {
    file: ".vscode/mcp.json",
    key: "servers",
    entry: (command, args) => ({ type: "stdio", command, args }),
  },
]

/** The configs written when none are named: every client but VS Code's, which is asked for. */
const DEFAULT_CLIENTS = [".mcp.json", ".cursor/mcp.json", CODEX_FILE]
const CONFIG_FILE = "danwo.config.ts"

const STARTER_CONFIG = `import { defineConfig } from "@danwo/sdk"

export default defineConfig({
  testDir: "tests",
  // Where the app under test runs; an \`environment\` hook can start it, with emulators, instead.
  baseUrl: "http://localhost:3000",
})
`

const McpJson = z.looseObject({})
const Servers = z.record(z.string(), z.unknown()).optional()

async function read(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, "utf8") : undefined
}

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function outcomeOf(before: string | undefined, after: string): InitChange["outcome"] {
  if (before === undefined) return "created"

  return before === after ? "unchanged" : "updated"
}

/** A JSON client config with danwo's server entry set under the client's key, the rest as it was. */
function mergedJson(before: string | undefined, client: JsonClient, server: unknown): string {
  let parsed: z.infer<typeof McpJson>
  let servers: z.infer<typeof Servers>

  try {
    parsed = McpJson.parse(before === undefined ? {} : JSON.parse(before))
    servers = Servers.parse(parsed[client.key])
  } catch {
    throw new Error(`${client.file} is not a JSON object; fix it, then run danwo init again`)
  }

  /* Already registered as asked: leave the file exactly as it is. */
  if (before !== undefined && JSON.stringify(servers?.[SERVER]) === JSON.stringify(server))
    return before

  const merged = { ...parsed, [client.key]: { ...servers, [SERVER]: server } }

  return `${JSON.stringify(merged, null, 2)}\n`
}

/** Codex's TOML with danwo's `[mcp_servers.danwo]` table set, every other table as it was. */
function mergedToml(before: string | undefined, command: readonly string[]): string {
  const [program, ...args] = command
  const table = [
    `[mcp_servers.${SERVER}]`,
    `command = ${JSON.stringify(program)}`,
    `args = ${JSON.stringify(args)}`,
  ]
  const lines = (before ?? "").split("\n")
  const start = lines.findIndex((line) => line.trim() === `[mcp_servers.${SERVER}]`)

  if (start < 0) {
    const kept = (before ?? "").trimEnd()

    return `${kept === "" ? "" : `${kept}\n\n`}${table.join("\n")}\n`
  }

  const next = lines.findIndex((line, at) => at > start && line.trim().startsWith("["))
  const end = next < 0 ? lines.length : next
  const after = lines.slice(end)

  return [...lines.slice(0, start), ...table, ...(after.length > 0 ? ["", ...after] : [""])]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

async function apply(
  cwd: string,
  file: string,
  merge: (before: string | undefined) => string,
): Promise<InitChange> {
  const path = join(cwd, file)
  const before = await read(path)
  const after = merge(before)
  const outcome = outcomeOf(before, after)

  if (outcome !== "unchanged") await write(path, after)

  return { file, outcome }
}

export async function initProject(options: InitOptions): Promise<InitChange[]> {
  const command = options.command ?? ["npx", "@danwo/cli", "mcp"]
  const [program, ...args] = command
  const changes: InitChange[] = []
  const clients = new Set(options.clients ?? DEFAULT_CLIENTS)

  for (const client of JSON_CLIENTS.filter(({ file }) => clients.has(file)))
    changes.push(
      await apply(options.cwd, client.file, (before) =>
        mergedJson(before, client, client.entry(program, args)),
      ),
    )
  if (clients.has(CODEX_FILE))
    changes.push(await apply(options.cwd, CODEX_FILE, (before) => mergedToml(before, command)))

  if (options.starterConfig === true && !existsSync(join(options.cwd, CONFIG_FILE)))
    changes.push(await apply(options.cwd, CONFIG_FILE, () => STARTER_CONFIG))
  if (options.skill !== false) changes.push(...(await installSkill(options.cwd)))

  return changes
}

/** The report `danwo init` prints. */
export function initReport(changes: readonly InitChange[]): string {
  return changes
    .map((change) =>
      change.outcome === "kept"
        ? `kept      ${change.file} (edited here; danwo's version is in @danwo/skill)`
        : `${change.outcome.padEnd(9)} ${change.file}`,
    )
    .join("\n")
}
