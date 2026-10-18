import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Span } from "../typography"

export const CommandShortcut = ({
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & JsxStyleProps) => {
  return (
    <Span
      alignItems="center"
      data-slot="command-shortcut"
      display="flex"
      fontSize="0.5"
      fontWeight="500"
      justifyContent="center"
      rounded="sm"
      {...props}
    />
  )
}
