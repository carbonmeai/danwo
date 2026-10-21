// @vitest-environment happy-dom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

import type { ColumnDef } from "./grid"

/** Every row in view: happy-dom lays nothing out, so the real virtualiser would render none. */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * estimateSize() })),
  }),
}))

const { DataGrid } = await import("./grid")

interface Step {
  readonly id: string
  readonly name: string
  readonly ms: number
}

const steps: Step[] = [
  { id: "a", name: "step 10", ms: 30 },
  { id: "b", name: "step 2", ms: 10 },
  { id: "c", name: "step 1", ms: 20 },
]

const columns: ColumnDef<Step>[] = [
  { accessorKey: "name", header: "Step" },
  {
    accessorKey: "ms",
    header: "Time",
    size: 80,
    cell: (context) => `${context.getValue<number>()} ms`,
  },
  { id: "note", header: "Note", enableSorting: false, cell: () => "-" },
]

let host: HTMLDivElement

const mount = async (element: ReturnType<typeof createElement>) => {
  host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => root.render(element))

  return root
}

/** The text of the first cell in each rendered row, top to bottom. */
const firstCells = () =>
  [...host.querySelectorAll('[role="cell"]:first-child')].map((cell) => cell.textContent)

const header = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="columnheader"]')].find((h) =>
    h.textContent?.startsWith(name),
  )

afterEach(() => host.remove())

it("renders each row's cells, sizes the columns that set a size, and starts from the given sort", async () => {
  const root = await mount(
    createElement(DataGrid<Step>, {
      data: steps,
      columns,
      getRowId: (step) => step.id,
      initialSorting: [{ id: "ms", desc: false }],
    }),
  )

  expect(firstCells()).toEqual(["step 2", "step 1", "step 10"])
  expect(host.textContent).toContain("10 ms")
  expect(header("Time")?.getAttribute("aria-sort")).toBe("ascending")
  expect(host.querySelector<HTMLElement>('[role="row"]')?.style.gridTemplateColumns).toBe(
    "minmax(0, 1fr) 80px minmax(0, 1fr)",
  )
  await act(async () => root.unmount())
})

it("sorts by a header click, reading numbers inside text as numbers, and leaves unsortable headers off", async () => {
  const root = await mount(createElement(DataGrid<Step>, { data: steps, columns }))

  await act(async () => header("Step")?.click())
  expect(header("Step")?.textContent).toBe("Step ↑")
  expect(firstCells()).toEqual(["step 1", "step 2", "step 10"])

  await act(async () => header("Step")?.click())
  expect(header("Step")?.getAttribute("aria-sort")).toBe("descending")
  expect(firstCells()).toEqual(["step 10", "step 2", "step 1"])

  expect(header("Note")?.disabled).toBe(true)
  await act(async () => root.unmount())
})

it("hands a clicked row's data to onRowClick, and shows the empty state when there are no rows", async () => {
  const onRowClick = vi.fn()
  const root = await mount(createElement(DataGrid<Step>, { data: steps, columns, onRowClick }))

  await act(async () => host.querySelectorAll<HTMLElement>('[role="row"]')[1]?.click())
  expect(onRowClick).toHaveBeenCalledWith(steps[0])

  await act(async () =>
    root.render(createElement(DataGrid<Step>, { data: [], columns, empty: "No steps yet" })),
  )
  expect(host.textContent).toContain("No steps yet")
  await act(async () => root.unmount())
})
