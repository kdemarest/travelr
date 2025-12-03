// /undo command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { UndoCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { JournalState } from "./journal-state.js";
import { CommandWithArgs } from "./command.js";


function cmdUndo()
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

  function handleUndo(
    command: CommandWithArgs,
    ctx: CommandContext
  ): CommandHandlerResult {
    const parsed = parseUndo(command);
    const journalState = JournalState.fromJournal(ctx.trip.journal);
    const undoneCommands = journalState.undo(parsed.count);
    if (undoneCommands.length === 0) {
      return { skipJournal: true, message: "Nothing to undo." };
    }
    return { message: formatUndoRedoMessage("undo", undoneCommands) };
  }

  function parseUndo(command: CommandWithArgs): UndoCommand {
    const rawCount = command.args.count ?? command.args.steps;
    if (!rawCount) {
      return { commandId: "undo", count: 1 };
    }

    const count = Number(rawCount);
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
      throw new CommandError("/undo requires a positive integer count.");
    }
    return { commandId: "undo", count };
  }

  return { commandId: "undo", positionalKey: "count", parser: parseUndo, handler: handleUndo, enricher: enrich };
}
registerCommand(cmdUndo());
