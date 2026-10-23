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

/** The setup command's button at the top of the home page. */
export const HERO_COPY_LABEL = "Copy the setup command, npx @danwo/cli init"

/** The same command's button in the closing call to action, named apart from the hero's. */
export const CLOSING_COPY_LABEL = "Copy npx @danwo/cli init, the closing call to action"

/**
 * A shell command with a button that copies it. `label` is the button's accessible name: it says
 * which command the button copies, and tells it apart from another box on the same page.
 */
export function CopyBox({ command, label }: { readonly command: string; readonly label: string }) {
  const [copied, copy] = useCopy()

  return (
    <div className="copybox">
      <span>
        <span className="pr">$ </span>
        {command}
      </span>
      <button type="button" aria-label={label} onClick={() => copy(command)}>
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
