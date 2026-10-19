/**
 * Running a triggered workflow, for each recipient: a code-first workflow step by step through the
 * app's `@novu/framework` bridge (discover it, then execute each step with the outputs of the ones
 * before, as Novu Cloud does, every request signed with the environment's secret key), or a
 * workflow seeded from the dashboard by filling its templates. Each step's message is kept: in-app
 * ones reach the subscriber's Inbox at once, emails go to a connected Resend emulator when there
 * is one. Delays and digests are run straight through.
 */
import { createHmac } from "node:crypto"

import { asRecord } from "../json.ts"
import type { Clock } from "../store.ts"
import type {
  NovuChannel,
  NovuEnvironment,
  NovuExecution,
  NovuMessage,
  NovuStepTemplate,
  NovuSubscriber,
} from "./entities.ts"
import type { NovuRealtime } from "./realtime.ts"
import { type NovuStore, objectId } from "./store.ts"

/** What an email step sends, for a connected email emulator to deliver. */
export interface NovuEmail {
  readonly to: string
  readonly subject: string
  readonly html: string
}

/** One step a bridge's `discover` lists. */
interface BridgeStep {
  readonly stepId: string
  readonly type: string
}

/** The channel a step type delivers on, if it delivers. */
function channelOf(type: string): NovuChannel | undefined {
  const normal = type === "inApp" ? "in_app" : type

  return normal === "in_app" ||
    normal === "email" ||
    normal === "sms" ||
    normal === "push" ||
    normal === "chat"
    ? normal
    : undefined
}

/** `{{payload.a.b}}` and `{{subscriber.firstName}}` in a template, filled from the trigger. */
function fill(template: string | undefined, values: Record<string, unknown>): string {
  return (template ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    let value: unknown = values

    for (const part of path.split(".")) value = asRecord(value)?.[part]

    return value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value)
  })
}

const stringOf = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** The subscriber a bridge's `execute` is told about. */
function bridgeSubscriber(subscriber: NovuSubscriber) {
  return {
    subscriberId: subscriber.subscriber_id,
    firstName: subscriber.first_name,
    lastName: subscriber.last_name,
    email: subscriber.email,
    phone: subscriber.phone,
    avatar: subscriber.avatar,
    locale: subscriber.locale,
    data: subscriber.data ?? {},
  }
}

export class NovuEngine {
  private readonly objects: NovuStore
  private readonly clock: Clock
  private readonly wallClock: Clock
  private readonly realtime: NovuRealtime
  private readonly running = new Set<Promise<void>>()
  /** Where email steps go, when an email emulator is connected. */
  email: ((email: NovuEmail) => Promise<void>) | undefined

  constructor(objects: NovuStore, clock: Clock, wallClock: Clock, realtime: NovuRealtime) {
    this.objects = objects
    this.clock = clock
    this.wallClock = wallClock
    this.realtime = realtime
  }

  /** Starts `workflowId` for each subscriber, in the background; `idle` waits for the runs. */
  start(
    env: NovuEnvironment,
    workflowId: string,
    subscribers: readonly NovuSubscriber[],
    payload: Record<string, unknown>,
    transactionId: string,
  ): void {
    for (const subscriber of subscribers) {
      const execution = this.objects.executions.add(
        {
          id: objectId(),
          transaction_id: transactionId,
          workflow_id: workflowId,
          subscriber_id: subscriber.subscriber_id,
          payload,
          source: this.objects.workflows.get(workflowId) ? "seeded" : "bridge",
          status: "pending",
          error: null,
          steps: [],
          created: this.clock().toISOString(),
        },
        null,
      )
      const run = this.run(env, execution, subscriber).finally(() => this.running.delete(run))

      this.running.add(run)
    }
  }

  /** Resolves once every run started so far has finished. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running)
  }

  /** Stops the runs of a transaction that have not finished. */
  cancel(transactionId: string): boolean {
    let canceled = false

    for (const execution of this.objects.executions.where(
      (found) => found.transaction_id === transactionId && found.status === "pending",
    )) {
      this.objects.executions.change(execution.id, { status: "canceled" })
      canceled = true
    }

    return canceled
  }

  private async run(
    env: NovuEnvironment,
    execution: NovuExecution,
    subscriber: NovuSubscriber,
  ): Promise<void> {
    try {
      const seeded = this.objects.workflows.get(execution.workflow_id)

      if (seeded) await this.runSeeded(execution, subscriber, seeded.steps, seeded.tags)
      else await this.runBridge(env, execution, subscriber)

      if (this.objects.executions.get(execution.id)?.status === "pending")
        this.objects.executions.change(execution.id, { status: "completed" })
    } catch (error) {
      this.objects.executions.change(execution.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private canceled(execution: NovuExecution): boolean {
    return this.objects.executions.get(execution.id)?.status === "canceled"
  }

  private record(execution: NovuExecution, step: NovuExecution["steps"][number]): void {
    const current = this.objects.executions.get(execution.id)

    if (current) this.objects.executions.change(execution.id, { steps: [...current.steps, step] })
  }

  private async runSeeded(
    execution: NovuExecution,
    subscriber: NovuSubscriber,
    steps: readonly NovuStepTemplate[],
    tags: readonly string[],
  ): Promise<void> {
    const values = { payload: execution.payload, subscriber: bridgeSubscriber(subscriber) }

    for (const step of steps) {
      if (this.canceled(execution)) return

      const outputs = {
        subject: fill(step.subject, values),
        body: fill(step.body, values),
        ...(step.data && { data: step.data }),
        ...(step.redirectUrl && { redirect: { url: fill(step.redirectUrl, values) } }),
      }

      await this.deliver(execution, subscriber, step.stepId, step.type, outputs, tags)
      this.record(execution, { stepId: step.stepId, type: step.type, status: "completed", outputs })
    }
  }

  private async runBridge(
    env: NovuEnvironment,
    execution: NovuExecution,
    subscriber: NovuSubscriber,
  ): Promise<void> {
    if (env.bridge_url === null)
      throw new Error(`workflow ${execution.workflow_id} is not seeded and no bridge URL is set`)

    const discovered = asRecord(await this.bridge(env, "GET", { action: "discover" }, {}))
    const workflows = Array.isArray(discovered?.["workflows"]) ? discovered["workflows"] : []
    const workflow = workflows
      .map((found) => asRecord(found))
      .find((found) => found?.["workflowId"] === execution.workflow_id)

    if (workflow === undefined)
      throw new Error(`the bridge has no workflow ${execution.workflow_id}`)

    const steps: BridgeStep[] = (Array.isArray(workflow["steps"]) ? workflow["steps"] : []).flatMap(
      (step) => {
        const fields = asRecord(step)

        return typeof fields?.["stepId"] === "string" && typeof fields["type"] === "string"
          ? [{ stepId: fields["stepId"], type: fields["type"] }]
          : []
      },
    )
    const tags = Array.isArray(workflow["tags"])
      ? workflow["tags"].filter((tag): tag is string => typeof tag === "string")
      : []
    const state: { stepId: string; outputs: Record<string, unknown>; state: { status: string } }[] =
      []

    for (const step of steps) {
      if (this.canceled(execution)) return

      const result = asRecord(
        await this.bridge(
          env,
          "POST",
          { action: "execute", workflowId: execution.workflow_id, stepId: step.stepId },
          {
            payload: execution.payload,
            subscriber: bridgeSubscriber(subscriber),
            state,
            controls: {},
            inputs: {},
          },
        ),
      )
      const skipped = asRecord(result?.["options"])?.["skip"] === true
      const outputs = asRecord(result?.["outputs"]) ?? {}

      if (!skipped) await this.deliver(execution, subscriber, step.stepId, step.type, outputs, tags)
      this.record(execution, {
        stepId: step.stepId,
        type: step.type,
        status: skipped ? "skipped" : "completed",
        outputs,
      })
      state.push({
        stepId: step.stepId,
        outputs,
        state: { status: skipped ? "skipped" : "completed" },
      })
    }
  }

  /** One signed request to the app's bridge; throws on an answer that is not a 2xx. */
  private async bridge(
    env: NovuEnvironment,
    method: "GET" | "POST",
    query: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(env.bridge_url ?? "")

    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)

    const text = JSON.stringify(body)
    const timestamp = this.wallClock().getTime()
    const signature = createHmac("sha256", env.api_key).update(`${timestamp}.${text}`).digest("hex")
    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "novu-signature": `t=${timestamp},v1=${signature}`,
      },
      ...(method === "POST" && { body: text }),
    })
    const answer: unknown = await response.json().catch(() => undefined)

    if (!response.ok)
      throw new Error(
        `bridge ${query["action"]} ${query["stepId"] ?? ""} answered ${response.status}: ${JSON.stringify(answer)}`,
      )

    return answer
  }

  /** Keeps what a delivering step sent, and passes it on: to the Inbox, or to an email emulator. */
  private async deliver(
    execution: NovuExecution,
    subscriber: NovuSubscriber,
    stepId: string,
    type: string,
    outputs: Record<string, unknown>,
    tags: readonly string[],
  ): Promise<void> {
    const channel = channelOf(type)

    if (channel === undefined) return

    const message: NovuMessage = {
      id: objectId(),
      transaction_id: execution.transaction_id,
      workflow_id: execution.workflow_id,
      step_id: stepId,
      channel,
      subscriber_id: subscriber.subscriber_id,
      subject: stringOf(outputs["subject"]),
      content: stringOf(outputs["body"]) ?? "",
      data: asRecord(outputs["data"]) ?? null,
      redirect_url: stringOf(asRecord(outputs["redirect"])?.["url"]),
      to: channel === "email" ? subscriber.email : channel === "sms" ? subscriber.phone : null,
      tags: [...tags],
      read: false,
      seen: false,
      archived: false,
      read_at: null,
      seen_at: null,
      archived_at: null,
      created: this.clock().toISOString(),
    }

    this.objects.messages.add(message, null)

    if (channel === "in_app") this.realtime.notify(message, subscriber)
    if (channel === "email" && subscriber.email !== null && this.email)
      await this.email({
        to: subscriber.email,
        subject: message.subject ?? "",
        html: message.content,
      })
  }
}
