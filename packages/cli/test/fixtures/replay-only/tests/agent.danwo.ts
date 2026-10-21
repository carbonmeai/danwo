import { test } from "@danwo/sdk"

test("opens the worker's page", async ({ app, agent }) => {
  await app.open("/")
  await agent.act("click the heading")
})
