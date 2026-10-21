import "./globals.css"
import { ClerkProvider } from "@clerk/nextjs"
import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Lumen",
  description: "Sign in to Lumen.",
}

/** Clerk's components in the kit's colours: its ink for buttons, its radius and type. */
const APPEARANCE = {
  variables: {
    colorPrimary: "#0a1217",
    colorDanger: "#c40006",
    colorSuccess: "#18794e",
    borderRadius: "0.5rem",
    fontFamily:
      'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    fontSize: "0.875rem",
  },
  /* Ask for a first and last name on sign-up too: Lumen greets people by name. */
  options: { showOptionalFields: true },
}

/**
 * Clerk around every page. The publishable key is read when the server starts, not baked into the
 * build, so one build runs against any Clerk instance. Clerk's pages and where it sends people
 * after signing in, up and out are this app's own.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <ClerkProvider
      dynamic
      publishableKey={process.env.CLERK_PUBLISHABLE_KEY}
      appearance={APPEARANCE}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/sign-in"
    >
      {/* The kit follows the system theme; Clerk's components are light, so the app is too. */}
      <html lang="en" data-theme="light">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
