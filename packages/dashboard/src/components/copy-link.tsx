import { Icons } from "@danwo/ui/icons/base"
import { useState } from "react"

import { Button } from "./controls.tsx"

/**
 * Copies the page's address: every run, test, step, trial and record section has one, so what is
 * on screen can be sent to someone as it is.
 */
export function CopyLink() {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      look="ghost"
      h="7"
      px="2"
      title="Copy a link to what is on screen"
      onClick={() =>
        void navigator.clipboard.writeText(window.location.href).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2_000)
        })
      }
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copyLink size={14} />}
      <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
    </Button>
  )
}
