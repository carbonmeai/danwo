/**
 * The danwo build of an Android app: a network security config that trusts user-installed CAs
 * (where danwo puts its per-run CA) and allows cleartext to the hosts tests route through the
 * proxy. A store build never gets it; only a build made for danwo does.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** The XML resource's name, as the manifest refers to it. */
export const NETWORK_CONFIG_NAME = "danwo_network_security_config"

/** Trust system and user CAs app-wide, and allow plain HTTP, for the danwo build only. */
export const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`

const ATTRIBUTE = "android:networkSecurityConfig"

/**
 * The manifest with its `<application>` pointing at danwo's network config. An existing
 * `networkSecurityConfig` is replaced; the rest of the manifest is left as it was.
 */
export function withNetworkConfig(manifest: string): string {
  const reference = `${ATTRIBUTE}="@xml/${NETWORK_CONFIG_NAME}"`
  const existing = new RegExp(`${ATTRIBUTE}="[^"]*"`)

  if (existing.test(manifest)) return manifest.replace(existing, reference)

  const opening = /<application\b/

  if (!opening.test(manifest)) throw new Error("AndroidManifest.xml has no <application> element")

  return manifest.replace(opening, `<application ${reference}`)
}

/**
 * Applies the danwo network config to a generated Android project (the `android/` folder that
 * `expo prebuild` writes): the XML resource, and the manifest pointing at it.
 */
export async function applyNetworkConfig(androidDir: string): Promise<void> {
  const main = join(androidDir, "app", "src", "main")
  const xmlDir = join(main, "res", "xml")
  const manifestPath = join(main, "AndroidManifest.xml")

  await mkdir(xmlDir, { recursive: true })
  await writeFile(join(xmlDir, `${NETWORK_CONFIG_NAME}.xml`), NETWORK_SECURITY_CONFIG)
  await writeFile(manifestPath, withNetworkConfig(await readFile(manifestPath, "utf8")))
}
