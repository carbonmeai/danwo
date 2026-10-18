import { css } from "@danwo/ui/css"
import { DateTime } from "luxon"
import type * as React from "react"
import { type RefObject, useRef } from "react"
import { useOnClickOutside } from "usehooks-ts"

import { Calendar, type CalendarProps } from "../calendar"
import { Box } from "../layout"
import { Popover, PopoverContent, PopoverTrigger } from "../popover"
import type { PopoverContentProps } from "../popover/popover-content"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select"

type Props = {
  date?: Date
  setDate: (val?: Date) => void
  triggerChildren: React.ReactNode
  showPresets?: boolean
  disabled?: boolean
  open?: boolean
  onOpenChange?: (val: boolean) => void
  calendarProps?: Partial<CalendarProps> & { onSelect?: never }
  popoverContentProps?: PopoverContentProps
}

export const DatePicker = (props: Props) => {
  const {
    date,
    setDate,
    triggerChildren,
    showPresets,
    disabled,
    open: _open,
    onOpenChange,
    calendarProps,
    popoverContentProps,
  } = props

  const ref = useRef<HTMLDivElement>(null)

  useOnClickOutside(ref as RefObject<HTMLDivElement>, () => {
    onOpenChange?.(false)
  })

  const presetStyles = css({
    fontSize: "2",
    py: "1",
  })

  const toMonthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

  const handleSelect = (val?: Date) => {
    setDate(val)
    onOpenChange?.(false)
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {triggerChildren}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        columnGap="8px"
        display="flex"
        flexDir="column"
        p="8px"
        w="auto"
        {...popoverContentProps}
      >
        {showPresets && (
          <Select
            onValueChange={(value) =>
              setDate(
                DateTime.now()
                  .plus({ days: parseInt(value) })
                  .toJSDate(),
              )
            }
          >
            <SelectTrigger border="subtle" mb="3.5" size="xs">
              <SelectValue placeholder="Select" />
            </SelectTrigger>

            <SelectContent position="popper">
              <SelectItem className={presetStyles} value="0">
                Today
              </SelectItem>
              <SelectItem className={presetStyles} value="1">
                Tomorrow
              </SelectItem>
              <SelectItem className={presetStyles} value="3">
                In 3 days
              </SelectItem>
              <SelectItem className={presetStyles} value="7">
                In a week
              </SelectItem>
            </SelectContent>
          </Select>
        )}

        <Box rounded="xl">
          <Calendar
            defaultMonth={date ? toMonthStart(date) : undefined}
            {...calendarProps}
            mode="single"
            onSelect={handleSelect}
            selected={date}
          />
        </Box>
      </PopoverContent>
    </Popover>
  )
}
