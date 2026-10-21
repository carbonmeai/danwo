/**
 * Copies the kit into the examples, so each one carries its own and works outside the repository.
 *
 * Usage: `node examples/_kit/sync.ts [example …]`
 *
 * Every example that already has a `kit/` folder gets a fresh copy of the kit's files; an example
 * named on the command line gets one too, which is how a new example starts using the kit. A
 * unit test fails when a copy has drifted from the kit, so edit the kit here and run this.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The `examples/` folder. */
export const EXAMPLES_DIR = fileURLToPath(new URL("..", import.meta.url))

/** This folder: the kit as it is edited. */
export const KIT_DIR = fileURLToPath(new URL(".", import.meta.url))

/** The files an example's copy holds: the plain-CSS kit and its Tailwind theme. */
export const KIT_FILES: readonly string[] = ["kit.css", "tailwind.css"]

/** The folder inside an example that holds its copy. */
export const COPY_FOLDER = "kit"

/** The examples whose folder holds a copy of the kit, sorted. */
export function kitTargets(root = EXAMPLES_DIR): string[] {
  return readdirSync(root)
    .filter((name) => !name.startsWith(".") && !name.startsWith("_"))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .filter((name) => existsSync(join(root, name, COPY_FOLDER)))
    .toSorted()
}

/** A copy that does not match the kit: the example, the file, and how. */
export interface Drift {
  readonly example: string
  readonly file: string
  readonly problem: "missing" | "different" | "extra"
}

/** Every way an example's copy differs from the kit, in `root`. */
export function drift(root = EXAMPLES_DIR, kit = KIT_DIR): Drift[] {
  return kitTargets(root).flatMap((example) => {
    const copy = join(root, example, COPY_FOLDER)
    const kept = KIT_FILES.flatMap((file): Drift[] => {
      if (!existsSync(join(copy, file))) return [{ example, file, problem: "missing" }]

      return readFileSync(join(copy, file), "utf8") === readFileSync(join(kit, file), "utf8")
        ? []
        : [{ example, file, problem: "different" }]
    })
    const extra = readdirSync(copy)
      .filter((file) => !KIT_FILES.includes(file))
      .map((file): Drift => ({ example, file, problem: "extra" }))

    return [...kept, ...extra]
  })
}

/** Writes the kit into each example of `examples` (and every one that has a copy); what it wrote. */
export function sync(
  examples: readonly string[] = [],
  root = EXAMPLES_DIR,
  kit = KIT_DIR,
): string[] {
  const targets = [...new Set([...kitTargets(root), ...examples])].toSorted()

  return targets.flatMap((example) => {
    if (!existsSync(join(root, example, "package.json")))
      throw new Error(`examples/${example} is not an example: it has no package.json`)

    const copy = join(root, example, COPY_FOLDER)

    mkdirSync(copy, { recursive: true })

    return KIT_FILES.map((file) => {
      writeFileSync(join(copy, file), readFileSync(join(kit, file)))

      return `examples/${example}/${COPY_FOLDER}/${file}`
    })
  })
}

if (import.meta.main) {
  for (const path of sync(process.argv.slice(2))) console.log(`wrote ${path}`)
}
