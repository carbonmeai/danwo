/**
 * Tiptap Cloud's fidelity suite, for a collaboration app's id and REST API secret: a document's
 * life over the REST API (create from JSON, read it back as JSON, delete it), and a document that
 * does not exist. Tiptap publishes no API description, so the schemas follow its REST API
 * reference; the error bodies are approximations until a live run settles them.
 */
import { seedTiptap, tiptap } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, Target } from "../scenario.ts"
import { anything, arrayOf, object, str } from "../schema.ts"
import { asJsonObject, isJsonArray, readJson } from "../shape.ts"
import { isTagged, type Leftover } from "../sweep.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const APP = "DANWO_FIDELITY_TIPTAP_APP_ID"
const SECRET = "DANWO_FIDELITY_TIPTAP_API_SECRET"
const EMULATED = { app: "danwo-fidelity", secret: "danwo-fidelity-secret" }

const DOC = object({ type: str, content: arrayOf(anything) })

function call(
  context: Pick<ScenarioContext, "target">,
  method: string,
  path: string,
  body?: unknown,
): Request {
  return new Request(
    `https://${credential(context.target, "app")}.collab.tiptap.cloud/api${path}`,
    {
      method,
      headers: {
        authorization: credential(context.target, "secret"),
        "content-type": "application/json",
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    },
  )
}

const documents: Scenario = {
  name: "documents: create, read as JSON, delete",
  async run(context) {
    const name = context.tag
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "checked" }] }],
    }

    context.created({
      kind: "document",
      id: name,
      undo: () => context.target.send(call(context, "DELETE", `/documents/${name}`)),
    })
    await context.step(
      "create a document from JSON",
      call(context, "POST", `/documents/${name}?format=json`, doc),
      {
        doc: { schema: { type: "null" }, status: 204 },
      },
    )
    await context.step("read it as JSON", call(context, "GET", `/documents/${name}?format=json`), {
      literals: ["type"],
      doc: { schema: DOC, status: 200, literals: { type: "doc" } },
    })
    await context.step("delete it", call(context, "DELETE", `/documents/${name}`), {
      doc: { schema: { type: "null" }, status: 204 },
    })
    await context.step(
      "read a document that is gone",
      call(context, "GET", `/documents/${name}?format=json`),
      {
        doc: { schema: anything, status: 404 },
      },
    )
  },
}

/** Documents earlier runs left: their names carry the fidelity tag. Each is deleted. */
async function sweepDocuments(target: Target): Promise<Leftover[]> {
  const context = { target }
  const answer = await target.send(call(context, "GET", "/documents"))
  const list = await readJson(answer)

  return (isJsonArray(list) ? list : []).flatMap((item) => {
    const name = asJsonObject(item)?.["name"]

    if (typeof name !== "string" || !isTagged(name)) return []

    return [
      {
        kind: "document",
        id: name,
        label: name,
        tagged: true,
        remove: () => target.send(call(context, "DELETE", `/documents/${name}`)),
      },
    ]
  })
}

export const tiptapFidelity: FidelityProvider = {
  name: "tiptap",
  credentials: [
    {
      name: APP,
      description: "a Tiptap Collaboration app's id (the part before .collab.tiptap.cloud)",
    },
    {
      name: SECRET,
      description: "the app's REST API secret; the suite creates and deletes one document",
    },
  ],
  scenarios: [documents],
  sweep: sweepDocuments,
  emulator: () =>
    emulatorTarget(tiptap, EMULATED, (emulator) =>
      seedTiptap(emulator, { apps: [{ id: EMULATED.app, apiKey: EMULATED.secret }] }),
    ),
  live(env) {
    const found = requiredCredentials(this, env)

    return found === undefined
      ? undefined
      : liveTarget({ app: found[APP] ?? "", secret: found[SECRET] ?? "" })
  },
}
