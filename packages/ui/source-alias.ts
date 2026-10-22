import { fileURLToPath } from "node:url"

/**
 * Component imports such as `@danwo/ui/primitives/button` name folders and extensionless files, which package
 * exports can't resolve. Apps add this alias to Vite and Vitest so those imports read the package source; `css`,
 * `jsx`, `tokens` and `types` still resolve through the exports `panda lib` writes.
 */
export const uiSourceAlias = {
  find: /^@danwo\/ui\/(blocks|hooks|icons|illustrations|primitives|theme)(\/.*)?$/,
  /* Forward slashes throughout, as Vite's ids use them on Windows too. */
  replacement: `${fileURLToPath(new URL("./src/", import.meta.url)).replaceAll("\\", "/")}$1$2`,
}
