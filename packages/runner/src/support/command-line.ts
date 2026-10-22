/**
 * Starting a program by name the way a terminal would, on every platform. On Windows `npm`, `npx`,
 * `pnpm` and `yarn` are `.cmd` scripts, which Node only starts through `cmd.exe`; and `cmd.exe`
 * reads one command line, not an argument list, so each argument is quoted for it (and for the
 * program's own argument parser) before they are joined.
 */

/** A program and its arguments, ready for `spawn(command, args, options)`. */
export interface SpawnPlan {
  readonly command: string
  readonly args: readonly string[]
  /** True on Windows: `args` go to `cmd.exe` as written, since they are quoted already. */
  readonly windowsVerbatimArguments: boolean
}

/** The characters `cmd.exe` treats specially, each escaped with a caret. */
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g

/**
 * `argument` quoted for a Windows program's argument parser (the C runtime's rules: backslashes
 * double only before a quote) and then for `cmd.exe`, whose special characters, the quotes
 * among them, take a caret so `cmd.exe` passes them through.
 */
export function quoteForCmd(argument: string): string {
  const quoted = `"${argument.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`

  return quoted.replaceAll(CMD_SPECIAL, "^$1")
}

/**
 * How to start `program` with `args` found on PATH as a terminal would. Elsewhere that is the
 * program itself; on Windows it is `cmd.exe /d /s /c "…"` with every part quoted, so a `.cmd`
 * script starts and no argument is split or read as a command separator.
 */
export function spawnPlan(
  program: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comspec: string | undefined = process.env.ComSpec,
): SpawnPlan {
  if (platform !== "win32") return { command: program, args, windowsVerbatimArguments: false }

  const line = [program.replaceAll(CMD_SPECIAL, "^$1"), ...args.map(quoteForCmd)].join(" ")

  return {
    command: comspec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  }
}
