/** Files a step may upload, offered by name so a recording never holds a path. */

/** Files a step may upload, by the names the test gave them. */
export type Files = Readonly<Record<string, string>>

/** The paths of the files the step offers under `names`; throws for a name it does not offer. */
export function filePaths(files: Files, names: readonly string[]): string[] {
  return names.map((name) => {
    const path = files[name]

    if (path === undefined) {
      const offered = Object.keys(files)

      throw new Error(
        `no file named ${JSON.stringify(name)} is offered${offered.length > 0 ? `; offered: ${offered.join(", ")}` : ""}`,
      )
    }

    return path
  })
}
