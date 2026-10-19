import { Icons } from "@danwo/ui/icons/base"
import { Button } from "@danwo/ui/primitives/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@danwo/ui/primitives/dropdown-menu"
import type { ReactNode } from "react"

/** One thing a row's menu can do: what it says, its icon, and what happens. */
export interface RowAction {
  readonly label: string
  readonly icon: ReactNode
  readonly onSelect: () => void
}

/** A row's other actions behind a ⋯ button: the library's dropdown menu. */
export function RowMenu({
  label,
  actions,
}: {
  /** What the menu is for, for screen readers: "Actions for …". */
  readonly label: string
  readonly actions: readonly RowAction[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} position="relative" zIndex="1">
          <Icons.ellipsis size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" minW="12rem">
        {actions.map((action) => (
          <DropdownMenuItem key={action.label} gap="2" onSelect={action.onSelect}>
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Copies an address made from `path` on this dashboard. */
export function copyAddress(path: string, copy: (text: string) => void): void {
  copy(new URL(path, window.location.origin).href)
}
