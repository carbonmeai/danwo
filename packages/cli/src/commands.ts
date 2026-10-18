/** The CLI's commands described from their commander definitions, for `danwo spec`. */
import type { CliCommand } from "@danwo/skill"
import type { Argument, Command, Option } from "commander"

/** A default as text, or undefined when there is none. */
function defaultText(value: unknown): string | undefined {
  if (value === undefined || value === false) return undefined

  return typeof value === "string" ? value : JSON.stringify(value)
}

function argumentOf(argument: Argument) {
  return {
    name: argument.name(),
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description,
    choices: argument.argChoices ?? [],
  }
}

function optionOf(option: Option) {
  return {
    flags: option.flags,
    description: option.description,
    choices: option.argChoices ?? [],
    default: defaultText(option.defaultValue),
  }
}

/** Every subcommand of `program` with its arguments and options. */
export function cliCommands(program: Command): CliCommand[] {
  return program.commands.map((command) => ({
    name: command.name(),
    description: command.description(),
    arguments: command.registeredArguments.map(argumentOf),
    options: command.options.map(optionOf),
  }))
}
