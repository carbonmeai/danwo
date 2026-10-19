import { test as base, z } from "@danwo/sdk"

const test = base.extend<{
  readonly apps: Readonly<Record<string, string>>
  readonly settle: () => Promise<void>
}>()

const Provisioned = z.array(z.string())

test("adds a task across the frontend, the API and the worker", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByText("event: hello")).toBeVisible()
  await expect(screen.getByText("live: pong")).toBeVisible()
  await screen.getByRole("button", { name: "Add task" }).click()
  await expect(screen.getByRole("status")).toHaveText("Task saved")
}).invariant(async ({ apps, settle, expect }) => {
  /* Once the background run the task's event triggered is done, the worker has provisioned it. */
  await settle()

  const provisioned = Provisioned.parse(await (await fetch(`${apps.worker}/provisioned`)).json())

  expect(provisioned).toEqual(["Write the report"])
})
