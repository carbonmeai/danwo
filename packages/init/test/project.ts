/** Throwaway projects for init's tests: a temp folder holding the given files. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach } from "vitest"

const made: string[] = []

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A project folder with `files` (path → text; objects are written as JSON). */
export async function project(
  files: Readonly<Record<string, string | object>> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "danwo-init-test-"))

  made.push(root)

  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(
      join(root, file),
      typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    )
  }

  return root
}

/** A Next.js app's package.json, with more dependencies when given. */
export function nextApp(dependencies: Readonly<Record<string, string>> = {}): object {
  return {
    name: "shop",
    scripts: { dev: "next dev", build: "next build" },
    dependencies: { next: "15.0.0", react: "19.0.0", ...dependencies },
  }
}
