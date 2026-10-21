/**
 * Lets danwo run from an installed package. danwo ships TypeScript source, and Node strips types
 * natively except under `node_modules`; this load hook strips them there too. It is plain
 * JavaScript so it can load before any TypeScript does, and it only touches `.ts` and `.mts` files
 * inside `node_modules`: everything else loads as Node would load it.
 */
import { readFileSync } from "node:fs"
import * as nodeModule from "node:module"
import { fileURLToPath } from "node:url"

/* An older Node lacks the hooks below; say so instead of failing on a missing export. */
if (Number(process.versions.node.split(".")[0]) < 24 || !("registerHooks" in nodeModule)) {
  process.stderr.write(`danwo needs Node.js 24 or newer; this is Node.js ${process.version}.\n`)
  process.exit(1)
}

const { registerHooks, stripTypeScriptTypes } = nodeModule
const INSTALLED_TYPESCRIPT = /\/node_modules\/.+\.m?ts$/
const emitWarning = process.emitWarning.bind(process)

/* Node marks the stripping API experimental; that notice is noise in every danwo process. */
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes("stripTypeScriptTypes")) return

  emitWarning(warning, ...rest)
}

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !INSTALLED_TYPESCRIPT.test(url)) return nextLoad(url, context)

    const source = readFileSync(fileURLToPath(url), "utf8")

    return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true }
  },
})
