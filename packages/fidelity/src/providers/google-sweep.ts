/**
 * What earlier Google runs left in the test account: labels, events and files named with the
 * fidelity tag, and messages whose subject carries it. Only tagged objects are listed; messages
 * are moved to the trash, the rest deleted.
 */
import { accountJson, SIGNED_IN } from "../account-target.ts"
import type { Target } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json, readJson, stringField } from "../shape.ts"
import { isTagged, type Leftover, SweepUnavailable } from "../sweep.ts"

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
const FILES = "https://www.googleapis.com/drive/v3/files"

/** The objects under `field` of an answer from `url`. */
async function itemsAt(target: Target, url: string, field: string): Promise<readonly Json[]> {
  const items = asJsonObject(await readJson(await target.send(accountJson("GET", url))))?.[field]

  return items !== undefined && isJsonArray(items) ? items : []
}

/** Tagged items from `url`, each removed by the request `remove` makes for its id. */
async function tagged(
  target: Target,
  kind: string,
  url: string,
  field: string,
  named: string,
  remove: (id: string) => Request,
): Promise<Leftover[]> {
  return (await itemsAt(target, url, field)).flatMap((item) => {
    const id = stringField(item, "id")
    const label = stringField(item, named)

    return isTagged(label)
      ? [{ kind, id, label, tagged: true, remove: () => target.send(remove(id)) }]
      : []
  })
}

/** A message's subject, read from its metadata. */
async function subjectOf(target: Target, id: string): Promise<string> {
  const message = await readJson(
    await target.send(
      accountJson("GET", `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=Subject`),
    ),
  )
  const headers = asJsonObject(asJsonObject(message)?.["payload"])?.["headers"]
  const list = headers !== undefined && isJsonArray(headers) ? headers : []
  const subject = list.find((header) => stringField(header, "name") === "Subject")

  return subject === undefined ? "" : stringField(subject, "value")
}

/** Messages outside the trash whose subject carries the tag. */
async function taggedMessages(target: Target): Promise<Leftover[]> {
  const found = await itemsAt(
    target,
    `${GMAIL}/messages?q=${encodeURIComponent('subject:"danwo-fidelity" -in:trash')}`,
    "messages",
  )
  const messages = await Promise.all(
    found.map(async (item) => ({
      id: stringField(item, "id"),
      subject: await subjectOf(target, stringField(item, "id")),
    })),
  )

  return messages.flatMap(({ id, subject }) =>
    isTagged(subject)
      ? [
          {
            kind: "message",
            id,
            label: subject,
            tagged: true,
            remove: () => target.send(accountJson("POST", `${GMAIL}/messages/${id}/trash`)),
          },
        ]
      : [],
  )
}

/** Everything tagged in the signed-in test account. */
export async function sweepGoogle(target: Target): Promise<readonly Leftover[]> {
  if (target.credentials[SIGNED_IN] === undefined)
    throw new SweepUnavailable("needs a signed-in test account: run `danwo fidelity login google`")

  return [
    ...(await tagged(target, "label", `${GMAIL}/labels`, "labels", "name", (id) =>
      accountJson("DELETE", `${GMAIL}/labels/${id}`),
    )),
    ...(await taggedMessages(target)),
    ...(await tagged(target, "event", `${EVENTS}?q=danwo-fidelity`, "items", "summary", (id) =>
      accountJson("DELETE", `${EVENTS}/${id}`),
    )),
    ...(await tagged(
      target,
      "file",
      `${FILES}?q=${encodeURIComponent("name contains 'danwo-fidelity' and trashed = false")}`,
      "files",
      "name",
      (id) => accountJson("DELETE", `${FILES}/${id}`),
    )),
  ]
}
