// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import { TagInput } from "./tag-input"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

it("adds tags on comma and Enter without the deprecated delimiters prop", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)

  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

  const setValue = vi.fn()

  const container = document.createElement("div")

  document.body.append(container)

  const root = createRoot(container)

  await act(async () => root.render(createElement(TagInput, { value: [], setValue })))

  const input = container.querySelector("input")!

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!

    setter.call(input, "example.com")

    input.dispatchEvent(new Event("input", { bubbles: true }))
  })

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ",", keyCode: 188, bubbles: true }))
  })

  expect(setValue).toHaveBeenCalledWith(["example.com"])

  expect(warn.mock.calls.some((call) => String(call[0]).includes("delimiters"))).toBe(false)

  await act(async () => root.unmount())
})
