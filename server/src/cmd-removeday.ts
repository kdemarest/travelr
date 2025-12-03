// /removeday command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { DATE_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { RemoveDayCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdRemoveday()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleRemoveday(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseRemoveDay(command: CommandWithArgs): RemoveDayCommand {
    const date = command.args.date?.trim();
    if (!date) {
      throw new CommandError("/removeday requires date=\"YYYY-MM-DD\"");
    }
    if (!DATE_PATTERN.test(date)) {
      throw new CommandError(`Invalid date "${date}". Must be YYYY-MM-DD format.`);
    }
    return { commandId: "removeday", date };
  }

  return { commandId: "removeday", parser: parseRemoveDay, handler: handleRemoveday, enricher: enrich };
}
registerCommand(cmdRemoveday());
