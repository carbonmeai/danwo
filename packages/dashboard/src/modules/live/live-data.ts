/**
 * Live runs on the server: the feeds under `.danwo/live`, which of them are still going, and
 * reading a feed from where the last read stopped. The runs write these files; the dashboard only
 * reads them.
 */
import { open, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

import type { LiveEvent, LiveRunStarted } from "@danwo/runner/runner"

import { danwoDir, entries } from "../../lib/project-files.ts"
import { foldLive, type LiveView, parseFeed } from "./live-values.ts"

/** How many of the newest feeds are looked at for runs still going. */
const RECENT = 6

/** A run id as the runner writes it; anything else is refused before it reaches the disk. */
const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/

export function isRunId(id: string): boolean {
  return RUN_ID.test(id)
}

function liveFolder(root: string): string {
  return join(danwoDir(root), "live")
}

/** The feed file of run `id`; throws for anything that is not a run id. */
export function feedPath(root: string, id: string): string {
  if (!isRunId(id)) throw new Error(`not a run id: ${id}`)

  return join(liveFolder(root), `${id}.jsonl`)
}

/** Whether process `pid` is still there. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/** Every event in run `id`'s feed so far; none when it has no feed. */
async function readFeed(root: string, id: string): Promise<LiveEvent[]> {
  return parseFeed(await readFile(feedPath(root, id), "utf8").catch(() => ""))
}

/** Run `id` as it stands, or undefined when it has no feed. */
export async function liveRun(root: string, id: string): Promise<LiveView | undefined> {
  const events = await readFeed(root, id)
  const first = events[0]

  return first?.type === "run" ? foldLive(events, isAlive(first.pid)) : undefined
}

/** A run still going, as the runs list shows it above the finished ones. */
export type ActiveRun = Pick<LiveRunStarted, "id" | "kind" | "title" | "at" | "planned">

/** The ids of the newest feeds, newest first. */
async function recentFeeds(root: string): Promise<string[]> {
  return (await entries(liveFolder(root)))
    .filter((name) => name.endsWith(".jsonl"))
    .toReversed()
    .slice(0, RECENT)
    .map((name) => name.slice(0, -".jsonl".length))
}

/** The runs still going, newest first: their feed has no last line and their process is alive. */
export async function activeRuns(root: string): Promise<ActiveRun[]> {
  const runs = await Promise.all((await recentFeeds(root)).map((id) => liveRun(root, id)))

  return runs.flatMap((run) =>
    run?.state === "running"
      ? [{ id: run.id, kind: run.kind, title: run.title, at: run.startedAt, planned: run.planned }]
      : [],
  )
}

/** The id of the run process `pid` is writing, once its feed exists. */
export async function feedOfProcess(root: string, pid: number): Promise<string | undefined> {
  const firsts = await Promise.all(
    (await recentFeeds(root)).map(async (id) => (await readFeed(root, id))[0]),
  )

  return firsts.find((first): first is LiveRunStarted => first?.type === "run" && first.pid === pid)
    ?.id
}

/**
 * The complete lines written to `path` after byte `from`, and where the next read starts. A line
 * still being written is left for the next read.
 */
export async function readFrom(
  path: string,
  from: number,
): Promise<{ readonly text: string; readonly next: number }> {
  const size = await stat(path).then(
    (info) => info.size,
    () => from,
  )

  if (size <= from) return { text: "", next: from }

  const file = await open(path, "r")

  try {
    const buffer = Buffer.alloc(size - from)

    await file.read(buffer, 0, buffer.length, from)

    const end = buffer.lastIndexOf(0x0a) + 1

    return { text: buffer.subarray(0, end).toString("utf8"), next: from + end }
  } finally {
    await file.close()
  }
}
