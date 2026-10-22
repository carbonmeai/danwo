/**
 * Lets danwo run from an installed package. danwo ships TypeScript source, and Node strips types
 * natively except under `node_modules`; this load hook strips them there too. It is plain
 * JavaScript so it can load before any TypeScript does, and it only touches `.ts` and `.mts` files
 * inside `node_modules`: everything else loads as Node would load it.
 */
import { readFileSync } from "node:fs"
import * as nodeModule from "node:module"
import { fileURLToPath } from "node:url"

/**
 * Whether `version` (`process.versions.node`) is one danwo runs on: `^22.22.3 || >=24.11.1`, the
 * range every package's `engines` declares. Below it the hooks are missing, or a CommonJS package
 * that `require`s an ES module (mockttp does) fails to load once any hook is registered.
 */
function supported(version) {
  const [major, minor, patch] = version.split(".").map(Number)

  if (major === 22) return minor > 22 || (minor === 22 && patch >= 3)
  if (major === 24) return minor > 11 || (minor === 11 && patch >= 1)

  return major > 24
}

/* Say so up front instead of failing later on a missing export or a module that will not link. */
if (!supported(process.versions.node) || !("registerHooks" in nodeModule)) {
  process.stderr.write(
    `danwo needs Node.js 22.22.3 or a later 22, or 24.11.1 or newer; this is Node.js ${process.version}.\n`,
  )
  process.exit(1)
}

const { registerHooks, stripTypeScriptTypes } = nodeModule
const INSTALLED_TYPESCRIPT = /\/node_modules\/.+\.m?ts$/
const emitWarning = process.emitWarning.bind(process)
/** Experimental notices from APIs danwo itself uses: noise in every danwo process. */
const QUIET = ["stripTypeScriptTypes", "SQLite is an experimental feature"]

process.emitWarning = (warning, ...rest) => {
  if (QUIET.some((notice) => String(warning).includes(notice))) return

  emitWarning(warning, ...rest)
}

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !INSTALLED_TYPESCRIPT.test(url)) return nextLoad(url, context)

    const source = readFileSync(fileURLToPath(url), "utf8")

    return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true }
  },
})
