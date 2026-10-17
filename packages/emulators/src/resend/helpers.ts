import { randomUUID } from "node:crypto"

import type { ErrorResponse } from "resend"

import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"

/** Resend's ids are UUIDs. */
export const newUuid = (): string => randomUUID()

/** Resend's error body: `{ statusCode, message, name }`. */
export function resendError(
  c: Context,
  statusCode: number,
  name: ErrorResponse["name"],
  message: string,
): Response {
  return c.json({ statusCode, message, name } satisfies ErrorResponse, statusCode)
}

export function notFound(c: Context, what: string): Response {
  return resendError(c, 404, "not_found", `${what} not found`)
}

/** The JSON object a request sent, or an empty one for anything else. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse((await c.req.text()) || "{}")

    return asRecord(parsed) ?? {}
  } catch {
    return {}
  }
}

export function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** A field that takes one address or a list, as a list. */
export function addresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]

  return list.filter((item): item is string => typeof item === "string" && item !== "")
}

/** `tags: [{ name, value }]`, keeping well-formed entries. */
export function tagsOf(value: unknown): { name: string; value: string }[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((tag: unknown) => {
    const { name, value: tagValue } = asRecord(tag) ?? {}

    return typeof name === "string" && typeof tagValue === "string"
      ? [{ name, value: tagValue }]
      : []
  })
}

/** A list response, newest first. */
export function listOf(c: Context, items: readonly unknown[]): Response {
  return c.json({ object: "list", has_more: false, data: items.toReversed() })
}
