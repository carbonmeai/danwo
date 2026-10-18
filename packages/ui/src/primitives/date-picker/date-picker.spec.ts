import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"

const calendar = vi.hoisted(() => ({ render: vi.fn(() => null) }))

vi.mock("../calendar", () => ({ Calendar: calendar.render }))
vi.mock("../popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
}))

import { DatePicker } from "./date-picker"

it("uses the selected month and leaves an unselected calendar uncontrolled", () => {
  const selected = new Date(2026, 4, 18)
  const trigger = createElement("button", null, "Choose date")

  renderToStaticMarkup(
    createElement(DatePicker, {
      date: undefined,
      setDate: vi.fn(),
      triggerChildren: trigger,
    }),
  )
  renderToStaticMarkup(
    createElement(DatePicker, {
      date: selected,
      setDate: vi.fn(),
      triggerChildren: trigger,
    }),
  )

  expect(calendar.render).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ defaultMonth: undefined, selected: undefined }),
    undefined,
  )
  expect(calendar.render).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      defaultMonth: new Date(2026, 4, 1),
      selected,
    }),
    undefined,
  )
})
