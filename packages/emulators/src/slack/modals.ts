import type { Clock } from "../store.ts"
import type { WebhookAnswer } from "../webhooks.ts"
import type { ViewRecord } from "./entities.ts"
import { asObject, slackId } from "./helpers.ts"
import { hashOf, NEW_VIEW } from "./routes/views.ts"
import type { SlackStore } from "./store.ts"

/** How many modals Slack stacks at once: a push past this is refused. */
const STACK_LIMIT = 3

/** The open views in `view`'s stack, oldest first: the modal it was opened as and those pushed over it. */
export function stackOf(slack: SlackStore, view: ViewRecord): ViewRecord[] {
  const root = view.rootViewId ?? view.viewId

  return slack.views
    .all()
    .filter((candidate) => !candidate.closed && (candidate.rootViewId ?? candidate.viewId) === root)
}

/** Closes `views`, as the member sees them go. */
export function closeViews(slack: SlackStore, views: readonly ViewRecord[]): void {
  for (const view of views) slack.views.update(view.id, { closed: true, errors: null })
}

/** The modal a `view_submission` delivery was about, from its form body. */
function submittedView(slack: SlackStore, body: unknown): ViewRecord | undefined {
  if (typeof body !== "string") return undefined

  try {
    const payload = asObject(JSON.parse(new URLSearchParams(body).get("payload") ?? ""))
    const view = asObject(payload?.view)

    if (payload?.type !== "view_submission" || typeof view?.id !== "string") return undefined

    return slack.views.findOneBy("viewId", view.id)
  } catch {
    return undefined
  }
}

/** A modal view an app answered with: an object of type `modal`, or undefined. */
function modalIn(value: unknown): Record<string, unknown> | undefined {
  const view = asObject(value)

  return view?.type === "modal" ? view : undefined
}

/** Block errors an app answered with: block ids to messages, or undefined when malformed. */
function errorsIn(value: unknown): Record<string, string> | undefined {
  const errors = asObject(value)

  if (!errors || Object.keys(errors).length === 0) return undefined

  const entries = Object.entries(errors).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )

  return entries.length === Object.keys(errors).length ? Object.fromEntries(entries) : undefined
}

/** What the app's answer asks for, or undefined when Slack would not understand it. */
function actionIn(body: string): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(body))
  } catch {
    return undefined
  }
}

/** What one kind of answer does to the submitted view. */
type AnswerHandler = (
  slack: SlackStore,
  clock: Clock,
  view: ViewRecord,
  answer: Record<string, unknown>,
) => void

/** A new view stacked over `view`, three deep at most. */
function push(slack: SlackStore, clock: Clock, view: ViewRecord, shown: Record<string, unknown>) {
  if (stackOf(slack, view).length >= STACK_LIMIT) return

  slack.views.update(view.id, { errors: null })
  slack.views.insert({
    ...NEW_VIEW,
    viewId: slackId("V"),
    appId: view.appId,
    user: view.user,
    externalId: typeof shown.external_id === "string" ? shown.external_id : null,
    hash: hashOf(shown, clock().toISOString()),
    view: shown,
    rootViewId: view.rootViewId ?? view.viewId,
    previousViewId: view.viewId,
  })
}

/** Each `response_action` an app may answer a submission with. */
const ANSWERS: Readonly<Record<string, AnswerHandler>> = {
  errors: (slack, _clock, view, answer) => {
    const errors = errorsIn(answer.errors)

    if (errors) slack.views.update(view.id, { errors })
  },
  update: (slack, clock, view, answer) => {
    const shown = modalIn(answer.view)

    if (shown)
      slack.views.update(view.id, {
        view: shown,
        hash: hashOf(shown, clock().toISOString()),
        errors: null,
      })
  },
  push: (slack, clock, view, answer) => {
    const shown = modalIn(answer.view)

    if (shown) push(slack, clock, view, shown)
  },
  clear: (slack, _clock, view) => closeViews(slack, stackOf(slack, view)),
}

/**
 * Does what an app's answer to a modal submission asks, as Slack does when the answer comes within
 * three seconds: an empty answer closes the submitted view, `errors` keeps it open with the block
 * errors shown, `update` replaces it, `push` stacks a new view over it (three at most) and `clear`
 * closes its whole stack. An answer Slack would not understand leaves the modal open, as does a
 * submission that failed or timed out, which never reaches here.
 */
function answerSubmission(slack: SlackStore, clock: Clock, view: ViewRecord, body: string): void {
  if (body.trim() === "") {
    closeViews(slack, [view])

    return
  }

  const answer = actionIn(body)
  const action = typeof answer?.response_action === "string" ? answer.response_action : ""
  const handler = ANSWERS[action]

  if (answer && handler) handler(slack, clock, view, answer)
}

/** Reads an app's answer to an interactive delivery and acts on it when it was a modal submission. */
export function answerInteraction(
  slack: SlackStore,
  clock: Clock,
  body: unknown,
  answer: WebhookAnswer,
): void {
  const view = submittedView(slack, body)

  if (view && !view.closed) answerSubmission(slack, clock, view, answer.body)
}
