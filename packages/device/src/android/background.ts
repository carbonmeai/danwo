/**
 * What an Android emulator calls on its own while a test runs: Chrome's sync, optimization hints,
 * safe browsing and component updates, and Google Play services' check-ins. None of it is the
 * app's traffic, so a device run blocks it at the proxy rather than passing it to the internet.
 */

/** Hosts a device run blocks; pass them as `startServices(services, { blocked })`. */
export const ANDROID_BACKGROUND_HOSTS: readonly string[] = [
  "accounts.google.com",
  "android.clients.google.com",
  "android.googleapis.com",
  "clients1.google.com",
  "clients2.google.com",
  "clients3.google.com",
  "clients4.google.com",
  "clients5.google.com",
  "clients6.google.com",
  "clientservices.googleapis.com",
  "connectivitycheck.gstatic.com",
  "content-autofill.googleapis.com",
  "optimizationguide-pa.googleapis.com",
  "play.googleapis.com",
  "safebrowsing.googleapis.com",
  "update.googleapis.com",
  "www.google.com",
  "*.gvt1.com",
  "*.gvt2.com",
  "mtalk.google.com",
]
