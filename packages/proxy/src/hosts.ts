/**
 * Which hosts a run may always reach, which it never should, and which calls are the app's own
 * page loading rather than calls it makes: the decisions the proxy takes before any route.
 */

/** True when `host` matches an exact hostname or a `*.domain` wildcard. */
export function hostMatches(pattern: string, host: string): boolean {
  return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern
}

/** True when `host` is this machine: the apps a run starts, and services such as Inngest dev. */
export function isLoopback(host: string): boolean {
  const bare = host.startsWith("[") ? host.slice(1, -1) : host

  return (
    bare === "localhost" ||
    bare.endsWith(".localhost") ||
    bare === "::1" ||
    bare === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(bare)
  )
}

/**
 * Analytics, error reporting and telemetry endpoints. A run blocks them by default
 * (`telemetry: "block"`): what a test does there is noise in the flight record and real data
 * leaving the machine, and none of it decides whether the app works.
 */
export const TELEMETRY_HOSTS: readonly string[] = [
  /* Product analytics */
  "*.posthog.com",
  "posthog.com",
  "api.segment.io",
  "cdn.segment.com",
  "api.amplitude.com",
  "api2.amplitude.com",
  "*.amplitude.com",
  "api.mixpanel.com",
  "api-js.mixpanel.com",
  "*.heap.io",
  "heapanalytics.com",
  "*.fullstory.com",
  "*.hotjar.com",
  "*.clarity.ms",
  "*.intercom.io",
  "plausible.io",
  /* Error reporting */
  "*.sentry.io",
  "*.ingest.sentry.io",
  "*.ingest.us.sentry.io",
  "*.ingest.de.sentry.io",
  "*.bugsnag.com",
  "*.rollbar.com",
  "*.logrocket.io",
  "*.lr-ingest.io",
  /* Metrics, traces and logs */
  "*.datadoghq.com",
  "*.datadoghq.eu",
  "*.browser-intake-datadoghq.com",
  "*.grafana.net",
  "*.honeycomb.io",
  "*.newrelic.com",
  "*.nr-data.net",
  "*.axiom.co",
  "*.betterstack.com",
  "*.logtail.com",
  /* Google tags */
  "www.google-analytics.com",
  "region1.google-analytics.com",
  "*.google-analytics.com",
  "www.googletagmanager.com",
  "stats.g.doubleclick.net",
  /* Vercel */
  "vitals.vercel-insights.com",
]

/**
 * Paths a dev server (Vite, Next, TanStack Start, Remix) serves the browser while it loads the
 * page: modules, its own client, hot reload. They are the page loading, not calls the app makes.
 */
const DEV_PATH =
  /^\/(?:@vite\/|@fs\/|@id\/|@react-refresh|node_modules\/\.vite\/|__vite_ping|_next\/static\/|_next\/webpack-hmr|__nextjs|_build\/|__manifest|\.well-known\/appspecific\/)/

/** Source files a dev server compiles on request, as the browser imports them. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|scss|sass|less)$/i

/** Query markers a dev server adds to module requests (`?v=hash`, `?import`, `?t=timestamp`). */
const MODULE_QUERY =
  /(?:^|&)(?:v=[\w.-]+|import|t=\d+|html-proxy|direct|raw|url|worker_file)(?:&|$)/

/** Static files a browser fetches for a page: styles, scripts, images, fonts. */
const ASSET =
  /(?:\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)|\/favicon[^/]*)$/i

/**
 * True when a request is the page loading (a static file, a dev server's module or hot reload)
 * rather than a call the app makes: readiness, effects and the matrix leave these out.
 */
export function isPageAsset(path: string): boolean {
  const [pathname = "", query = ""] = path.split("?", 2)

  return (
    ASSET.test(pathname) ||
    DEV_PATH.test(pathname) ||
    (MODULE_QUERY.test(query) && SOURCE_FILE.test(pathname)) ||
    (pathname.startsWith("/src/") && SOURCE_FILE.test(pathname))
  )
}

/**
 * Content types of responses that stream for as long as the client listens (server-sent events,
 * newline-delimited JSON feeds): they never finish, so readiness does not wait on them.
 */
const STREAMING_TYPE =
  /^(?:text\/event-stream|application\/(?:x-)?ndjson|application\/stream\+json|application\/jsonl|multipart\/x-mixed-replace)\b/i

/** True when a response with these headers is a stream that stays open, not an answer that ends. */
export function isStreaming(contentType: string | string[] | undefined): boolean {
  const type = Array.isArray(contentType) ? contentType[0] : contentType

  return type !== undefined && STREAMING_TYPE.test(type.trim())
}
