/** A plain person silhouette on grey, the shape of Clerk's default avatar. */
const AVATAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#e3e3e8"/><circle cx="32" cy="25" r="11" fill="#a8a8b3"/><path d="M12 58c2-12 10-18 20-18s18 6 20 18z" fill="#a8a8b3"/></svg>`

/** Google's "G", for the "Continue with Google" button. */
const GOOGLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2.1 5-4.4 6.6v5.5h7.1c4.2-3.9 6.5-9.6 6.5-16.1z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z"/><path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5A22 22 0 0 0 2 24c0 3.5.8 6.9 2.5 9.9z"/><path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/></svg>`

/**
 * `img.clerk.com`: the default avatar for any image path, and the logos of the social providers
 * the emulator signs in with, so Clerk's components show no broken images.
 */
export function clerkImage(path: string): Response {
  const svg = path.startsWith("/static/google.") ? GOOGLE : AVATAR

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  })
}
