// /refreshcountries command handler
import { refreshCountryCatalog } from "./refresh-countries.js";
import { registerCommand } from "./command-registry.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdRefreshcountries()
{
  async function handleRefreshcountries(
    _command: CommandWithArgs,
    _ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    console.log("Handling /refreshcountries command");

    try {
      const summary = await refreshCountryCatalog();
      const message = `Updated ${summary.updated} countries, added ${summary.added}.`;
      return { message };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Country refresh failed.";
      return {
        message,
        stopProcessingCommands: true
      };
    }
  }

  return { commandId: "refreshcountries", adminOnly: true, parser: (_cmd: CommandWithArgs) => ({ commandId: "refreshcountries" as const }), handler: handleRefreshcountries };
}
registerCommand(cmdRefreshcountries());
