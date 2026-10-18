// @vitest-environment happy-dom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { SidebarProvider, useSidebar } from "./sidebar-provider"

const viewport = vi.hoisted(() => ({ isMobile: true }))

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => viewport.isMobile,
}))

let root: Root
let mount: HTMLDivElement

function SidebarState() {
  const { state, toggleSidebar } = useSidebar()

  return createElement("button", { onClick: toggleSidebar, type: "button" }, state)
}

function ControlledRailSidebar() {
  const [open, setOpen] = useState(true)

  return createElement(
    SidebarProvider,
    { mobile: "rail", open, onOpenChange: setOpen },
    createElement(SidebarState),
  )
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  document.cookie = "sidebar_state=; path=/; max-age=0"
  mount = document.createElement("div")
  document.body.append(mount)
  root = createRoot(mount)
})

afterEach(async () => {
  await act(async () => root.unmount())
  mount.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it("keeps the controlled rail sidebar open when the viewport is narrow", async () => {
  await act(async () => root.render(createElement(ControlledRailSidebar)))

  expect(mount.textContent).toBe("expanded")
  expect(document.cookie).toBe("")
})

it("persists a user rail toggle", async () => {
  await act(async () => root.render(createElement(ControlledRailSidebar)))
  const toggle = mount.querySelector("button")

  await act(async () => toggle?.click())

  expect(mount.textContent).toBe("collapsed")
  expect(document.cookie).toContain("sidebar_state=false")
})
