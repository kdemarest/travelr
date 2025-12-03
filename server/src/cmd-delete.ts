// /delete command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { DeleteCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdDelete()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    if (!command.args.uid && ctx.focusedActivityUid) {
      command.args.uid = ctx.focusedActivityUid;
    }
    
    // Copy activity details into command for undo capability
    const activity = ctx.lookupActivity(command.args.uid);
    if (activity) {
      for (const [key, value] of Object.entries(activity)) {
        if (key !== "uid" && value !== undefined && value !== null) {
          command.args[key] = String(value);
        }
      }
    }
    
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleDelete(
	command: CommandWithArgs,
	ctx: CommandContext
	): Promise<CommandHandlerResult> {
	return {};
  }

  function parseDelete(command: CommandWithArgs): DeleteCommand {
	const args = command.args;
	const uid = args.uid;
	if (!uid) {
		throw new CommandError("/delete requires uid=....");
	}
	return { commandId: "delete", uid };
  }

	return { commandId: "delete", positionalKey: "uid", parser: parseDelete, handler: handleDelete, enricher: enrich };
}
registerCommand(cmdDelete());
