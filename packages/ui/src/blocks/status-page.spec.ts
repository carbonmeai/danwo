// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

const invalidate = vi.fn(async () => undefined)

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) =>
    createElement("a", { href: to }, children),
  useRouter: () => ({ invalidate }),
}))

const { ErrorPage, NotFoundPage } = await import("./status-page")

let host: HTMLDivElement

const mount = async (element: ReturnType<typeof createElement>) => {
  host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => root.render(element))

  return root
}

afterEach(() => {
  host.remove()
  invalidate.mockClear()
})

it("shows a centred 404 with a way home by default", async () => {
  const root = await mount(createElement(NotFoundPage))
  const page = host.querySelector('[data-status-page="404"]')

  expect(page?.getAttribute("role")).toBe("alert")
  expect(page?.textContent).toContain("This page wandered off")
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/")
  expect(host.querySelector("a")?.textContent).toBe("Back to Home")
  await act(async () => root.unmount())
})

it("lets a page name what is missing and where to go back to", async () => {
  const root = await mount(
    createElement(NotFoundPage, {
      title: "Hub not found",
      back: { label: "Back to Hubs", to: "/knowledge" },
    }),
  )

  expect(host.textContent).toContain("Hub not found")
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/knowledge")
  await act(async () => root.unmount())
})

it("resets the boundary and reloads the route on Try again, with a way home", async () => {
  const reset = vi.fn()
  const root = await mount(createElement(ErrorPage, { error: new Error("boom"), reset }))

  expect(host.querySelector('[data-status-page="500"]')).not.toBeNull()
  const tryAgain = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  )

  await act(async () => tryAgain?.click())
  expect(reset).toHaveBeenCalledOnce()
  expect(invalidate).toHaveBeenCalledOnce()
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/")
  await act(async () => root.unmount())
})
