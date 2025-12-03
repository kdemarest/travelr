// /redo command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { RedoCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { JournalState } from "./journal-state.js";
import { CommandWithArgs } from "./command.js";


function cmdRedo()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  function formatUndoRedoMessage(action: "undo" | "redo", commands: CommandWithArgs[]): string {
    const prefix = action === "undo" ? "Undid" : "Redid";
    if (commands.length === 0) {
      return `${prefix} 0 commands.`;
    }
    const serialized = commands.map((command) => command.toString()).join("; ");
    const detail = serialized ? `: ${serialized}` : ".";
    return `${prefix} ${commands.length} command${commands.length === 1 ? "" : "s"}${detail}`;
  }

  function handleRedo(
    command: CommandWithArgs,
    ctx: CommandContext
  ): CommandHandlerResult {
    const parsed = parseRedo(command);
    const journalState = JournalState.fromJournal(ctx.trip.journal);
    const redoneCommands = journalState.redo(parsed.count);
    if (redoneCommands.length === 0) {
      return { skipJournal: true, message: "Nothing to redo." };
    }
    return { message: formatUndoRedoMessage("redo", redoneCommands) };
  }

  function parseRedo(command: CommandWithArgs): RedoCommand {
    const rawCount = command.args.count ?? command.args.steps;
    if (!rawCount) {
      return { commandId: "redo", count: 1 };
    }

    const count = Number(rawCount);
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
      throw new CommandError("/redo requires a positive integer count.");
    }
    return { commandId: "redo", count };
  }

  return { commandId: "redo", positionalKey: "count", parser: parseRedo, handler: handleRedo, enricher: enrich };
}
registerCommand(cmdRedo());
