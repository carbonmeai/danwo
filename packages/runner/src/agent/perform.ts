/**
 * Carrying out one tool call of a live step: aim at the element by its ref, act, and describe what
 * was done so a replay can do it again. The description is taken before acting, while the ref still
 * belongs to the latest view.
 */
import type { Page } from "playwright-core"

import type { Tabs } from "../browser/tabs.ts"
import { paramSecret, type Params, paramTyped } from "../replay/params.ts"
import { describeTarget, type Target } from "../replay/target.ts"
import type { RecordedAction, RecordedInput } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import { filePaths, type Files } from "./files.ts"
import {
  type Aftermath,
  type Operation,
  operate,
  scroll,
  settle,
  waitFor,
  watched,
} from "./operate.ts"
import { type ToolInput, toolInputs, type ToolName } from "./tools.ts"

export interface PerformContext {
  readonly tabs: Tabs
  /** The latest view's tree, which the call's refs belong to. */
  readonly tree: string
  readonly appUrl: string
  readonly vault: SecretVault
  readonly params: Params
  readonly files: Files
  readonly timeout: number
}

export interface Performed {
  /** What happened, for the model. */
  readonly outcome: string
  /** The action as recorded; null when it cannot be replayed (no durable target). */
  readonly recorded: RecordedAction | null
}

/** A tool call the agent made, parsed. */
export type Call = {
  [Name in Exclude<ToolName, "done">]: { readonly name: Name; readonly input: ToolInput<Name> }
}[Exclude<ToolName, "done">]

/** Parses a raw tool call; undefined for `done` or a call that does not fit its tool. */
export function parseCall(name: string, input: unknown): Call | undefined {
  if (name === "done" || !(name in toolInputs)) return undefined

  const schema = toolInputs[name as Exclude<ToolName, "done">]
  const parsed = schema.safeParse(input)

  return parsed.success ? ({ name, input: parsed.data } as Call) : undefined
}

/** What the model is told happened besides the action itself. */
function afterText(after: Aftermath): string {
  if (after.dialog !== undefined)
    return `done; a ${after.dialog.type} dialog opened: ${JSON.stringify(after.dialog.message)}. Answer it with the dialog tool.`

  return after.openedTab ? "done; a new tab opened and is now the active one" : "done"
}

/** An action on the element behind `ref`; `record` builds its recording from the described target. */
async function onElement(
  context: PerformContext,
  ref: string,
  operation: Operation,
  record: (target: Target, after: Aftermath) => RecordedAction,
): Promise<Performed> {
  const page = context.tabs.page
  const target = await describeTarget(page, context.tree, ref)
  const after = await watched(
    context.tabs,
    () => operate(page.getByRef(ref), operation, context.timeout),
    {
      timeout: context.timeout,
      mayOpenTab: operation.kind === "click" || operation.kind === "press",
    },
  )

  if (after.dialog === undefined) await settle(context.tabs.page)

  return {
    outcome: afterText(after),
    recorded: target === undefined ? null : record(target, after),
  }
}

/** How text the agent typed is recorded: as the param it came from, or as written. */
function typedInput(params: Params, text: string): RecordedInput {
  const param = paramTyped(params, text)

  return param === undefined ? { text } : { param }
}

async function fillSecret(
  context: PerformContext,
  input: ToolInput<"fill_secret">,
): Promise<Performed> {
  const secret = paramSecret(context.params, input.secret) ?? context.vault.handle(input.secret)
  const value = await context.vault.reveal(secret)

  return onElement(context, input.ref, { kind: "fill", text: value }, (target) => ({
    kind: "fill",
    target,
    input: { secret: secret.name },
  }))
}

function upload(context: PerformContext, input: ToolInput<"upload_file">): Promise<Performed> {
  const paths = filePaths(context.files, input.files)

  return onElement(context, input.ref, { kind: "upload", paths }, (target) => ({
    kind: "upload",
    target,
    files: [...input.files],
  }))
}

async function drag(context: PerformContext, input: ToolInput<"drag">): Promise<Performed> {
  const page = context.tabs.page
  const to = await describeTarget(page, context.tree, input.to)
  const performed = await onElement(
    context,
    input.ref,
    { kind: "drag", to: page.getByRef(input.to) },
    (target) => ({ kind: "drag", target, to: to ?? target }),
  )

  /* Without a durable drop target the drag cannot be replayed. */
  return to === undefined ? { ...performed, recorded: null } : performed
}

async function answerDialog(
  context: PerformContext,
  input: ToolInput<"dialog">,
): Promise<Performed> {
  await context.tabs.answer(input.accept, input.text)
  await settle(context.tabs.page)

  return {
    outcome: "done",
    recorded: {
      kind: "dialog",
      accept: input.accept,
      ...(input.text !== undefined && { input: typedInput(context.params, input.text) }),
    },
  }
}

function navigateTo(context: PerformContext, url: string): Promise<Performed> {
  const absolute = new URL(url, context.appUrl)
  const app = new URL(context.appUrl)
  const recorded =
    absolute.origin === app.origin ? `${absolute.pathname}${absolute.search}` : absolute.href

  return context.tabs.page
    .goto(absolute.href, { timeout: context.timeout })
    .then(() => ({ outcome: "done", recorded: { kind: "navigate", url: recorded } }))
}

async function scrollPage(context: PerformContext, input: ToolInput<"scroll">): Promise<Performed> {
  if (input.ref !== undefined)
    return onElement(context, input.ref, { kind: "scroll-into-view" }, (target) => ({
      kind: "scroll",
      target,
    }))

  const direction = input.direction ?? "down"

  await scroll(context.tabs.page, direction)

  return { outcome: "done", recorded: { kind: "scroll", direction } }
}

async function goBack(context: PerformContext): Promise<Performed> {
  await context.tabs.page.goBack({ timeout: context.timeout })
  await settle(context.tabs.page)

  return { outcome: "done", recorded: { kind: "back" } }
}

function switchTab(context: PerformContext, tab: number): Performed {
  context.tabs.switchTo(tab)

  return { outcome: "done", recorded: { kind: "switch_tab", tab } }
}

/** A recorded wait: what it waited for, without the fields the call left out. */
function recordedWait(input: ToolInput<"wait_for">, target: Target | undefined): RecordedAction {
  const what = {
    ...(input.text !== undefined && { text: input.text }),
    ...(target !== undefined && { target }),
    ...(input.state !== undefined && { state: input.state }),
  }
  const how = {
    ...(input.network_idle !== undefined && { networkIdle: input.network_idle }),
    ...(input.ms !== undefined && { ms: input.ms }),
  }

  return { kind: "wait", ...what, ...how }
}

async function waitUntil(
  context: PerformContext,
  input: ToolInput<"wait_for">,
): Promise<Performed> {
  const page: Page = context.tabs.page
  const element = input.ref === undefined ? undefined : page.getByRef(input.ref)
  const target =
    input.ref === undefined ? undefined : await describeTarget(page, context.tree, input.ref)
  const condition = {
    text: input.text,
    element,
    state: input.state,
    networkIdle: input.network_idle,
    ms: input.ms,
  }

  await waitFor(page, condition, context.timeout)

  /* A wait on an element nothing durable describes cannot be replayed. */
  const lost = element !== undefined && target === undefined

  return { outcome: "done", recorded: lost ? null : recordedWait(input, target) }
}

async function pressKey(context: PerformContext, input: ToolInput<"press">): Promise<Performed> {
  if (input.ref !== undefined) {
    const { key } = input

    return onElement(context, input.ref, { kind: "press", key }, (target, after) => ({
      kind: "press",
      key,
      target,
      ...(after.openedTab && { opensTab: true }),
    }))
  }

  const after = await watched(context.tabs, () => context.tabs.page.keyboard.press(input.key), {
    timeout: context.timeout,
    mayOpenTab: true,
  })

  if (after.dialog === undefined) await settle(context.tabs.page)

  return {
    outcome: afterText(after),
    recorded: { kind: "press", key: input.key, ...(after.openedTab && { opensTab: true }) },
  }
}

type Handler<Name extends Call["name"]> = (
  input: ToolInput<Name>,
  context: PerformContext,
) => Promise<Performed> | Performed

/** How each tool is carried out. */
const handlers: { readonly [Name in Call["name"]]: Handler<Name> } = {
  click: (input, context) =>
    onElement(context, input.ref, { kind: "click" }, (target, after) => ({
      kind: "click",
      target,
      ...(after.openedTab && { opensTab: true }),
    })),
  fill: (input, context) =>
    onElement(context, input.ref, { kind: "fill", text: input.text }, (target) => ({
      kind: "fill",
      target,
      input: typedInput(context.params, input.text),
    })),
  select: (input, context) =>
    onElement(context, input.ref, { kind: "select", option: input.option }, (target) => ({
      kind: "select",
      target,
      option: input.option,
    })),
  check: (input, context) =>
    onElement(context, input.ref, { kind: "check", checked: input.checked }, (target) => ({
      kind: "check",
      target,
      checked: input.checked,
    })),
  hover: (input, context) =>
    onElement(context, input.ref, { kind: "hover" }, (target) => ({ kind: "hover", target })),
  fill_secret: (input, context) => fillSecret(context, input),
  press: (input, context) => pressKey(context, input),
  upload_file: (input, context) => upload(context, input),
  drag: (input, context) => drag(context, input),
  dialog: (input, context) => answerDialog(context, input),
  scroll: (input, context) => scrollPage(context, input),
  navigate: (input, context) => navigateTo(context, input.url),
  back: (_input, context) => goBack(context),
  switch_tab: (input, context) => switchTab(context, input.tab),
  wait_for: (input, context) => waitUntil(context, input),
}

/** Carries out `call` on the active tab. */
export async function perform(call: Call, context: PerformContext): Promise<Performed> {
  if (context.tabs.dialog !== undefined && call.name !== "dialog")
    throw new Error("a dialog is open; answer it with the dialog tool first")

  const handle = handlers[call.name] as Handler<Call["name"]>

  return handle(call.input as never, context)
}
