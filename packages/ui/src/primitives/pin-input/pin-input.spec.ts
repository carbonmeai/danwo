// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { PinInput } from "./pin-input"

let mount: HTMLDivElement
let root: Root

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

it("updates duplicate PIN characters across controlled value changes", async () => {
  await act(async () =>
    root.render(
      createElement(PinInput, {
        onChange: vi.fn(),
        value: "112233",
      }),
    ),
  )
  expect(mount.textContent).toContain("112233")

  await act(async () =>
    root.render(
      createElement(PinInput, {
        onChange: vi.fn(),
        value: "332211",
      }),
    ),
  )
  expect(mount.textContent).toContain("332211")
})
