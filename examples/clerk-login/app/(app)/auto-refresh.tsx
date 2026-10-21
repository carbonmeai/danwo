"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/** Asks the server for the page again every second, while something it shows is on its way. */
export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 1_000)

    return () => clearInterval(timer)
  }, [router])

  return null
}
