import type { DraggableSyntheticListeners, UniqueIdentifier } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { CSSProperties, PropsWithChildren } from "react"
import { createContext, useContext, useMemo } from "react"

import { Icons } from "../../icons/base"
import type { ButtonProps } from "../button"
import { Button } from "../button"
import { Box } from "../layout"

interface Props {
  id: UniqueIdentifier
  disabled?: boolean
}

interface Context {
  attributes: ReturnType<typeof useSortable>["attributes"]
  listeners: DraggableSyntheticListeners
  ref(node: HTMLElement | null): void
}

const SortableItemContext = createContext<Context | null>(null)

export function SortableItem({ children, id, disabled }: PropsWithChildren<Props>) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({
    disabled,
    id,
  })
  const context = useMemo(
    () => ({
      attributes,
      listeners,
      ref: setActivatorNodeRef,
    }),
    [attributes, listeners, setActivatorNodeRef],
  )
  const style: CSSProperties = {
    opacity: isDragging ? 0.4 : undefined,
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <SortableItemContext.Provider value={context}>
      <Box ref={setNodeRef} style={style}>
        {children}
      </Box>
    </SortableItemContext.Provider>
  )
}

export const DragHandle = (props: ButtonProps) => {
  const context = useContext(SortableItemContext)

  return (
    <Button
      cursor="grab"
      variant="transparent"
      {...props}
      {...context?.attributes}
      {...context?.listeners}
    >
      <Icons.gripVertical />
    </Button>
  )
}
