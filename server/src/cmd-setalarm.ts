// /setalarm command handler
import { registerCommand, type EnrichContext } from "./command-registry.js";
import { DATE_PATTERN, TIME_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { SetAlarmCommand } from "./command-types.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdSetalarm()
{
  function enrich(command: CommandWithArgs, ctx: EnrichContext): void {
    if (!command.args.uid) {
      command.args.uid = ctx.generateUid();
    }
    command.args.lineNum = String(ctx.getNextLineNumber());
  }

  async function handleSetalarm(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    return {};
  }

  function parseSetAlarm(command: CommandWithArgs): SetAlarmCommand {
    const args = command.args;
    
    const uid = args.uid?.trim();
    const activityUid = args.activityUid?.trim();
    const date = args.date?.trim();
    const time = args.time?.trim();
    const label = args.label?.trim();
    const location = args.location?.trim();
    
    // Parse minutesBefore
    let minutesBefore: number | undefined;
    const rawMinutes = args.minutesBefore ?? args.minutes ?? args.before;
    if (rawMinutes !== undefined) {
      const parsed = Number(rawMinutes);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new CommandError("minutesBefore must be a non-negative number.");
      }
      minutesBefore = parsed;
    }
    
    // Validate: must have either activityUid OR (date + time)
    if (!activityUid && !date && !time) {
      throw new CommandError("/setalarm requires either activityUid= or date= and time=");
    }
    
    // Validate date format if provided
    if (date && !DATE_PATTERN.test(date)) {
      throw new CommandError(`Invalid date "${date}". Must be YYYY-MM-DD format.`);
    }
    
    // Validate time format if provided
    if (time && !TIME_PATTERN.test(time)) {
      throw new CommandError(`Invalid time "${time}". Must be HH:MM format.`);
    }
    
    return {
      commandId: "setalarm",
      uid,
      activityUid,
      minutesBefore,
      date,
      time,
      label,
      location
    };
  }

  return { commandId: "setalarm", parser: parseSetAlarm, handler: handleSetalarm, enricher: enrich };
}
registerCommand(cmdSetalarm());
