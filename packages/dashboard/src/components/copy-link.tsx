import { Icons } from "@danwo/ui/icons/base"
import { useState } from "react"

import { Button } from "./controls.tsx"

/** Whether something was just copied, and a function that copies `text` and says so for two seconds. */
export function useCopied(): readonly [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    })

  return [copied, copy]
}

/**
 * Copies the page's address: every run, test, step, trial and record section has one, so what is
 * on screen can be sent to someone as it is.
 */
export function CopyLink() {
  const [copied, copy] = useCopied()

  return (
    <Button
      type="button"
      look="ghost"
      h="7"
      px="2"
      title="Copy a link to what is on screen"
      onClick={() => copy(window.location.href)}
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copyLink size={14} />}
      <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
    </Button>
  )
}
