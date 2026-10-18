// @vitest-environment happy-dom
import { act, createElement } from "react"
import { CalendarDay, DateLib, TZDate } from "react-day-picker"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { CalendarDayButton } from "./calendar"

let root: Root
let mount: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mount = document.createElement("div")
  document.body.append(mount)
  root = createRoot(mount)
})

afterEach(async () => {
  await act(async () => root.unmount())
  mount.remove()
  vi.unstubAllGlobals()
})

it("uses the calendar-local ISO day identity near a UTC boundary", async () => {
  const timeZone = "Pacific/Kiritimati"
  const date = new TZDate(2026, 0, 1, 0, 30, timeZone)
  const day = new CalendarDay(date, new TZDate(2026, 0, 1, timeZone), new DateLib({ timeZone }))

  expect(new Date(date.getTime()).toISOString().slice(0, 10)).toBe("2025-12-31")
  expect(day.isoDate).toBe("2026-01-01")

  await act(async () =>
    root.render(
      createElement(CalendarDayButton, {
        children: "1",
        day,
        modifiers: {},
      }),
    ),
  )

  expect(mount.querySelector("button")?.dataset.day).toBe("2026-01-01")
})
