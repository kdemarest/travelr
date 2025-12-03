import type { MarkCommand } from "./command.js";
import { registerCommand } from "./command-registry.js";
import { CommandError } from "./errors.js";
import { CommandWithArgs } from "./command.js";


function cmdMark()
{
  function parseMark(command: CommandWithArgs): MarkCommand {
    const args = command.args;
    const markType = (args.commandId?.toLowerCase() ?? "activities") as "activities" | "dates";
    
    if (markType !== "activities" && markType !== "dates") {
      throw new CommandError("/mark type must be \"activities\" or \"dates\".");
    }
    
    const addStr = args.add ?? "";
    const removeStr = args.remove ?? "";
    
    if (!addStr && !removeStr) {
      throw new CommandError("/mark requires at least one of add=\"...\" or remove=\"...\".");
    }
    
    const add = addStr ? addStr.split(/\s+/).filter(Boolean) : [];
    const remove = removeStr ? removeStr.split(/\s+/).filter(Boolean) : [];
    
    return { commandId: "mark", markType, add, remove };
  }

  return { commandId: "mark", parser: parseMark };
}
registerCommand(cmdMark());

export interface MarkResult {
  markedActivities: string[];
  markedDates: string[];
}

/**
 * Execute a /mark command by updating the marked arrays.
 * Returns the new state of both arrays.
 */
export function executeMarkCommand(
  command: MarkCommand,
  currentActivities: string[],
  currentDates: string[]
): MarkResult {
  const isActivities = command.markType === "activities";
  
  // Work with the appropriate array
  const currentSet = new Set(isActivities ? currentActivities : currentDates);
  
  // Add items
  for (const item of command.add) {
    currentSet.add(item);
  }
  
  // Remove items
  for (const item of command.remove) {
    currentSet.delete(item);
  }
  
  const updated = Array.from(currentSet);
  
  return {
    markedActivities: isActivities ? updated : currentActivities,
    markedDates: isActivities ? currentDates : updated
  };
}
