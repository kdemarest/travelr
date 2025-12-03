// /add command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { AddCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdAdd()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    if (!command.args.uid) {
      command.args.uid = ctx.generateUid();
    }
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleAdd(
	command: CommandWithArgs,
	ctx: CommandContext
	): Promise<CommandHandlerResult> {
	return {};
  }

  function parseAdd(command: CommandWithArgs): AddCommand {
	const args = command.args;
	const { activityType, uid: presetUid, ...restFields } = args;
	if (!activityType) {
		throw new CommandError("/add requires activityType=....");
	}

	return { commandId: "add", activityType, fields: restFields, uid: presetUid };
  }

	return { commandId: "add", positionalKey: "activityType", parser: parseAdd, handler: handleAdd, enricher: enrich };
}
registerCommand(cmdAdd());
