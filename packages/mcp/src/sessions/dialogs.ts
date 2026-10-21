/**
 * A session's dialogs: the `alert`, `confirm`, `prompt` and `beforeunload` boxes its pages open.
 * A dialog blocks its page, so nothing can be read or clicked until it is answered. Dialogs are
 * held open for the agent to read and answer with the `dialog` tool; the action that opened one
 * finishes once it is answered.
 */
import type { Dialog } from "playwright-core"

/** A dialog waiting for an answer. */
export interface OpenDialog {
  readonly type: string
  readonly message: string
  readonly defaultValue: string
  readonly dialog: Dialog
}

/** How some work ended: on its own, or held up by a dialog with the rest of it still running. */
export type HeldOutcome<T> =
  | { readonly done: T }
  | { readonly dialog: OpenDialog; readonly rest: Promise<T> }

export class SessionDialogs {
  private pending: OpenDialog | undefined
  private readonly waiters = new Set<(dialog: OpenDialog) => void>()

  /** The dialog waiting for an answer, if one is open. */
  get open(): OpenDialog | undefined {
    return this.pending
  }

  /** A page opened `dialog`: it waits for an answer. */
  opened(dialog: Dialog): void {
    const open = {
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      dialog,
    }

    this.pending = open
    for (const resolve of this.waiters) resolve(open)
    this.waiters.clear()
  }

  /**
   * Runs `work`; resolves with what it gave, or, when a dialog opens before it ends, with the
   * dialog and the rest of the work, which finishes once the dialog is answered.
   */
  async run<T>(work: () => Promise<T>): Promise<HeldOutcome<T>> {
    const running = work()
    const { promise: opened, resolve } = Promise.withResolvers<OpenDialog>()

    this.waiters.add(resolve)

    /* The rest may fail after the agent stopped waiting for it; that is reported, not thrown. */
    void running.catch(() => undefined)

    try {
      return await Promise.race([
        running.then((done) => ({ done })),
        opened.then((dialog) => ({ dialog, rest: running })),
      ])
    } finally {
      this.waiters.delete(resolve)
    }
  }

  /** Accepts the open dialog (a prompt with `text`, else its default) or dismisses it. */
  async answer(accept: boolean, text?: string): Promise<OpenDialog> {
    const open = this.pending

    if (open === undefined) throw new Error("no dialog is open")

    this.pending = undefined
    if (accept) await open.dialog.accept(text ?? open.defaultValue)
    else await open.dialog.dismiss()

    return open
  }
}
