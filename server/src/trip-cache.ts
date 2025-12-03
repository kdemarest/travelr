/**
 * TripCache - Unified cache for all per-trip data.
 * 
 * Owns the concept of "which trips exist". Provides access to
 * Trip instances which own their journal and conversation.
 */

import path from "node:path";
import fs from "fs-extra";
import { Trip } from "./trip.js";

let globalTripCache: TripCache | null = null;

export function getTripCache(): TripCache {
  if (!globalTripCache) {
    throw new Error("TripCache not initialized. Call initTripCache first.");
  }
  return globalTripCache;
}

export function initTripCache(dataDir: string): TripCache {
  globalTripCache = new TripCache(dataDir);
  return globalTripCache;
}

export class TripCache {
  private trips = new Map<string, Trip>();
  
  constructor(private readonly dataDir: string) {}
  
  private getJournalPath(tripName: string): string {
    return path.join(this.dataDir, `${tripName}.travlrjournal`);
  }
  
  private getConversationPath(tripName: string): string {
    return path.join(this.dataDir, `${tripName}.conversation`);
  }
  
  // ========== Trip-level operations ==========
  
  /**
   * List all trips (by scanning for .travlrjournal files).
   */
  async listTrips(): Promise<string[]> {
    const entries = await fs.readdir(this.dataDir);
    return entries
      .filter((entry) => entry.endsWith(".travlrjournal"))
      .map((entry) => path.basename(entry, ".travlrjournal"))
      .sort((a, b) => a.localeCompare(b));
  }
  
  /**
   * Check if a trip exists.
   */
  async tripExists(tripName: string): Promise<boolean> {
    return fs.pathExists(this.getJournalPath(tripName));
  }
  
  /**
   * Get a Trip instance. Creates and loads it if not cached.
   */
  async getTrip(tripName: string): Promise<Trip> {
    let trip = this.trips.get(tripName);
    if (!trip) {
      trip = new Trip(
        tripName,
        this.getJournalPath(tripName),
        this.getConversationPath(tripName)
      );
      await trip.load();
      this.trips.set(tripName, trip);
    }
    return trip;
  }
  
  // ========== Lifecycle ==========
  
  async flushAllTrips(): Promise<void> {
    const flushPromises = Array.from(this.trips.values()).map(t => t.flush());
    await Promise.all(flushPromises);
  }
}
