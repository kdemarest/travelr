import type { LazyFile } from "./lazy-file.js";
import type { UserPreferences } from "./user-preferences.js";
import type { ClientDataCache } from "./client-data-cache.js";

/**
 * Authenticated user info.
 */
export interface User {
  userId: string;
  isAdmin: boolean;
  prefs: LazyFile<UserPreferences>;
  clientDataCache: ClientDataCache;
}
