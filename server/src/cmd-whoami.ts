// /whoami command handler
import { registerCommand } from "./command-registry.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdWhoami()
{
  function handleWhoami(
    _command: CommandWithArgs,
    ctx: CommandContext
  ): CommandHandlerResult {
    const adminStatus = ctx.user.isAdmin ? "Yes" : "No";
    const tripInfo = ctx.trip ? `Current trip: ${ctx.trip.name}` : "No trip loaded";
    
    return {
      message: `User: ${ctx.user.userId}\nAdmin: ${adminStatus}\n${tripInfo}`
    };
  }

  return { commandId: "whoami", parser: (_cmd: CommandWithArgs) => ({ commandId: "whoami" as const }), handler: handleWhoami };
}
registerCommand(cmdWhoami());
