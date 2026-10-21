import "./globals.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: { default: "Paper & Clay", template: "%s · Paper & Clay" },
  description: "Mugs, notebooks and prints, made in small batches.",
}

/** Every page reads live stock and carts, so none is rendered ahead of time. */
export const dynamic = "force-dynamic"

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  )
}
