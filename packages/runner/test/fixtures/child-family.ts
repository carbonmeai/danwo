/**
 * A script for `node -e`: it starts a grandchild that runs forever, prints
 * `pids <its own pid> <grandchild pid>` and then runs forever too.
 */
export function familyScript(): string {
  return [
    'const { spawn } = require("node:child_process")',
    'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })',
    "console.log(`pids ${process.pid} ${grandchild.pid}`)",
    "setInterval(() => {}, 1000)",
  ].join("\n")
}
