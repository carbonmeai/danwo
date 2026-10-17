import { recordChange } from "./changes.ts"
import type { GraphState } from "./context.ts"
import type { CalendarRecord, EventRecord } from "./entities.ts"
import { graphId, newChangeKey } from "./helpers.ts"
import type { Occurrence } from "./outlook-formatters.ts"
import { occurrencesIn } from "./recurrence.ts"

/** A user's calendars, creating the default one the first time. */
export function calendars(state: GraphState, owner: string): CalendarRecord[] {
  const all = state.microsoft().calendars

  if (all.findBy("owner", owner).length === 0)
    all.insert({ graphId: graphId("AAMkAGVm"), owner, name: "Calendar", isDefault: true })

  return all.findBy("owner", owner)
}

export function defaultCalendar(state: GraphState, owner: string): CalendarRecord {
  const found = calendars(state, owner).find((c) => c.isDefault)

  if (!found) throw new Error(`user ${owner} has no default calendar`)

  return found
}

export function createCalendar(state: GraphState, owner: string, name: string): CalendarRecord {
  calendars(state, owner)

  return state.microsoft().calendars.insert({
    graphId: graphId("AAMkAGVm"),
    owner,
    name,
    isDefault: false,
  })
}

/** What an event may be created or updated with. */
export type EventFields = Partial<
  Omit<EventRecord, "id" | "created_at" | "updated_at" | "graphId" | "owner" | "changeKey">
>

function eventChange(
  state: GraphState,
  event: EventRecord,
  changeType: "created" | "updated" | "deleted",
) {
  recordChange(state, {
    owner: event.owner,
    kind: "event",
    targetId: event.graphId,
    folderId: event.calendarId,
    changeType,
  })
}

export function addEvent(
  state: GraphState,
  owner: string,
  calendarId: string,
  fields: EventFields,
): EventRecord {
  const start = fields.start ?? state.clock().toISOString()
  const event = state.microsoft().events.insert({
    graphId: graphId("AAMkAGVmMDEz"),
    owner,
    calendarId,
    subject: "",
    bodyType: "html",
    body: "",
    start,
    end: start,
    timeZone: "UTC",
    isAllDay: false,
    location: "",
    attendees: [],
    showAs: "busy",
    isCancelled: false,
    recurrence: null,
    ...fields,
    changeKey: newChangeKey(),
  })

  eventChange(state, event, "created")

  return event
}

export function updateEvent(
  state: GraphState,
  event: EventRecord,
  fields: EventFields,
): EventRecord {
  const updated =
    state.microsoft().events.update(event.id, { ...fields, changeKey: newChangeKey() }) ?? event

  eventChange(state, updated, "updated")

  return updated
}

export function deleteEvent(state: GraphState, event: EventRecord): void {
  state.microsoft().events.delete(event.id)
  eventChange(state, event, "deleted")
}

/** Every occurrence of `owner`'s events in `[from, to)`, earliest first. */
export function calendarView(
  state: GraphState,
  owner: string,
  window: { readonly from: number; readonly to: number; readonly calendarId?: string },
): Occurrence[] {
  return state
    .microsoft()
    .events.findBy("owner", owner)
    .filter((event) => !window.calendarId || event.calendarId === window.calendarId)
    .flatMap((event) => occurrencesIn(event, window.from, window.to))
    .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
