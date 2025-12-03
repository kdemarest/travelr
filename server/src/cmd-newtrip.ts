// /newtrip command handler
import { registerCommand } from "./command-registry.js";
import { TRIP_ID_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { NewTripCommand } from "./command-types.js";
import type { CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdNewtrip()
{
  async function handleNewtrip(
    command: CommandWithArgs,
  ): Promise<CommandHandlerResult> {
    const parsed = parseNewTrip(command);
    
    // Return switchTrip to signal the command loop to create and switch to this trip
    // The actual trip creation, lastTripId update, and tripList population happen in the loop
    return {
      switchTrip: { tripId: parsed.tripId, create: true }
    };
  }

  function parseNewTrip(command: CommandWithArgs): NewTripCommand {
    const tripId = command.args.tripId;
    if (!tripId) {
      throw new CommandError("/newtrip requires tripId=\"...\".");
    }

    if (!TRIP_ID_PATTERN.test(tripId)) {
      throw new CommandError("tripId may only contain letters, numbers, underscore, or dash.");
    }

    return { commandId: "newtrip", tripId };
  }

  return { commandId: "newtrip", positionalKey: "tripId", parser: parseNewTrip, handler: handleNewtrip };
}
registerCommand(cmdNewtrip());
