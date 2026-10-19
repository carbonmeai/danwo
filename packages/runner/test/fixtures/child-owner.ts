/**
 * Owns one child that starts a grandchild, prints `pids <child> <grandchild>` and waits: the
 * children test kills this process in different ways and checks nothing it started survives.
 */
import { spawnOwned } from "../../src/support/children.ts"
import { familyScript } from "./child-family.ts"

const { child } = spawnOwned(process.execPath, ["-e", familyScript()], {
  stdio: ["ignore", "pipe", "inherit"],
})

child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk))
setInterval(() => undefined, 1_000)
