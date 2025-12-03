// /intent command handler
import { registerCommand } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { IntentCommand } from "./command-types.js";
import { CommandWithArgs } from "./command.js";


function cmdIntent()
{
  function parseIntent(command: CommandWithArgs): IntentCommand {
    const what = command.args.what?.trim();
    if (!what) {
      throw new CommandError("/intent requires what=\"...\"");
    }
    return { commandId: "intent", what };
  }

  return { commandId: "intent", parser: parseIntent };
}
registerCommand(cmdIntent());
