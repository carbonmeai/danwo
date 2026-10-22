// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The pages' server functions read the project on disk, which a skeleton never calls: each one
 * here is a stand-in that does nothing.
 */
const { serverStub } = vi.hoisted(() => ({
  serverStub: () =>
    new Proxy(
      {},
      { get: (_, key) => (key === "then" ? undefined : () => Promise.resolve(undefined)) },
    ),
}))

vi.mock(import("../layout/project-api.ts"), serverStub)
vi.mock(import("../overview/overview-api.ts"), serverStub)
vi.mock(import("../tests/tests-api.ts"), serverStub)
vi.mock(import("../runs/runs-api.ts"), serverStub)
vi.mock(import("../live/live-api.ts"), serverStub)
vi.mock(import("../insights/insights-api.ts"), serverStub)
vi.mock(import("../impact/impact-api.ts"), serverStub)
vi.mock(import("../settings/settings-api.ts"), serverStub)
vi.mock(import("../record/record-api.ts"), serverStub)
vi.mock(import("../overlay/feedback-api.ts"), serverStub)

/** Links stand in as plain anchors, so a skeleton renders without a router around it. */
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<object>()),
  Link: ({ children }: { readonly children?: ReactNode }) => createElement("a", {}, children),
}))

const { PageSkeleton } = await import("./components/page-skeleton.tsx")
const { OverviewSkeleton } = await import("../overview/overview-skeleton.tsx")
const { TestsSkeleton } = await import("../tests/tests-skeleton.tsx")
const { MatrixPageSkeleton } = await import("../tests/matrix-page.tsx")
const { RunsSkeleton } = await import("../runs/runs-skeleton.tsx")
const { RunSkeleton } = await import("../run/run-skeleton.tsx")
const { InsightsSkeleton } = await import("../insights/insights-skeleton.tsx")
const { ImpactSkeleton } = await import("../impact/impact-page.tsx")
const { SettingsSkeleton } = await import("../settings/settings-page.tsx")

let host: HTMLDivElement | undefined

async function mount(element: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  const at = document.createElement("div")

  host = at
  document.body.append(at)
  await act(async () => createRoot(at).render(element))

  return at
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
})

afterEach(() => {
  host?.remove()
})

/** What a page's skeleton must hold to stand in for the page. */
interface Shape {
  readonly name: string
  readonly element: ReturnType<typeof createElement>
  /** The busy region's name. */
  readonly busy: string
  /** The page's title, or nothing when it waits on the data too. */
  readonly title: string
  /** The tables the page shows, by their names. */
  readonly tables: readonly string[]
  /** The sections the page shows, by their names. */
  readonly sections?: readonly string[]
  /** How many summary cards head the page. */
  readonly cards?: number
}

const SHAPES: readonly Shape[] = [
  {
    name: "the overview",
    element: createElement(OverviewSkeleton, { range: 30 }),
    busy: "Loading the overview",
    title: "Overview",
    tables: [],
    sections: ["Runs per day", "Pass rate trend", "Run duration", "Worth a look"],
    cards: 4,
  },
  {
    name: "the tests",
    element: createElement(TestsSkeleton),
    busy: "Loading the tests",
    title: "Tests",
    tables: ["Tests"],
  },
  {
    name: "the runs",
    element: createElement(RunsSkeleton, { kind: undefined }),
    busy: "Loading the runs",
    title: "Runs",
    tables: ["Runs"],
  },
  {
    name: "a run",
    element: createElement(RunSkeleton, { runId: "unknown", view: "grid" }),
    busy: "Loading the run",
    title: "",
    tables: ["Tests in this run"],
    cards: 4,
  },
  {
    name: "the matrix",
    element: createElement(MatrixPageSkeleton),
    busy: "Loading the matrix",
    title: "Matrix",
    tables: ["Tests under the matrix"],
  },
  {
    name: "the insights",
    element: createElement(InsightsSkeleton, { sorting: { sort: "flake", ascending: false } }),
    busy: "Loading the insights",
    title: "Insights",
    tables: ["Tests"],
    sections: ["Flaky tests", "Every test"],
    cards: 4,
  },
  {
    name: "the impact index",
    element: createElement(ImpactSkeleton),
    busy: "Loading the impact index",
    title: "Impact",
    tables: [],
  },
  {
    name: "the settings",
    element: createElement(SettingsSkeleton),
    busy: "Loading the settings",
    title: "Settings",
    tables: [],
    sections: ["Project", "Keyboard"],
  },
  {
    name: "any other page",
    element: createElement(PageSkeleton),
    busy: "Loading the page",
    title: "",
    tables: [],
  },
]

describe("each page's loading skeleton", () => {
  for (const shape of SHAPES)
    it(`stands in for ${shape.name} in its shape`, async () => {
      const page = await mount(shape.element)
      const busy = page.querySelector('[role="region"][aria-busy="true"]')

      expect(busy?.getAttribute("aria-label")).toBe(shape.busy)
      expect(page.querySelector('nav[aria-label="Breadcrumb"]')).not.toBeNull()
      expect(busy?.querySelectorAll("h1")).toHaveLength(1)
      expect(busy?.querySelector("h1")?.textContent).toBe(shape.title)
      expect(
        [...(busy?.querySelectorAll("table") ?? [])].map((table) =>
          table.getAttribute("aria-label"),
        ),
      ).toEqual(shape.tables)
      for (const table of busy?.querySelectorAll("table") ?? [])
        expect(
          [...table.querySelectorAll<HTMLElement>("thead th")].filter((th) => !th.style.width),
        ).toHaveLength(1)
      for (const section of shape.sections ?? [])
        expect(busy?.querySelector(`[aria-label="${section}"]`)).not.toBeNull()
      expect(busy?.querySelectorAll("[data-card]")).toHaveLength(shape.cards ?? 0)
      expect(busy?.querySelectorAll("[data-inline-skeleton]").length ?? 0).toBeGreaterThan(0)
    })

  it("shows a matrix run as one once the runs list has named it", async () => {
    const { useKnownRuns } = await import("../run/known-runs.ts")
    const runs = [
      { id: "m1", kind: "matrix", title: "checkout › pays", counts: { failed: 0 } },
    ] as const

    const Lister = () => {
      useKnownRuns(runs)

      return null
    }

    await mount(createElement(Lister))
    const page = await mount(createElement(RunSkeleton, { runId: "m1", view: "grid" }))

    expect(page.querySelector("h1")?.textContent).toBe("checkout › pays")
    expect(page.querySelector('[aria-label="Invariant"]')).not.toBeNull()
    expect(page.querySelector('table[aria-label="Tests in this run"]')).toBeNull()
  })
})

describe("the dashboard's routes", () => {
  it("each bring a skeleton of their own", async () => {
    const routes = await Promise.all(
      [
        import("../../routes/index.tsx"),
        import("../../routes/tests.tsx"),
        import("../../routes/runs.index.tsx"),
        import("../../routes/runs.$runId.tsx"),
        import("../../routes/matrix.tsx"),
        import("../../routes/insights.tsx"),
        import("../../routes/impact.tsx"),
        import("../../routes/settings.tsx"),
        import("../../routes/records.$.tsx"),
      ].map(async (route) => (await route).Route.options.pendingComponent),
    )

    expect(routes.every((pending) => typeof pending === "function")).toBe(true)
    expect(new Set(routes).size).toBe(routes.length)
  })
})
