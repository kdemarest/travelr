import { CommandWithArgs, parseCommand } from "./command.js";
import { TripModel, Alarm, createEmptyTripModel } from "./types.js";
import { generateUid } from "./uid.js";
import { findIsoCodes } from "./iso-codes.js";
import { ensureDefaultCountry } from "./country-defaults.js";
import { Journal, JournalEntry } from "./journal.js";
import { JournalState } from "./journal-state.js";

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize an activity after changes:
 * - When status becomes "booked", set bookingDate if not already set
 */
function normalizeActivity(
  original: Record<string, unknown>,
  updated: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...updated };

  // When status changes to "booked", ensure bookingDate is set
  const wasBooked = original.status === "booked" || original.status === "completed";
  const isNowBooked = result.status === "booked" || result.status === "completed";

  if (!wasBooked && isNowBooked && !result.bookingDate) {
    result.bookingDate = getTodayDate();
  }

  return result;
}

/**
 * Compiles a Journal into a TripModel by applying all active commands.
 */
export class TripModelCompiler {
  /**
   * Compile a journal into a TripModel.
   * @param journal The journal to compile
   * @param atLineNumber Optional line number to compile up to (for historical snapshots)
   */
  compile(journal: Journal, atLineNumber?: number): TripModel {
    const state = JournalState.fromJournal(journal, atLineNumber);
    return state.getActiveEntries().reduce(
      (model, entry) => this.applyCommand(model, entry.command),
      createEmptyTripModel(journal.tripName)
    );
  }

  /**
   * For tests only - exposes applyCommand for unit testing individual command behavior.
   */
  TESTONLY_applyCommand(model: TripModel, command: CommandWithArgs): TripModel {
    return this.applyCommand(model, command);
  }

  private applyCommand(model: TripModel, command: CommandWithArgs): TripModel {
    const parsed = parseCommand(command);
    switch (parsed.commandId) {
      case "newtrip":
        return this.applyNewTrip(parsed);
      case "add":
        return this.applyAdd(model, parsed);
      case "edit":
        return this.applyEdit(model, parsed);
      case "delete":
        return this.applyDelete(model, parsed);
      case "moveday":
        return this.applyMoveDay(model, parsed);
      case "insertday":
        return this.applyInsertDay(model, parsed);
      case "removeday":
        return this.applyRemoveDay(model, parsed);
      case "addcountry":
        return this.applyAddCountry(model, parsed);
      case "setalarm":
        return this.applySetAlarm(model, parsed);
      case "deletealarm":
        return this.applyDeleteAlarm(model, parsed);
      case "enablealarm":
        return this.applyEnableAlarm(model, parsed);
      case "disablealarm":
        return this.applyDisableAlarm(model, parsed);
      case "undo":
      case "redo":
      case "help":
      case "trip":
        return model;
      default:
        return model;
    }
  }

  private applyNewTrip(parsed: { tripId: string }): TripModel {
    return ensureDefaultCountry(createEmptyTripModel(parsed.tripId));
  }

  private applyAdd(model: TripModel, parsed: { uid?: string; activityType: string; fields: Record<string, unknown> }): TripModel {
    const activityUid = parsed.uid ?? generateUid();
    const activity = {
      uid: activityUid,
      activityType: parsed.activityType,
      ...parsed.fields
    };
    return {
      ...model,
      activities: [...model.activities, activity]
    };
  }

  private applyEdit(model: TripModel, parsed: { uid: string; changes: Record<string, unknown> }): TripModel {
    const index = model.activities.findIndex((activity) => activity.uid === parsed.uid);
    if (index === -1) {
      return model;
    }
    const original = model.activities[index];
    const merged = { ...original, ...parsed.changes };
    const updated = normalizeActivity(original, merged);
    const activities = [...model.activities];
    activities[index] = updated;
    return { ...model, activities };
  }

  private applyDelete(model: TripModel, parsed: { uid: string }): TripModel {
    const activities = model.activities.filter((activity) => activity.uid !== parsed.uid);
    if (activities.length === model.activities.length) {
      return model;
    }
    return { ...model, activities };
  }

  private applyMoveDay(model: TripModel, parsed: { from: string; to: string }): TripModel {
    const hasMatches = model.activities.some((activity) => activity.date === parsed.from);
    if (!hasMatches) {
      return model;
    }
    const activities = model.activities.map((activity) =>
      activity.date === parsed.from ? { ...activity, date: parsed.to } : activity
    );
    return { ...model, activities };
  }

  private applyInsertDay(model: TripModel, parsed: { after: string }): TripModel {
    const afterDate = parsed.after;
    const activities = model.activities.map((activity) => {
      if (activity.date && activity.date > afterDate) {
        const newDate = addDays(activity.date, 1);
        return { ...activity, date: newDate };
      }
      return activity;
    });
    return { ...model, activities };
  }

  private applyRemoveDay(model: TripModel, parsed: { date: string }): TripModel {
    const removeDate = parsed.date;
    const activities = model.activities.map((activity) => {
      if (activity.date && activity.date > removeDate) {
        const newDate = addDays(activity.date, -1);
        return { ...activity, date: newDate };
      }
      return activity;
    });
    return { ...model, activities };
  }

  private applyAddCountry(model: TripModel, parsed: { countryName: string; countryAlpha2?: string; currencyAlpha3?: string; exchangeRateToUSD?: number; id?: string }): TripModel {
    const normalizedCountry = parsed.countryName.trim();
    const lookup = !parsed.countryAlpha2 || !parsed.currencyAlpha3 ? findIsoCodes(normalizedCountry) : null;
    const resolvedcountryAlpha2 = (parsed.countryAlpha2 ?? lookup?.countryAlpha2 ?? "").trim().toUpperCase();
    const resolvedcurrencyAlpha3 = (parsed.currencyAlpha3 ?? lookup?.currencyAlpha3 ?? "").trim().toUpperCase();
    if (!resolvedcountryAlpha2 || !resolvedcurrencyAlpha3) {
      return model;
    }

    const existingCountries = model.countries ?? [];
    const countries = [...existingCountries];
    const nextEntry = {
      country: normalizedCountry,
      countryAlpha2: resolvedcountryAlpha2,
      currencyAlpha3: resolvedcurrencyAlpha3,
      exchangeRateToUSD: parsed.exchangeRateToUSD ?? 1,
      id: parsed.id ?? generateUid()
    };

    const normalizedTarget = normalizedCountry.toLowerCase();
    const index = countries.findIndex((entry) => {
      if (parsed.id && entry.id === parsed.id) {
        return true;
      }
      if (entry.countryAlpha2 && entry.countryAlpha2 === nextEntry.countryAlpha2) {
        return true;
      }
      return (entry.country ?? "").trim().toLowerCase() === normalizedTarget;
    });

    if (index >= 0) {
      if (
        countries[index].country === nextEntry.country &&
        countries[index].countryAlpha2 === nextEntry.countryAlpha2 &&
        countries[index].currencyAlpha3 === nextEntry.currencyAlpha3 &&
        countries[index].exchangeRateToUSD === nextEntry.exchangeRateToUSD &&
        countries[index].id === nextEntry.id
      ) {
        return model;
      }
      countries[index] = nextEntry;
    } else {
      countries.push(nextEntry);
    }
    return { ...model, countries };
  }

  private applySetAlarm(model: TripModel, parsed: { uid?: string; activityUid?: string; minutesBefore?: number; date?: string; time?: string; label?: string; location?: string }): TripModel {
    const alarmUid = parsed.uid ?? generateUid();
    const existingAlarms = model.alarms ?? [];

    // For activity-linked alarms, date/time is computed at read time by api-alarms
    // Strip out date/time if activityUid is provided (they would be ignored anyway)
    const isActivityLinked = !!parsed.activityUid;
    if (isActivityLinked && (parsed.date || parsed.time)) {
      console.warn(`[TripModelCompiler] setalarm: Ignoring date/time for activity-linked alarm (activityUid=${parsed.activityUid})`);
    }

    const alarm: Alarm = {
      uid: alarmUid,
      tripId: model.tripId ?? model.tripName,
      activityUid: parsed.activityUid,
      minutesBefore: parsed.minutesBefore ?? (isActivityLinked ? 30 : undefined),
      date: isActivityLinked ? undefined : parsed.date,
      time: isActivityLinked ? undefined : parsed.time,
      label: parsed.label ?? "Alarm",
      location: parsed.location,
      enabled: true
    };

    // Check if alarm with this uid already exists (update) or add new
    const existingIndex = existingAlarms.findIndex(a => a.uid === alarmUid);
    let alarms: Alarm[];
    if (existingIndex >= 0) {
      alarms = [...existingAlarms];
      alarms[existingIndex] = alarm;
    } else {
      alarms = [...existingAlarms, alarm];
    }

    return { ...model, alarms };
  }

  private applyDeleteAlarm(model: TripModel, parsed: { uid: string }): TripModel {
    const existingAlarms = model.alarms ?? [];
    const alarms = existingAlarms.filter(a => a.uid !== parsed.uid);
    if (alarms.length === existingAlarms.length) {
      return model;
    }
    return { ...model, alarms };
  }

  private applyEnableAlarm(model: TripModel, parsed: { uid: string }): TripModel {
    const existingAlarms = model.alarms ?? [];
    const index = existingAlarms.findIndex(a => a.uid === parsed.uid);
    if (index < 0) {
      return model;
    }
    const alarms = [...existingAlarms];
    alarms[index] = { ...alarms[index], enabled: true };
    return { ...model, alarms };
  }

  private applyDisableAlarm(model: TripModel, parsed: { uid: string }): TripModel {
    const existingAlarms = model.alarms ?? [];
    const index = existingAlarms.findIndex(a => a.uid === parsed.uid);
    if (index < 0) {
      return model;
    }
    const alarms = [...existingAlarms];
    alarms[index] = { ...alarms[index], enabled: false };
    return { ...model, alarms };
  }
}

/** Singleton instance for convenience */
export const tripModelCompiler = new TripModelCompiler();
