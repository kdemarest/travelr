// /disablealarm command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { DisableAlarmCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdDisablealarm()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    command.args.lineNum = String(ctx.getNextLineNumber());
  }
  async function handleDisablealarm(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseDisableAlarm(command: CommandWithArgs): DisableAlarmCommand {
    const uid = command.args.uid?.trim();
    if (!uid) {
      throw new CommandError("/disablealarm requires uid=...");
    }
    return { commandId: "disablealarm", uid };
  }

  return { commandId: "disablealarm", positionalKey: "uid", parser: parseDisableAlarm, handler: handleDisablealarm, enricher: enrich };
}
registerCommand(cmdDisablealarm());
