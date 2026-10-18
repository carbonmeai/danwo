// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { StarRating } from "./star-rating"

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

it("notifies once when a star is chosen and never on mount", async () => {
  const onValueChange = vi.fn()

  await act(async () =>
    root.render(
      createElement(StarRating, {
        value: "2",
        onValueChange,
        disabled: false,
      }),
    ),
  )

  expect(onValueChange).not.toHaveBeenCalled()
  await act(async () => mount.querySelectorAll<HTMLElement>('[role="radio"]')[3]!.click())
  expect(onValueChange).toHaveBeenCalledTimes(1)
  expect(onValueChange).toHaveBeenCalledWith("4")
})
