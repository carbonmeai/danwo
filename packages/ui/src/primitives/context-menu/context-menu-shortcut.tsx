import { Span } from "../typography"

export const ContextMenuShortcut = ({ ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <Span
      data-slot="context-menu-shortcut"
      fontSize="1"
      letterSpacing="0.1rem"
      ml="auto"
      opacity="0.5"
      {...props}
    />
  )
}
