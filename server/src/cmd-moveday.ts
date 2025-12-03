// /moveday command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { DATE_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { MoveDayCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdMoveday()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleMoveday(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseMoveDay(command: CommandWithArgs): MoveDayCommand {
    const from = command.args.from?.trim();
    const to = command.args.to?.trim();
    
    if (!from) {
      throw new CommandError("/moveday requires from=\"YYYY-MM-DD\"");
    }
    if (!to) {
      throw new CommandError("/moveday requires to=\"YYYY-MM-DD\"");
    }
    if (!DATE_PATTERN.test(from)) {
      throw new CommandError(`Invalid from date "${from}". Must be YYYY-MM-DD format.`);
    }
    if (!DATE_PATTERN.test(to)) {
      throw new CommandError(`Invalid to date "${to}". Must be YYYY-MM-DD format.`);
    }
    
    return { commandId: "moveday", from, to };
  }

  return { commandId: "moveday", parser: parseMoveDay, handler: handleMoveday, enricher: enrich };
}
registerCommand(cmdMoveday());
