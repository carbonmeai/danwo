/**
 * The questions `danwo init` asks, behind one small interface: the terminal prompts in a person's
 * shell, and a scripted stand-in in tests. Leaving any prompt (Ctrl-C, Escape) throws
 * `InitCancelled` before anything is written.
 */
import * as clack from "@clack/prompts"

/** One choice in a list. */
export interface Choice<T extends string> {
  readonly value: T
  readonly label: string
  readonly hint?: string
}

export interface Prompter {
  intro(text: string): void
  note(text: string, title: string): void
  select<T extends string>(message: string, choices: readonly Choice<T>[], initial: T): Promise<T>
  multiselect<T extends string>(
    message: string,
    choices: readonly Choice<T>[],
    initial: readonly T[],
  ): Promise<T[]>
  /** A line of text; `check` returns what is wrong with an answer, or undefined. */
  text(
    message: string,
    initial: string,
    check?: (value: string) => string | undefined,
  ): Promise<string>
  confirm(message: string, initial: boolean): Promise<boolean>
  /** Runs `work` behind a spinner, then shows what `done` says about its result. */
  task<T>(message: string, work: () => Promise<T>, done: (value: T) => string): Promise<T>
  outro(text: string): void
}

/** The person left the prompts; nothing was written. */
export class InitCancelled extends Error {
  override readonly name = "InitCancelled"

  constructor() {
    super("danwo init was cancelled; nothing was written")
  }
}

/** An answer, or `InitCancelled` when the person left the prompt. */
function answered<T extends string | boolean | string[]>(value: T | symbol): T {
  if (typeof value === "symbol") {
    clack.cancel("Cancelled; nothing was written.")
    throw new InitCancelled()
  }

  return value
}

/** Clack's options from choices, leaving out a hint a choice has none for. */
function options(
  choices: readonly Choice<string>[],
): { value: string; label: string; hint?: string }[] {
  return choices.map((choice) => ({
    value: choice.value,
    label: choice.label,
    ...(choice.hint !== undefined && { hint: choice.hint }),
  }))
}

/** The choices' own values for what a prompt returned. */
function picked<T extends string>(choices: readonly Choice<T>[], values: readonly string[]): T[] {
  return choices.filter((choice) => values.includes(choice.value)).map((choice) => choice.value)
}

/** The prompts in a terminal. */
export const terminalPrompter: Prompter = {
  intro(text) {
    /* The wordmark above the frame the prompts draw. */
    process.stdout.write(`\n${text}\n\n`)
    clack.intro("danwo init")
  },
  note: (text, title) => clack.note(text, title),
  outro: (text) => clack.outro(text),
  async select(message, choices, initial) {
    const value = answered<string>(
      await clack.select<string>({ message, options: options(choices), initialValue: initial }),
    )

    return picked(choices, [value])[0] ?? initial
  },
  async multiselect(message, choices, initial) {
    const values = answered<string[]>(
      await clack.multiselect<string>({
        message,
        options: options(choices),
        initialValues: [...initial],
        required: false,
      }),
    )

    return picked(choices, values)
  },
  async text(message, initial, check) {
    return answered<string>(
      await clack.text({
        message,
        initialValue: initial,
        ...(check && { validate: (value: string | undefined) => check(value ?? "") }),
      }),
    )
  },
  async confirm(message, initial) {
    return answered<boolean>(await clack.confirm({ message, initialValue: initial }))
  },
  async task(message, work, done) {
    const spin = clack.spinner()

    spin.start(message)

    try {
      const value = await work()

      spin.stop(done(value))

      return value
    } catch (error) {
      spin.error(error instanceof Error ? error.message : String(error))
      throw error
    }
  },
}
