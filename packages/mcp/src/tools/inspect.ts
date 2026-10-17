/** `inspect_page`: the app's page as danwo's agent reads it, and trying a locator on it. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { PageInspection } from "../jobs/protocol.ts"
import { runJob } from "../jobs/run.ts"
import type { Project } from "../project.ts"
import { answer, progressOf, text } from "../reply.ts"

const locatorSchema = z.object({
  by: z.enum(["role", "text", "label", "placeholder", "testId", "altText", "title"]),
  value: z.string().describe("the role for `role`, else the text, label, test id…"),
  name: z
    .string()
    .optional()
    .describe("for `role`: the accessible name (a substring unless exact)"),
  exact: z.boolean().optional(),
})

function locatorLines(locator: NonNullable<PageInspection["locator"]>): string[] {
  const verdict =
    locator.count === 1
      ? "matches 1 element"
      : `matches ${locator.count} elements${locator.count === 0 ? "" : " (a locator that clicks or fills must match exactly one)"}`

  return [
    `${locator.code} ${verdict}`,
    ...locator.matches.map(
      (match, index) =>
        `  [${index}] ${match.visible ? "visible" : "hidden"}: ${match.snapshot.replace(/\n/g, " ")}`,
    ),
  ]
}

function inspectionLines(page: PageInspection): string[] {
  return [
    `url: ${page.url}`,
    `title: ${page.title}`,
    ...(page.locator ? ["", ...locatorLines(page.locator)] : []),
    "",
    "accessibility tree (what getByRole/getByText/getByLabel match):",
    page.tree,
  ]
}

export function registerInspectTool(server: McpServer, project: Project): void {
  server.registerTool(
    "inspect_page",
    {
      description:
        "Open a page of the app under test in danwo's browser, through the project's environment (its app, emulators and proxy), and return its accessibility tree, the view danwo's agent works from, to write locators against. Optionally try a screen.getBy* locator and see what it matches. Secrets are redacted.",
      inputSchema: {
        path: z.string().optional().describe('a path of the app, default "/"'),
        locator: locatorSchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) =>
      answer(async () => {
        const page = await runJob(
          project.place,
          { kind: "inspect", path: args.path ?? "/", locator: args.locator },
          { onLine: progressOf(extra), signal: extra.signal },
        )

        return text(inspectionLines(page))
      }),
  )
}
