// /deletealarm command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { DeleteAlarmCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdDeletealarm()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }
  async function handleDeletealarm(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseDeleteAlarm(command: CommandWithArgs): DeleteAlarmCommand {
    const uid = command.args.uid?.trim();
    if (!uid) {
      throw new CommandError("/deletealarm requires uid=...");
    }
    return { commandId: "deletealarm", uid };
  }

  return { commandId: "deletealarm", positionalKey: "uid", parser: parseDeleteAlarm, handler: handleDeletealarm, enricher: enrich };
}
registerCommand(cmdDeletealarm());
