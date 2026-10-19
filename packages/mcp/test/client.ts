/** Connects an MCP client to a danwo server in memory, and reads tool results. */
import { fileURLToPath } from "node:url"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { type CallToolResult, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

import { workCopy } from "../../cli/test/work-copy.ts"
import { createDanwoServer, type DanwoServerOptions } from "../src/index.ts"

export const PANTRY = workCopy(fileURLToPath(new URL("./fixtures/pantry", import.meta.url)))

export async function connect(
  cwd: string,
  options: Omit<DanwoServerOptions, "cwd"> = {},
): Promise<Client> {
  const server = createDanwoServer({ cwd, ...options })
  const client = new Client({ name: "danwo-test", version: "0.0.0" })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

  await Promise.all([server.connect(serverSide), client.connect(clientSide)])

  return client
}

export function resultOf(result: unknown): CallToolResult {
  return CallToolResultSchema.parse(result)
}

/** A tool result's text parts, joined. */
export function textOf(result: unknown): string {
  return resultOf(result)
    .content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n")
}
