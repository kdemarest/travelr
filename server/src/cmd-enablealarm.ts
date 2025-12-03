// /enablealarm command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { EnableAlarmCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdEnablealarm()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }
  async function handleEnablealarm(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseEnableAlarm(command: CommandWithArgs): EnableAlarmCommand {
    const uid = command.args.uid?.trim();
    if (!uid) {
      throw new CommandError("/enablealarm requires uid=...");
    }
    return { commandId: "enablealarm", uid };
  }

  return { commandId: "enablealarm", positionalKey: "uid", parser: parseEnableAlarm, handler: handleEnablealarm, enricher: enrich };
}
registerCommand(cmdEnablealarm());
