/** What every tool shares: replying with text, failing as an error, and reporting progress. */
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js"

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>

export function text(lines: readonly string[] | string): CallToolResult {
  return {
    content: [{ type: "text", text: typeof lines === "string" ? lines : lines.join("\n") }],
  }
}

/** A tool failure the agent should read, not a protocol error. */
function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)

  return { content: [{ type: "text", text: message }], isError: true }
}

/** Runs a tool's work, turning a thrown error into a tool failure. */
export async function answer(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work()
  } catch (error) {
    return failure(error)
  }
}

/**
 * Sends each line as a progress notification when the caller asked for progress (gave a progress
 * token); otherwise drops it.
 */
export function progressOf(extra: Extra): (line: string) => void {
  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the MCP protocol's own field name
  const token = extra._meta?.progressToken
  let count = 0

  if (token === undefined) return () => {}

  return (line) => {
    count += 1
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: count, message: line },
      })
      .catch(() => {})
  }
}
