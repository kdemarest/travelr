import { registerCommand } from "./command-registry.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdHelp()
{
  function buildHelpMessage(): string {
    return [
      "Available slash commands:",
      "",
      "/help - Show this list.",
      '/newtrip tripId="<id>" - Required: tripId (letters, numbers, _ or -). Creates or resets the trip.',
      '/add activityType=<flight|lodging|rentalCar|transport|visit|meal|hike> field="value" ... - Required: activityType plus at least one additional field (name=, date=, etc.).',
      '/edit uid=<activity-uid> field="value" ... - Required: uid and at least one field to update. Values use key=value syntax; wrap spaces in quotes.',
      '/delete uid=<activity-uid> - Removes the activity from the trip.',
      '/trip [tripId] - Without args lists known trips; with tripId it loads that trip for editing.',
      '/model [modelName] - Without args lists supported GPT models; with modelName switches the active model.',
      '/websearch query="search" - Performs a background web search (results currently hidden).',
      '/userpref anyKey="value" - Updates the stored user preferences; accepts any key name (value may be JSON).'
    ].join("\n");
  }

  function handleHelp(
    _command: CommandWithArgs,
    _ctx: CommandContext
  ): CommandHandlerResult {
    return {
      message: buildHelpMessage()
    };
  }

  return { commandId: "help", parser: (_cmd: CommandWithArgs) => ({ commandId: "help" as const }), handler: handleHelp };
}
registerCommand(cmdHelp());
