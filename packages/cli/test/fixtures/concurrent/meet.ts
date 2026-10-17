import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

/** Marks `name` as arrived and waits until both tests have, while each holds its browser open. */
export async function meet(name: string): Promise<void> {
  const dir = process.env.DANWO_FIXTURE_STATE ?? "."

  writeFileSync(join(dir, `arrived-${name}`), "")

  for (let i = 0; i < 100; i++) {
    if (readdirSync(dir).filter((file) => file.startsWith("arrived-")).length >= 2) {
      return
    }

    await sleep(100)
  }

  throw new Error(`the other test never arrived (${name} waited in ${dir})`)
}
