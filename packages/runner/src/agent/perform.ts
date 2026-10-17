/**
 * Carrying out one tool call of a live step: aim at the element by its ref, act, and describe what
 * was done so a replay can do it again. The description is taken before acting, while the ref still
 * belongs to the latest view.
 */
import type { Page } from "playwright-core"

import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk, MailOrigin } from "../mail/desk.ts"
import { embedsValue, paramSecret, type Params, paramTyped } from "../replay/params.ts"
import { describeTarget, type Target } from "../replay/target.ts"
import type { FromMail, RecordedAction, RecordedAddress, RecordedInput } from "../replay/trace.ts"
import { checkSecretField } from "../secrets/fields.ts"
import type { SecretVault } from "../secrets/index.ts"
import { filePaths, type Files } from "./files.ts"
import { type Aftermath, type Operation, operate, scroll, waitFor, watched } from "./operate.ts"
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
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready: () => Promise<void>
  /** Mail the app sent, as the emulators caught it. */
  readonly mail: MailDesk
}

export interface Performed {
  /** What happened, for the model. */
  readonly outcome: string
  /**
   * The action as recorded; null when it cannot be replayed (no durable target), undefined when
   * there is nothing to replay (reading mail changes nothing on the page).
   */
  readonly recorded: RecordedAction | null | undefined
}

/** The tools that act on the page: every tool but `done`. */
type ActionName = Exclude<ToolName, "done">

/** A call of one of the tools in `Names`, with that tool's input. */
type CallOf<Names extends ActionName> = {
  [Name in Names]: { readonly name: Name; readonly input: ToolInput<Name> }
}[Names]

/** A tool call the agent made, parsed. */
export type Call = CallOf<ActionName>

function isActionName(name: string): name is ActionName {
  return name !== "done" && Object.hasOwn(toolInputs, name)
}

/** A parsed tool call, or what was wrong with it in words the model can act on. */
export type ParsedCall = { readonly call: Call } | { readonly problem: string }

/** Parses `input` against the named tool's schema. */
function parseAs(name: ActionName, input: unknown): ParsedCall {
  const parsed = toolInputs[name].safeParse(input)

  if (!parsed.success)
    return {
      problem: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- toolInputs[name] parses ToolInput<Name>; TypeScript can't correlate a generic key with its schema's output
  return { call: { name, input: parsed.data } as Call }
}

/** Parses a raw tool call; `done` and unknown tools are problems too. */
export function parseCall(name: string, input: unknown): ParsedCall {
  return isActionName(name) ? parseAs(name, input) : { problem: `there is no tool "${name}"` }
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
  const target = durable(await describeTarget(page, context.tree, ref), context)
  const after = await watched(
    context.tabs,
    () => operate(page.getByRef(ref), operation, context.timeout),
    {
      timeout: context.timeout,
      mayOpenTab: operation.kind === "click" || operation.kind === "press",
    },
  )

  if (after.dialog === undefined) await context.ready()

  return {
    outcome: afterText(after),
    recorded: target === undefined ? null : record(target, after),
  }
}

/**
 * A described target without the parts that would not match on another run: a name or text that
 * holds a param's value or a value read from mail is dropped. Undefined when nothing durable is
 * left to find the element by, so the action is not replayed against the wrong element.
 */
function durable(target: Target | undefined, context: PerformContext): Target | undefined {
  if (target === undefined) return undefined

  const keeps = (text: string | undefined): text is string =>
    text !== undefined && !embedsValue(text, context.params, context.mail.values())
  const { name, text, ...rest } = target
  const kept: Target = { ...rest, ...(keeps(name) && { name }), ...(keeps(text) && { text }) }
  const dropped = kept.name !== name || kept.text !== text

  if (!dropped) return target

  return findable(kept) ? kept : undefined
}

/** Whether a target still says which element it is: by test id, name or text. */
function findable(target: Target): boolean {
  return [target.testId, target.name, target.text].some((part) => part !== undefined)
}

/** An address as recorded: the param it came from, or as written. */
function addressOf(params: Params, to: string): RecordedAddress {
  const param = paramTyped(params, to)

  return param === undefined ? { text: to } : { param }
}

/** A mail origin as recorded, with its address put the way the recording keeps it. */
function fromMail(origin: MailOrigin, params: Params): FromMail {
  return {
    to: addressOf(params, origin.to),
    kind: origin.pick.kind,
    ...(origin.pick.match !== undefined && { match: origin.pick.match }),
    ...(origin.pick.digits !== undefined && { digits: origin.pick.digits }),
  }
}

/** How text the agent typed is recorded: as the mail value or param it came from, or as written. */
function typedInput(context: PerformContext, text: string): RecordedInput {
  const origin = context.mail.originOf(text)

  if (origin !== undefined) return { mail: fromMail(origin, context.params) }

  const param = paramTyped(context.params, text)

  return param === undefined ? { text } : { param }
}

async function fillSecret(
  context: PerformContext,
  input: ToolInput<"fill_secret">,
): Promise<Performed> {
  const secret = paramSecret(context.params, input.secret) ?? context.vault.handle(input.secret)

  await checkSecretField(context.tabs.page.getByRef(input.ref), secret, context.timeout)

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
  await context.ready()

  return {
    outcome: "done",
    recorded: {
      kind: "dialog",
      accept: input.accept,
      ...(input.text !== undefined && { input: typedInput(context, input.text) }),
    },
  }
}

/** What a navigation to a link read from mail is recorded under: never the link itself. */
const MAIL_LINK = "(a link from mail)"

async function navigateTo(context: PerformContext, url: string): Promise<Performed> {
  const absolute = new URL(url, context.appUrl)
  const app = new URL(context.appUrl)
  const origin = context.mail.originOf(url)
  const recorded =
    absolute.origin === app.origin ? `${absolute.pathname}${absolute.search}` : absolute.href

  await context.tabs.page.goto(absolute.href, { timeout: context.timeout })
  await context.ready()

  return {
    outcome: "done",
    recorded:
      origin === undefined
        ? { kind: "navigate", url: recorded }
        : { kind: "navigate", url: MAIL_LINK, mail: fromMail(origin, context.params) },
  }
}

/** Reads a code or a link from the newest mail to an address, for the model to use. */
async function readMail(
  context: PerformContext,
  input: ToolInput<"read_mail">,
): Promise<Performed> {
  if (!context.mail.available)
    return { outcome: "no mail is caught in this session", recorded: undefined }

  const pick = { kind: input.pick, match: input.match }
  const value = await context.mail.value(input.to, pick, context.timeout)

  return {
    outcome:
      value === undefined
        ? `no mail to ${input.to} with a ${input.pick} arrived`
        : `the ${input.pick} is ${value}`,
    recorded: undefined,
  }
}

/** Shows the newest mail to an address in the active tab. */
async function openMail(
  context: PerformContext,
  input: ToolInput<"open_mail">,
): Promise<Performed> {
  const opened = await context.mail.open(context.tabs.page, input.to, context.timeout)

  if (!opened) return { outcome: `no mail to ${input.to} arrived`, recorded: undefined }

  await context.ready()

  return {
    outcome: "done; the email is shown",
    recorded: { kind: "open_mail", to: addressOf(context.params, input.to) },
  }
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
  await context.ready()

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
    input.ref === undefined
      ? undefined
      : durable(await describeTarget(page, context.tree, input.ref), context)
  const condition = {
    text: input.text,
    element,
    state: input.state,
    networkIdle: input.network_idle,
    ms: input.ms,
  }

  await waitFor(page, condition, context.timeout)

  /* A wait on an element nothing durable describes, or on text that varies, cannot be replayed. */
  const lost =
    (element !== undefined && target === undefined) ||
    (input.text !== undefined && embedsValue(input.text, context.params, context.mail.values()))

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

  if (after.dialog === undefined) await context.ready()

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
      input: typedInput(context, input.text),
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
  read_mail: (input, context) => readMail(context, input),
  open_mail: (input, context) => openMail(context, input),
}

/** Carries out `call` on the active tab. */
export async function perform(call: Call, context: PerformContext): Promise<Performed> {
  if (context.tabs.dialog !== undefined && call.name !== "dialog")
    throw new Error("a dialog is open; answer it with the dialog tool first")

  return dispatch(call, context)
}

/** Hands a call to its tool's handler. */
function dispatch<Name extends ActionName>(
  call: CallOf<Name>,
  context: PerformContext,
): Promise<Performed> | Performed {
  const handle: Handler<Name> = handlers[call.name]

  return handle(call.input, context)
}
