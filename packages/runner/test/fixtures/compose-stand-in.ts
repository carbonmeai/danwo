/**
 * Stands in for `docker compose` in `startApp`'s tests. `up` starts a server on `PORT` outside
 * the caller's process group, as the Docker daemon runs a container, with the caller's output
 * still open in it; waits until it answers; says so and exits 0, as `up --wait` does. `down`
 * stops that server. `hang` starts it too, but says it is waiting and never returns, as
 * `up --wait` does on a container that never turns healthy. The server's pid is kept in `STAND_IN_PID_FILE`.
 */
import { spawn } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"

const pidFile = process.env.STAND_IN_PID_FILE ?? ""
const port = Number(process.env.PORT)
const SERVER = `require("node:http").createServer((_, r) => r.end("up")).listen(${port}, "127.0.0.1")`

async function answers(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`)

    return true
  } catch {
    return false
  }
}

/** Starts the server outside this process group, keeping its pid. */
function start(): void {
  console.log("Container web Creating")

  const server = spawn(process.execPath, ["-e", SERVER], {
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  })

  writeFileSync(pidFile, String(server.pid))
  server.unref()
  console.log("Container web Waiting")
}

async function up(): Promise<void> {
  start()
  while (!(await answers())) await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Container web Healthy")
}

function down(): void {
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL")
  } catch {
    /* Not running. */
  }

  rmSync(pidFile, { force: true })
  console.log("Container web Removed")
}

const mode = process.argv[2]

if (mode === "up") await up()
else if (mode === "down") down()
else {
  start()
  setInterval(() => undefined, 60_000)
}
