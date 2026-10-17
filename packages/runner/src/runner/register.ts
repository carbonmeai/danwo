/*
 * Loaded into every danwo process with `--import`: Node 24 strips TypeScript types natively; this
 * adds the two resolutions a TypeScript project expects on top, a `.js` specifier that names a
 * `.ts` file and an extensionless relative specifier.
 */
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const url = typeScriptCandidate(specifier, context.parentURL)

      if (url === undefined) {
        throw error
      }

      return nextResolve(url, context)
    }
  },
})

/** The `.ts` file a relative `.js` or extensionless specifier means, if one exists. */
function typeScriptCandidate(specifier: string, parentURL: string | undefined): string | undefined {
  const relative = specifier.startsWith("./") || specifier.startsWith("../")

  if (!relative || parentURL === undefined) {
    return undefined
  }

  const candidates = specifier.endsWith(".js")
    ? [specifier.replace(/\.js$/, ".ts")]
    : /\.[cm]?[jt]s$/.test(specifier)
      ? []
      : [`${specifier}.ts`, `${specifier}/index.ts`]

  return candidates
    .map((candidate) => new URL(candidate, parentURL))
    .find((url) => existsSync(fileURLToPath(url)))?.href
}
