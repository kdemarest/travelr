import { CommandError } from "./errors.js";
import type { ParsedCommand } from "./command-types.js";
import { getCommandMetadata } from "./command-registry.js";

// Re-export types from command-types for backward compatibility
export type { ParsedCommand } from "./command-types.js";
export type {
  NewTripCommand,
  AddCommand,
  EditCommand,
  DeleteCommand,
  UndoCommand,
  RedoCommand,
  HelpCommand,
  WhoAmICommand,
  TripCommand,
  ModelCommand,
  WebSearchCommand,
  AddCountryCommand,
  RefreshCountriesCommand,
  UserPrefCommand,
  MarkCommand,
  IntentCommand,
  MoveDayCommand,
  InsertDayCommand,
  RemoveDayCommand,
  SetAlarmCommand,
  DeleteAlarmCommand,
  EnableAlarmCommand,
  DisableAlarmCommand,
} from "./command-types.js";

/**
 * Generic command representation: command id + key/value pairs.
 * This is the normalized form after parsing the command string.
 * All positional arguments have been resolved to named keys.
 */
export class CommandWithArgs {
  public commandId: string;
  public args: Record<string, string>;

  /**
   * Parse a normalized command string into a Command.
   * Expected format: /commandId key=value key2="quoted value" ...
   */
  constructor(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/")) {
      throw new CommandError("Commands must start with a slash (/) prefix.");
    }

    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) {
      this.commandId = trimmed.slice(1);
      this.args = {};
    } else {
      this.commandId = trimmed.slice(1, spaceIndex);
      this.args = this.parseArgs(trimmed.slice(spaceIndex + 1));
    }
  }

  private parseArgs(argsText: string): Record<string, string> {
    const args: Record<string, string> = {};
    let remaining = argsText.trim();

    while (remaining.length > 0) {
      // Match key=value or key="quoted value"
      const match = remaining.match(/^(\w+)=("(?:\\.|[^"\\])*"|[^\s]+)/);
      if (!match) {
        throw new CommandError(`Invalid argument syntax near: ${remaining.slice(0, 20)}`);
      }

      const key = match[1];
      let value = match[2];

      // Decode quoted value
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          throw new CommandError(`Invalid quoted value for ${key}`);
        }
      }

      args[key] = value;
      remaining = remaining.slice(match[0].length).trimStart();
    }

    return args;
  }

  /**
   * Serialize the command back to canonical string form.
   * Format: /commandId key="value" key2="value2" ...
   */
  toString(): string {
    const argParts = Object.entries(this.args)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${this.formatValue(value)}`);
    
    if (argParts.length === 0) {
      return `/${this.commandId}`;
    }
    return `/${this.commandId} ${argParts.join(" ")}`;
  }

  private formatValue(value: string): string {
    // Always quote string values for consistency
    return JSON.stringify(value);
  }
}

export function parseCommand(command: CommandWithArgs): ParsedCommand {
  const metadata = getCommandMetadata(command.commandId);
  if (!metadata?.parser) {
    throw new CommandError(`Unsupported command /${command.commandId}.`);
  }

  return metadata.parser(command);
}

export function extractSlashCommandLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("/"))
    .filter((line) => line.length > 0);
}
