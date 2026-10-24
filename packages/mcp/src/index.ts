/**
 * danwo's MCP server, for coding agents: `serveStdio` speaks MCP over stdin and stdout, as
 * `danwo mcp` runs it; `createDanwoServer` builds the server for another transport.
 */
import { once } from "node:events"

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { stopAllJobs } from "./jobs/run.ts"
import { createDanwoServer, type DanwoServerOptions } from "./server.ts"

export { createDanwoServer, type DanwoServerOptions } from "./server.ts"
export {
  clientCommand,
  type InitChange,
  type InitOptions,
  initProject,
  initReport,
} from "@danwo/skill"
export { stopAllJobs } from "./jobs/run.ts"

/**
 * Serves the project over stdio until the client closes stdin. Stdout belongs to the protocol, so
 * nothing else may write to it; job processes keep their own output. Jobs still running when the
 * client leaves are stopped.
 */
export async function serveStdio(options: DanwoServerOptions): Promise<void> {
  const server = createDanwoServer(options)
  const ended = once(process.stdin, "end")

  await server.connect(new StdioServerTransport())
  await ended
  stopAllJobs()
  await server.close()
}
