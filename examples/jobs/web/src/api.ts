/** The page's calls to the API, each answer checked against what the page expects. */
import { z } from "zod"

const DigestSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  sendAt: z.string().nullable(),
  subscribers: z.number(),
  sent: z.number(),
  failed: z.number(),
})

const Subscriber = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.string().nullable(),
  attempts: z.number().nullable(),
  sentAt: z.string().nullable(),
  error: z.string().nullable(),
  ownerNotifiedAt: z.string().nullable(),
})

const Charge = z.object({
  batch: z.number(),
  quantity: z.number(),
  amountCents: z.number(),
  stripeItemId: z.string(),
})

const Activity = z.object({
  key: z.string(),
  job: z.string(),
  status: z.string(),
  detail: z.string(),
  attempt: z.number(),
  createdAt: z.string(),
})

const Digest = z.object({
  digest: z.object({
    id: z.string(),
    title: z.string(),
    intro: z.string(),
    ownerEmail: z.string(),
    status: z.string(),
    sendAt: z.string().nullable(),
  }),
  subscribers: z.array(Subscriber),
  charges: z.array(Charge),
  activity: z.array(Activity),
})

export type DigestSummary = z.infer<typeof DigestSummary>
export type Digest = z.infer<typeof Digest>

const Problem = z.object({ error: z.string() })

/** What went wrong with a call, in words a person can act on. */
export class ApiError extends Error {
  override readonly name = "ApiError"
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const body: unknown = await response.json().catch(() => undefined)

  if (!response.ok)
    throw new ApiError(Problem.safeParse(body).data?.error ?? "Something went wrong. Try again.")

  return body
}

export async function listDigests(): Promise<DigestSummary[]> {
  return z.array(DigestSummary).parse(await call("/api/digests"))
}

export async function getDigest(id: string): Promise<Digest> {
  return Digest.parse(await call(`/api/digests/${id}`))
}

export async function createDigest(digest: {
  readonly id: string
  readonly title: string
  readonly intro: string
  readonly ownerEmail: string
}): Promise<void> {
  await call("/api/digests", { method: "POST", body: JSON.stringify(digest) })
}

export async function addSubscriber(
  digestId: string,
  subscriber: { readonly id: string; readonly email: string; readonly name: string },
): Promise<void> {
  await call(`/api/digests/${digestId}/subscribers`, {
    method: "POST",
    body: JSON.stringify(subscriber),
  })
}

export async function scheduleDigest(digestId: string, sendAt: Date): Promise<void> {
  await call(`/api/digests/${digestId}/schedule`, {
    method: "POST",
    body: JSON.stringify({ sendAt: sendAt.toISOString() }),
  })
}
