/**
 * What an iOS Simulator calls on its own while a test runs: Safari's safe browsing, search
 * suggestions and top-site icons, and Apple's own services. None of it is the app's traffic, so a
 * simulator run blocks it at the proxy rather than passing it to the internet.
 */

/** Hosts a simulator run blocks; pass them as `startServices(services, { blocked })`. */
export const IOS_BACKGROUND_HOSTS: readonly string[] = [
  "token.safebrowsing.apple",
  "safebrowsing.googleapis.com",
  "ssl.gstatic.com",
  "www.google.com",
  "www.yahoo.com",
  "*.apple.com",
  "*.icloud.com",
  "*.apple-cloudkit.com",
  "*.mzstatic.com",
  "*.cdn-apple.com",
]
