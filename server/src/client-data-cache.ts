/**
 * ClientDataCache - Server-side cache of data to send to the client.
 * 
 * Paired with each User record in memory. Any code can write to it:
 *   user.clientDataCache.set("trips", tripsList);
 * 
 * When dirty, the cache is included in the next response to that user.
 * The client completely replaces its local cache with what's received.
 */

export type ClientDataCacheData = Record<string, unknown>;

export class ClientDataCache {
  private data: ClientDataCacheData = {};
  private lastSentData: string = "{}";
  private dirty = false;

  /**
   * Set a value in the cache. Marks dirty if the value differs from current.
   */
  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.checkDirty();
  }

  /**
   * Remove a key from the cache.
   */
  delete(key: string): void {
    delete this.data[key];
    this.checkDirty();
  }

  /**
   * Get the current cache data (for sending to client).
   * Clears the dirty flag and remembers what was sent.
   */
  getData(): ClientDataCacheData {
    this.lastSentData = JSON.stringify(this.data);
    this.dirty = false;
    return { ...this.data };
  }

  /**
   * Check if the cache has changed since last sent.
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Compare current data to last sent and update dirty flag.
   */
  private checkDirty(): void {
    const currentJson = JSON.stringify(this.data);
    if (currentJson !== this.lastSentData) {
      this.dirty = true;
    }
  }
}
