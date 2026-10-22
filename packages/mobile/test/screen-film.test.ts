import { type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"

import { describe, expect, it } from "vitest"

import { Adb, type Exec } from "../src/adb.ts"
import { filmScreen, type Spawn } from "../src/android/screen-film.ts"

/** A `screenrecord` process that exits once interrupted, and the adb commands sent around it. */
function recorder(pull: "works" | "fails" = "works") {
  const started: string[] = []
  const commands: string[] = []
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: () => true,
  })

  const spawn: Spawn = (_file, args) => {
    started.push(args.join(" "))

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the film uses exit events, the exit code and kill
    return child as unknown as ChildProcess
  }

  const exec: Exec = async (_file, args) => {
    const command = args.join(" ").replace(/^-s \S+ /, "")

    commands.push(command)

    if (command.startsWith("shell pkill")) {
      child.exitCode = 0
      child.emit("exit", 0)
    }

    if (command.startsWith("pull") && pull === "fails") throw new Error("adb: no such file")

    return ""
  }

  return { started, commands, adb: new Adb("/sdk/adb", "emulator-5554", exec), spawn }
}

describe("filming an Android screen", () => {
  it("records on the device, interrupts the recorder to finish the file, pulls it and cleans up", async () => {
    const { started, commands, adb, spawn } = recorder()
    const film = filmScreen(adb, "/run/video/screen.mp4", spawn)

    expect(started).toEqual([
      expect.stringMatching(
        /^-s emulator-5554 shell screenrecord --bit-rate 2000000 --time-limit 180 \/data\/local\/tmp\/danwo-film-\d+\.mp4$/,
      ),
    ])
    expect(await film.stop()).toBe(true)

    const remote = /\S+\.mp4$/.exec(started[0] ?? "")?.[0]

    expect(commands).toEqual([
      "shell pkill -INT screenrecord",
      `pull ${remote} /run/video/screen.mp4`,
      `shell rm -f ${remote}`,
    ])
  })

  it("reports no film when the file could not be pulled, and still removes it from the device", async () => {
    const { commands, adb, spawn } = recorder("fails")
    const film = filmScreen(adb, "/run/video/screen.mp4", spawn)

    expect(await film.stop()).toBe(false)
    expect(commands.at(-1)).toMatch(/^shell rm -f /)
  })
})
