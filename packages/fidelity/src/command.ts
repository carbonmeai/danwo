/** `danwo fidelity`: checks the emulators against the real providers, or against the goldens. */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type ApiDescription, readDescription } from "./openapi.ts"
import { type FidelityProvider, fidelityEnvironment } from "./provider.ts"
import { providersNamed } from "./providers/index.ts"
import { fidelityPassed, formatFidelity, runFidelity } from "./run.ts"

export interface FidelityCommandOptions {
  /** Provider names; all of them when empty. */
  readonly providers: readonly string[]
  /** The repository root holding `fidelity/`. */
  readonly root: string
  readonly updateGolden?: boolean
  /** Goldens from API descriptions: a file for one provider, or each provider's published one. */
  readonly fromOpenapi?: string | true
  readonly offline?: boolean
  readonly write?: (line: string) => void
}

/**
 * A provider's published API description, downloaded once into a temporary folder. A provider that
 * publishes none has its documented answers written into its scenarios, which need no description.
 */
async function published(provider: FidelityProvider, folder: string): Promise<ApiDescription> {
  if (provider.openapi === undefined) return { paths: {} }

  const response = await fetch(provider.openapi)

  if (!response.ok)
    throw new Error(`could not download ${provider.name}'s API description: ${response.status}`)

  const file = join(
    folder,
    `${provider.name}${provider.openapi.endsWith(".json") ? ".json" : ".yaml"}`,
  )

  await writeFile(file, await response.text())

  return readDescription(file)
}

async function descriptionsFor(
  providers: readonly FidelityProvider[],
  from: string | true,
): Promise<Map<string, ApiDescription>> {
  if (from !== true) {
    if (providers.length !== 1)
      throw new Error("--from-openapi with a file needs exactly one provider")

    return new Map([[providers[0]?.name ?? "", await readDescription(from)]])
  }

  const folder = await mkdtemp(join(tmpdir(), "danwo-fidelity-"))

  try {
    const entries = await Promise.all(
      providers.map(async (p) => [p.name, await published(p, folder)] as const),
    )

    return new Map(entries)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/** Runs the check and prints its report; the exit code is 1 when any scenario differs. */
export async function fidelityCommand(options: FidelityCommandOptions): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const providers = providersNamed(options.providers)
  const descriptions =
    options.fromOpenapi === undefined
      ? undefined
      : await descriptionsFor(providers, options.fromOpenapi)
  const reports = await runFidelity({
    root: options.root,
    providers,
    env: fidelityEnvironment(options.root),
    ...(options.updateGolden !== undefined && { updateGolden: options.updateGolden }),
    ...(options.offline !== undefined && { offline: options.offline }),
    ...(descriptions !== undefined && { descriptions }),
  })

  for (const line of formatFidelity(reports)) write(line)

  return fidelityPassed(reports) ? 0 : 1
}
