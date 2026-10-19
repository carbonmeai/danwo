import { Icons } from "@danwo/ui/icons/base"
import { Button } from "@danwo/ui/primitives/button"
import { toast } from "@danwo/ui/primitives/toast/toast"
import { useState } from "react"

/**
 * Whether something was just copied, and a function that copies `text`, says so for two seconds
 * and raises a toast naming what was copied.
 */
export function useCopied(what = "Copied"): readonly [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast.success(what)
      setTimeout(() => setCopied(false), 2_000)
    })

  return [copied, copy]
}

/**
 * Copies the page's address: every run, test, step, trial and record section has one, so what is
 * on screen can be sent to someone as it is.
 */
export function CopyLink() {
  const [copied, copy] = useCopied("Link copied")

  return (
    <Button
      variant="ghost"
      size="sm"
      tooltipChildren="Copy a link to what is on screen"
      onClick={() => copy(window.location.href)}
    >
      {copied ? <Icons.copyCheck size={14} /> : <Icons.copyLink size={14} />}
      <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
    </Button>
  )
}
