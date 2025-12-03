// /insertday command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { DATE_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { InsertDayCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdInsertday()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleInsertday(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseInsertDay(command: CommandWithArgs): InsertDayCommand {
    const after = command.args.after?.trim();
    if (!after) {
      throw new CommandError("/insertday requires after=\"YYYY-MM-DD\"");
    }
    if (!DATE_PATTERN.test(after)) {
      throw new CommandError(`Invalid date "${after}". Must be YYYY-MM-DD format.`);
    }
    return { commandId: "insertday", after };
  }

  return { commandId: "insertday", parser: parseInsertDay, handler: handleInsertday, enricher: enrich };
}
registerCommand(cmdInsertday());
