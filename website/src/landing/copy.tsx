import { useState } from "react"

import { CheckIcon, CopyIcon } from "./glyphs.tsx"

/** Copies `text`, and says so for a moment. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return [copied, copy]
}

/** A shell command with a button that copies it. */
export function CopyBox({ command }: { readonly command: string }) {
  const [copied, copy] = useCopy()

  return (
    <div className="copybox">
      <span>
        <span className="pr">$ </span>
        {command}
      </span>
      <button type="button" aria-label="Copy command" onClick={() => copy(command)}>
        {copied ? (
          <span className="ok">
            <CheckIcon />
          </span>
        ) : (
          <CopyIcon />
        )}
      </button>
    </div>
  )
}
