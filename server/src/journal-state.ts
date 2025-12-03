
import { TripModel } from "./types.js";
import { Trip } from "./trip.js";
import { Journal, JournalEntry } from "./journal.js";
import { TripModelSnapshot } from "./trip-model-snapshot.js";
import { CommandWithArgs, parseCommand } from "./command.js";

/**
 * Build a TripModel by reducing journal entries.
 * Trip must be loaded before calling this.
 */
export function rebuildModel(trip: Trip): TripModel {
  return new TripModelSnapshot(trip.journal).getModel();
}

// Re-export JournalEntry from journal.js for backward compatibility
export type { JournalEntry } from "./journal.js";

export class JournalState {
  private readonly entries: JournalEntry[];
  private readonly orderedIndexes: number[];
  private head: number;
  private readonly total: number;

  private get activeIndexes(): number[] {
    return this.head === 0 ? [] : this.orderedIndexes.slice(0, this.head);
  }

  constructor(entries: JournalEntry[]) {
    this.entries = entries;
    const order: number[] = [];
    let head = 0;

    this.entries.forEach((entry, index) => {
      const parsed = parseCommand(entry.command);
      switch (parsed.commandId) {
        case "undo": {
          const steps = (parsed as { count: number }).count;
          head = Math.max(0, head - steps);
          break;
        }
        case "redo": {
          const steps = (parsed as { count: number }).count;
          head = Math.min(order.length, head + steps);
          break;
        }
        default: {
          if (head < order.length) {
            order.splice(head);
          }
          order.push(index);
          head = order.length;
          break;
        }
      }
    });

    this.orderedIndexes = order.slice();
    this.head = head;
    this.total = this.orderedIndexes.length;
  }

  static fromJournal(journal: Journal, atLineNumber: number = Number.MAX_SAFE_INTEGER): JournalState {
    const allEntries = journal.getEntries();
    const entries = allEntries.filter(e => e.lineNumber <= atLineNumber);
    return new JournalState(entries);
  }

  getActiveEntries(): JournalEntry[] {
    return this.activeIndexes.map((entryIndex) => this.entries[entryIndex]);
  }

  undo(count: number): CommandWithArgs[] {
    const prevHead = this.head;
    const nextHead = Math.max(0, prevHead - count);
    if (nextHead === prevHead) {
      return [];
    }
    const commands = this.getCommandsInRange(nextHead, prevHead);
    this.head = nextHead;
    return commands;
  }

  redo(count: number): CommandWithArgs[] {
    const prevHead = this.head;
    const nextHead = Math.min(this.total, prevHead + count);
    if (nextHead === prevHead) {
      return [];
    }
    const commands = this.getCommandsInRange(prevHead, nextHead);
    this.head = nextHead;
    return commands;
  }

  private getCommandsInRange(start: number, end: number): CommandWithArgs[] {
    if (start >= end) {
      return [];
    }
    const commands: CommandWithArgs[] = [];
    for (let position = start; position < end && position < this.orderedIndexes.length; position += 1) {
      const entryIndex = this.orderedIndexes[position];
      const entry = this.entries[entryIndex];
      if (entry) {
        commands.push(entry.command);
      }
    }
    return commands;
  }
}
