/**
 * Google Calendar for a workspace: an OAuth client with the workspace's tokens, which refreshes an
 * expired access token on its own and saves the new one, so the connection keeps working.
 */
import { calendar, type calendar_v3 } from "@googleapis/calendar"
import { and, eq } from "drizzle-orm"
import { OAuth2Client } from "google-auth-library"

import { query } from "../shared/db/client.ts"
import { integrations } from "../shared/db/schema.ts"
import { settings } from "./settings.ts"

/** Who the person is, and their calendar's events. */
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"]

/** An OAuth client for Relay's Google app. */
export function googleClient(redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: settings.GOOGLE_CLIENT_ID,
    clientSecret: settings.GOOGLE_CLIENT_SECRET,
    ...(redirectUri !== undefined && { redirectUri }),
  })
}

/**
 * The id of a note's review meeting. Google lets a client choose an event's id (lower-case letters
 * a to v and digits), so asking twice for the same meeting makes it once.
 */
export function idOfReview(noteId: number): string {
  return `note${String(noteId).padStart(8, "0")}`
}

/** The Calendar API as the workspace's connected account. */
export async function calendarOf(
  row: typeof integrations.$inferSelect,
): Promise<calendar_v3.Calendar> {
  const client = googleClient()

  client.setCredentials({
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    expiry_date: row.expiresAt?.getTime() ?? null,
  })
  client.on("tokens", (tokens) => {
    if (!tokens.access_token) return

    void query("save refreshed google token", (db) =>
      db
        .update(integrations)
        .set({
          accessToken: tokens.access_token ?? row.accessToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        })
        .where(
          and(eq(integrations.workspaceId, row.workspaceId), eq(integrations.provider, "google")),
        ),
    ).catch(() => undefined)
  })

  return calendar({ version: "v3", auth: client })
}
