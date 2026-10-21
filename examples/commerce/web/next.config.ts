import type { NextConfig } from "next"

/** The example's own folder, one up from `web/`, where its node_modules live. */
const root = new URL("..", import.meta.url).pathname

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: root,
  turbopack: { root },
}

export default config
