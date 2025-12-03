import type { ParsedCommand } from "./command-types.js";
import type { CommandHandler } from "./command-context.js";
import type { CommandWithArgs } from "./command.js";

export type CommandParser = (command: CommandWithArgs) => ParsedCommand;

/** Context available during command enrichment */
export interface EnrichContext {
  focusedActivityUid: string | undefined;
  getNextLineNumber: () => number;
  lookupActivity: (uid: string) => Record<string, unknown> | undefined;
  generateUid: () => string;
}

/** Enricher function that mutates command.args before processing */
export type CommandEnricher = (command: CommandWithArgs, ctx: EnrichContext) => void | Promise<void>;

export interface CommandMetadata {
  commandId: string;
  positionalKey?: string;
  adminOnly?: boolean;
  parser?: CommandParser;
  handler?: CommandHandler;
  enricher?: CommandEnricher;
}

const registry: CommandMetadata[] = [];
const byCommandId = new Map<string, CommandMetadata>();

export function registerCommand(metadata: CommandMetadata): void {
  registry.push(metadata);
  byCommandId.set(metadata.commandId, metadata);
}

export function getCommandMetadata(commandId: string): CommandMetadata | undefined {
  return byCommandId.get(commandId);
}
