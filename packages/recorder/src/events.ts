/** What the page script reports while someone uses the app, checked as it arrives. */
import { z } from "zod"

const tagged = { tag: z.string().min(1) }

export const pageEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ...tagged }),
  z.object({ kind: z.literal("assert"), ...tagged }),
  z.object({
    kind: z.literal("fill"),
    ...tagged,
    secret: z.boolean(),
    value: z.string().optional(),
  }),
  z.object({ kind: z.literal("select"), ...tagged, label: z.string() }),
  z.object({ kind: z.literal("check"), ...tagged, checked: z.boolean() }),
  z.object({ kind: z.literal("press"), ...tagged, key: z.string() }),
  z.object({ kind: z.literal("note"), text: z.string() }),
  z.object({ kind: z.literal("stop") }),
])

export type PageEvent = z.infer<typeof pageEventSchema>

/** The page function the page script calls; the recorder exposes it on every page. */
export const BINDING = "__danwoRecord"

/** The attribute that names an element while the recorder describes it. */
export const TAG_ATTRIBUTE = "data-danwo-rec"
