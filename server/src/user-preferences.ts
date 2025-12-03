/**
 * Per-user preferences with LazyFile caching.
 * 
 * Each user gets their own prefs file: dataUserPrefs/<userId>-prefs.json
 * On first login, the default-prefs.json is copied to create their file.
 * 
 * The LazyFile is loaded during authentication and attached to the User object.
 */

import fs from "node:fs";
import path from "node:path";
import { LazyFile } from "./lazy-file.js";
import { Paths } from "./data-paths.js";

const PREFS_DIR = Paths.dataUserPrefs;
const DEFAULT_PREFS_PATH = path.join(PREFS_DIR, "default-prefs.json");

export type UserPreferences = Record<string, unknown>;

// JSON helpers
const parseJson = (text: string): UserPreferences => JSON.parse(text);
const toJson = (data: UserPreferences): string => JSON.stringify(data, null, 2) + "\n";

// Cache of loaded user preference files
const userPrefsCache = new Map<string, LazyFile<UserPreferences>>();

/**
 * Get the path to a user's preferences file.
 */
function getUserPrefsPath(userId: string): string {
  return path.join(PREFS_DIR, `${userId}-prefs.json`);
}

/**
 * Load default preferences from disk.
 */
function loadDefaultPreferences(): UserPreferences {
  try {
    const text = fs.readFileSync(DEFAULT_PREFS_PATH, "utf-8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Ensure a user's prefs file exists, copying from defaults if needed.
 * Returns the LazyFile for that user's preferences.
 * Called during authentication to attach prefs to the User object.
 */
export function ensureUserPrefsFile(userId: string): LazyFile<UserPreferences> {
  // Check cache first
  const cached = userPrefsCache.get(userId);
  if (cached) {
    return cached;
  }

  const userPrefsPath = getUserPrefsPath(userId);

  // If user's prefs file doesn't exist, copy from defaults
  if (!fs.existsSync(userPrefsPath)) {
    const defaults = loadDefaultPreferences();
    fs.mkdirSync(PREFS_DIR, { recursive: true });
    fs.writeFileSync(userPrefsPath, toJson(defaults), "utf-8");
    console.log(`[user-preferences] Created prefs file for user: ${userId}`);
  }

  // Create and load the LazyFile
  const lazyFile = new LazyFile<UserPreferences>(
    userPrefsPath,
    {},
    parseJson,
    toJson
  );
  lazyFile.load();

  // Cache it
  userPrefsCache.set(userId, lazyFile);

  return lazyFile;
}

/**
 * Flush all pending user preference writes.
 * Call on shutdown.
 */
export function flushUserPreferences(): void {
  for (const [userId, lazyFile] of userPrefsCache) {
    if (lazyFile.hasPendingWrite()) {
      console.log(`[user-preferences] Flushing prefs for user: ${userId}`);
      lazyFile.flush();
    }
  }
}
