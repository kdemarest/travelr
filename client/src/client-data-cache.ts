/**
 * ClientDataCache - Client-side cache of server-provided data.
 * 
 * When the server includes `clientDataCache` in a response, the client
 * completely replaces its local cache with what was sent.
 * 
 * Usage:
 *   import { clientDataCache } from "./client-data-cache";
 *   
 *   // Access cached data
 *   const trips = clientDataCache.get("trips") as string[];
 *   
 *   // Update from server response
 *   if (response.clientDataCache) {
 *     clientDataCache.update(response.clientDataCache);
 *   }
 */

export type ClientDataCacheData = Record<string, unknown>;

class ClientDataCacheImpl {
  private data: ClientDataCacheData = {};

  /**
   * Get a value from the cache.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return key in this.data;
  }

  /**
   * Get all cached data (for debugging or iteration).
   */
  getAll(): ClientDataCacheData {
    return { ...this.data };
  }

  /**
   * Completely replace the cache with new data from the server.
   */
  update(newData: ClientDataCacheData): void {
    this.data = { ...newData };
    console.log("[clientDataCache] Updated with keys:", Object.keys(this.data));
  }

  /**
   * Clear the cache (e.g., on logout).
   */
  clear(): void {
    this.data = {};
  }
}

// Singleton instance
export const clientDataCache = new ClientDataCacheImpl();
