import { Journal } from "./journal.js";
import { tripModelCompiler } from "./trip-model-compiler.js";
import { TripModel } from "./types.js";

/**
 * An immutable, cached view of a journal's TripModel at a specific line number.
 * 
 * A snapshot is like a photo - once created, it always returns the same model.
 * Create a new snapshot if you need a different position.
 */
export class TripModelSnapshot {
  private readonly journal: Journal;
  private readonly atLineNumber: number;
  private cachedModel: TripModel | null = null;

  /**
   * Create a snapshot of the journal at a specific line number.
   * @param journal The journal to snapshot
   * @param atLineNumber The line number to snapshot at (defaults to latest)
   */
  constructor(journal: Journal, atLineNumber?: number) {
    this.journal = journal;
    this.atLineNumber = atLineNumber ?? Number.MAX_SAFE_INTEGER;
  }

  /**
   * Get the TripModel at this snapshot's line number.
   * Result is cached - subsequent calls return the same model.
   */
  getModel(): TripModel {
    if (this.cachedModel) {
      return this.cachedModel;
    }

    this.cachedModel = tripModelCompiler.compile(this.journal, this.atLineNumber);
    return this.cachedModel;
  }

  /**
   * The line number this snapshot is frozen at.
   */
  get lineNumber(): number {
    return this.atLineNumber;
  }
}
