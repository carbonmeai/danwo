/**
 * Integrations: connecting a workspace to Slack and to Google Calendar through each one's OAuth
 * consent page, keeping the tokens per workspace, and what each is used for here (the Slack
 * channel notes are posted to; the calendar's next events, and a review meeting for a note).
 */
import { and, eq } from "drizzle-orm"
import { CodeChallengeMethod } from "google-auth-library"
import { Hono } from "hono"
import { z } from "zod"

import { query } from "../shared/db/client.ts"
import { integrations, notes } from "../shared/db/schema.ts"
import { describe } from "../shared/retry.ts"
import { SLACK_SCOPES, slackClient, slackError } from "../shared/slack.ts"
import { calendarOf, GOOGLE_SCOPES, googleClient, idOfReview } from "./google.ts"
import { openState, sealState } from "./oauth-state.ts"
import { HttpError } from "./problems.ts"
import { adminOf, membershipOf, type SignedIn, signedIn } from "./session.ts"
import { settings } from "./settings.ts"
import { WorkspaceId } from "./workspaces.ts"

const SLACK_REDIRECT = `${settings.WEB_URL}/integrations/slack/callback`
const GOOGLE_REDIRECT = `${settings.WEB_URL}/integrations/google/callback`

const Callback = z.object({ code: z.string().min(1), state: z.string().min(1) })

/** The workspace's connection to `provider`, or 404. */
async function connectionOf(workspaceId: string, provider: "slack" | "google") {
  const [row] = await query(`read ${provider} integration`, (db) =>
    db
      .select()
      .from(integrations)
      .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider))),
  )

  if (!row) throw new HttpError(404, `Connect ${provider === "slack" ? "Slack" : "Google"} first.`)

  return row
}

/** Saves a fresh connection, replacing any earlier one for the same provider. */
async function saveConnection(row: typeof integrations.$inferInsert): Promise<void> {
  await query("save integration", (db) =>
    db
      .insert(integrations)
      .values(row)
      .onConflictDoUpdate({
        target: [integrations.workspaceId, integrations.provider],
        set: { ...row, connectedAt: new Date() },
      }),
  )
}

/** A Slack failure as the page shows it. */
function slackProblem(error: unknown): HttpError {
  console.warn(`slack: ${describe(error)}`)

  return new HttpError(502, `Slack said ${slackError(error) ?? "something went wrong"}. Try again.`)
}

const slackApi = new Hono<SignedIn>()
  .post("/workspaces/:id/integrations/slack/start", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const url = new URL("https://slack.com/oauth/v2/authorize")

    url.searchParams.set("client_id", settings.SLACK_CLIENT_ID)
    url.searchParams.set("scope", SLACK_SCOPES.join(","))
    url.searchParams.set("redirect_uri", SLACK_REDIRECT)
    url.searchParams.set(
      "state",
      sealState({ workspaceId: workspace.id, userId: c.var.userId, provider: "slack" }),
    )

    return c.json({ url: url.href })
  })
  .post("/integrations/slack/callback", async (c) => {
    const { code, state } = Callback.parse(await c.req.json())
    const { workspaceId } = openState(state, "slack", c.var.userId)

    await adminOf(c.var.userId, workspaceId)

    /* A code is good once: if Slack's answer is lost, the person connects again. */
    const answer = await slackClient()
      .oauth.v2.access({
        client_id: settings.SLACK_CLIENT_ID,
        client_secret: settings.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: SLACK_REDIRECT,
      })
      .catch((error: unknown) => {
        throw slackProblem(error)
      })

    if (!answer.access_token || !answer.team?.id) throw new HttpError(502, "Slack sent no token.")

    await saveConnection({
      workspaceId,
      provider: "slack",
      status: "connected",
      accessToken: answer.access_token,
      externalId: answer.team.id,
      externalName: answer.team.name ?? answer.team.id,
      channelId: null,
      channelName: null,
      connectedBy: c.var.userId,
    })

    return c.json({ workspaceId })
  })
  .get("/workspaces/:id/integrations/slack/channels", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const slack = await connectionOf(workspace.id, "slack")
    const listed = await slackClient(slack.accessToken)
      .conversations.list({ types: "public_channel", exclude_archived: true, limit: 200 })
      .catch((error: unknown) => {
        throw slackProblem(error)
      })

    return c.json({
      channels: (listed.channels ?? []).map((channel) => ({ id: channel.id, name: channel.name })),
      selected: slack.channelId,
    })
  })
  .post("/workspaces/:id/integrations/slack/channel", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const { channelId } = z.object({ channelId: z.string().min(1) }).parse(await c.req.json())
    const slack = await connectionOf(workspace.id, "slack")
    /* Joining a channel Relay is in already is a no-op, so this is safe to retry. */
    const joined = await slackClient(slack.accessToken)
      .conversations.join({ channel: channelId })
      .catch((error: unknown) => {
        throw slackProblem(error)
      })

    await query("save slack channel", (db) =>
      db
        .update(integrations)
        .set({ channelId, channelName: joined.channel?.name ?? channelId, status: "connected" })
        .where(and(eq(integrations.workspaceId, workspace.id), eq(integrations.provider, "slack"))),
    )

    return c.json({ channel: joined.channel?.name ?? channelId })
  })

const googleApi = new Hono<SignedIn>()
  .post("/workspaces/:id/integrations/google/start", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const client = googleClient(GOOGLE_REDIRECT)
    /* PKCE: a code stolen on its way back is useless without the verifier, sealed in the state. */
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      state: sealState({
        workspaceId: workspace.id,
        userId: c.var.userId,
        provider: "google",
        verifier: codeVerifier,
      }),
    })

    return c.json({ url })
  })
  .post("/integrations/google/callback", async (c) => {
    const { code, state } = Callback.parse(await c.req.json())
    const { workspaceId, verifier } = openState(state, "google", c.var.userId)

    await adminOf(c.var.userId, workspaceId)

    const client = googleClient(GOOGLE_REDIRECT)
    const { tokens } = await client
      .getToken({ code, codeVerifier: verifier })
      .catch((error: unknown) => {
        console.warn(`google token: ${describe(error)}`)
        throw new HttpError(502, "Google didn't finish connecting. Try again.")
      })
    const ticket = tokens.id_token
      ? await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: settings.GOOGLE_CLIENT_ID,
        })
      : undefined
    const email = ticket?.getPayload()?.email

    if (!tokens.access_token || !email) throw new HttpError(502, "Google sent no token.")

    await saveConnection({
      workspaceId,
      provider: "google",
      status: "connected",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      externalId: email,
      externalName: email,
      connectedBy: c.var.userId,
    })

    return c.json({ workspaceId })
  })
  .get("/workspaces/:id/integrations/google/events", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const calendar = await calendarOf(await connectionOf(workspace.id, "google"))
    const listed = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 5,
    })

    return c.json({
      events: (listed.data.items ?? []).map((event) => ({
        id: event.id,
        title: event.summary ?? "(no title)",
        start: event.start?.dateTime ?? event.start?.date ?? null,
      })),
    })
  })
  .post("/workspaces/:id/notes/:note/review", async (c) => {
    const { workspace } = await membershipOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const noteId = z.coerce.number().int().parse(c.req.param("note"))
    const [note] = await query("find note", (db) =>
      db
        .select()
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspace.id))),
    )

    if (!note) throw new HttpError(404, "No such note.")

    const calendar = await calendarOf(await connectionOf(workspace.id, "google"))
    const start = new Date(Date.now() + 24 * 3600_000)

    start.setUTCHours(10, 0, 0, 0)

    /* The event's id comes from the note, so a retried or repeated request makes one meeting. */
    const event = await calendar.events
      .insert({
        calendarId: "primary",
        requestBody: {
          id: idOfReview(note.id),
          summary: `Review: ${note.title}`,
          description: note.body,
          start: { dateTime: start.toISOString() },
          end: { dateTime: new Date(start.getTime() + 30 * 60_000).toISOString() },
        },
      })
      .then((made) => made.data)
      .catch(async (error: unknown) => {
        if (Reflect.get(Object(error), "status") !== 409) throw error

        return (await calendar.events.get({ calendarId: "primary", eventId: idOfReview(note.id) }))
          .data
      })

    return c.json({ event: { id: event.id, title: event.summary, start: event.start?.dateTime } })
  })

export const integrationsApi = new Hono<SignedIn>()
  .use(signedIn)
  .route("/", slackApi)
  .route("/", googleApi)
  .delete("/workspaces/:id/integrations/:provider", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const provider = z.enum(["slack", "google"]).parse(c.req.param("provider"))

    await query("remove integration", (db) =>
      db
        .delete(integrations)
        .where(
          and(eq(integrations.workspaceId, workspace.id), eq(integrations.provider, provider)),
        ),
    )

    return c.json({ removed: provider })
  })
