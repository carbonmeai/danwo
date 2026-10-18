// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { SelectWithSearch } from "./select-with-search"

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

it("shows the label for a value changed by its parent", async () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ]
  const setValue = vi.fn()
  const render = (value: string) =>
    act(async () => root.render(createElement(SelectWithSearch, { options, value, setValue })))

  await render("a")
  expect(mount.querySelector('[role="combobox"]')?.textContent).toContain("Alpha")

  await render("b")
  expect(mount.querySelector('[role="combobox"]')?.textContent).toContain("Beta")
})

it("prefers a present controlled value over defaultValue, including empty", async () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ]
  const setValue = vi.fn()
  const render = (value: string) =>
    act(async () =>
      root.render(
        createElement(SelectWithSearch, {
          defaultValue: "a",
          options,
          value,
          setValue,
        }),
      ),
    )

  await render("a")
  expect(mount.querySelector('[role="combobox"]')?.textContent).toContain("Alpha")

  await render("b")
  expect(mount.querySelector('[role="combobox"]')?.textContent).toContain("Beta")

  await render("")
  expect(mount.querySelector('[role="combobox"]')?.textContent).toContain("Select")
  expect(mount.querySelector('[role="combobox"]')?.textContent).not.toContain("Alpha")
})
