// /edit command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { EditCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdEdit()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    if (!command.args.uid && ctx.focusedActivityUid) {
      command.args.uid = ctx.focusedActivityUid;
    }
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleEdit(
	command: CommandWithArgs,
	ctx: CommandContext
	): Promise<CommandHandlerResult> {
	return {};
  }

  function parseEdit(command: CommandWithArgs): EditCommand {
	const { uid, ...changes } = command.args;
	if (!uid) {
		throw new CommandError("/edit requires uid=....");
	}

	if (Object.keys(changes).length === 0) {
		throw new CommandError("/edit requires at least one field to modify.");
	}

	return { commandId: "edit", uid, changes };
  }

	return { commandId: "edit", positionalKey: "uid", parser: parseEdit, handler: handleEdit, enricher: enrich };
}
registerCommand(cmdEdit());
