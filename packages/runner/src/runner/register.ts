/*
 * Loaded into every danwo process with `--import`: Node 24 strips TypeScript types natively; this
 * adds the resolutions a TypeScript project expects on top: a `.js` specifier that names a `.ts`
 * file, an extensionless relative specifier, and, for the project's own files, the aliases its
 * `tsconfig.json` `paths` declare. It also loads a project's `.ts` files as ES modules when its
 * package.json says CommonJS. Each resolution is tried only after Node's own finds nothing.
 */
import { existsSync } from "node:fs"
import { registerHooks, type ResolveFnOutput } from "node:module"
import { fileURLToPath } from "node:url"

import { aliasedFile } from "./tsconfig-paths.ts"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return asModule(nextResolve(specifier, context))
    } catch (error) {
      const url =
        typeScriptCandidate(specifier, context.parentURL) ??
        aliasedFile(specifier, context.parentURL)

      if (url === undefined) {
        throw error
      }

      return asModule(nextResolve(url, context))
    }
  },
})

/**
 * danwo's config and tests are ES modules, but in a package with no `"type": "module"` (or the
 * `"type": "commonjs"` that `npm init` writes) Node loads a `.ts` file as CommonJS, and it fails on
 * its first `import`. The project's own `.ts` files load as modules instead; installed packages
 * keep the format their package says.
 */
function asModule(resolved: ResolveFnOutput): ResolveFnOutput {
  const installed = /[\\/]node_modules[\\/]/.test(resolved.url)

  return resolved.format === "commonjs-typescript" && !installed
    ? { ...resolved, format: "module-typescript" }
    : resolved
}

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
