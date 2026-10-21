"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/** Renders the page again every `ms` while it waits on something, such as a payment's webhook. */
export function AutoRefresh({ ms }: { readonly ms: number }) {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), ms)

    return () => clearInterval(timer)
  }, [ms, router])

  return null
}
