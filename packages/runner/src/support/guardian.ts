/**
 * The guardian of one process's child groups. Its owner writes `+<pgid>` when it takes a group and
 * `-<pgid>` when it has stopped one; when the pipe closes, the owner is gone (however it ended), so
 * the guardian signals what is left with SIGTERM, then SIGKILL after the grace period, and exits.
 * It leads its own process group, so a signal to the owner's group does not reach it. On Windows
 * each id is the pid of a tree's root instead, and the guardian ends each tree with `taskkill`.
 */
import { signalTree, treeAlive } from "./process-tree.ts"

const graceMs = Number(process.argv[2] ?? 3_000)
const groups = new Set<number>()
let pending = ""
let reaping = false

const alive = (pgid: number): boolean => treeAlive(pgid)
const signal = (pgid: number, name: NodeJS.Signals): void => signalTree(pgid, name)

async function reap(): Promise<void> {
  if (reaping) return

  reaping = true
  for (const pgid of groups) signal(pgid, "SIGTERM")

  const deadline = Date.now() + graceMs

  while ([...groups].some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
  for (const pgid of groups) if (alive(pgid)) signal(pgid, "SIGKILL")
  process.exit(0)
}

for (const name of ["SIGINT", "SIGHUP"] as const) process.on(name, () => undefined)
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  pending += chunk

  const lines = pending.split("\n")

  pending = lines.pop() ?? ""

  for (const line of lines) {
    const pgid = Number(line.slice(1))

    if (!Number.isInteger(pgid) || pgid <= 0) continue
    if (line.startsWith("+")) groups.add(pgid)
    else groups.delete(pgid)
  }
})
process.stdin.on("close", () => void reap())
process.stdin.on("end", () => void reap())
