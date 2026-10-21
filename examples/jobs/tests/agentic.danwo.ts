/**
 * The agent writes and schedules a digest the way a person would, from a plain-English goal. The
 * test is paired with a check that needs no model: what the database holds afterwards. It skips
 * without a model key; once recorded, it replays with no model at all.
 */
import { test, tomorrowAtNine } from "./digests.ts"

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test(
  "the agent writes and schedules a digest",
  { skip },
  async ({ app, agent, sql, expect, time }) => {
    await app.open("/")
    await agent.act(
      "write a digest called {title} owned by {owner}, add {first} and {second} as subscribers, and schedule it for tomorrow at 9am",
      {
        params: {
          title: "Design review",
          owner: "editor@northwind.test",
          first: "ada@northwind.test",
          second: "grace@northwind.test",
        },
      },
    )
    await agent.assert("the digest is scheduled", { poll: true })

    /* The model-free half: whatever the agent clicked, the database holds this one digest. */
    const digests = await sql<{
      title: string
      status: string
      send_at: Date
      subscribers: number
    }>(
      `select d.title, d.status, d.send_at,
            (select count(*) from subscribers s where s.digest_id = d.id)::int as subscribers
       from digests d`,
    )

    expect(digests).toEqual([
      {
        title: "Design review",
        status: "scheduled",
        send_at: tomorrowAtNine(time.now()),
        subscribers: 2,
      },
    ])
  },
)
