/**
 * Simple authentication module with multi-device support.
 * 
 * - users.json: { userId: { password, isAdmin } } pairs
 * - auths.json: { userId: { deviceId: { authKey, label, city, firstSeen, lastSeen } } }
 * 
 * Auth flow:
 * 1. Client tries GET /auth?userId=X&deviceId=Y&authKey=Z (cached key)
 * 2. If no cached key or invalid, client POSTs /auth with { userId, password, deviceId, deviceInfo }
 * 3. On success, server returns { authKey } which client stores in localStorage
 * 4. All API requests include authKey, userId, and deviceId in headers
 */

import path from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { LazyFile } from "./lazy-file.js";
import type { User } from "./user.js";
import { ensureUserPrefsFile } from "./user-preferences.js";
import { ClientDataCache } from "./client-data-cache.js";
import { Paths } from "./data-paths.js";

const USERS_FILE = path.join(Paths.dataUsers, "users.json");
const AUTHS_FILE = path.join(Paths.dataUsers, "auths.json");
const USER_STATE_FILE = path.join(Paths.dataUsers, "userState.json");

// Per-user state (survives across devices)
interface UserState {
  lastTripId?: string;
}
type UserStateFile = Record<string, UserState>;

interface UserEntry {
  password: string;
  isAdmin?: boolean;
}

interface DeviceAuth {
  authKey: string;
  label: string;
  city: string;
  firstSeen: string;
  lastSeen: string;
}

type UsersFile = Record<string, UserEntry | string>;  // Support both old and new format
type UserAuths = Record<string, DeviceAuth>;  // deviceId -> DeviceAuth
type AuthsFile = Record<string, UserAuths>;   // userId -> UserAuths

// JSON helpers
const parseJson = <T>(text: string): T => JSON.parse(text);
const toJson = <T>(data: T): string => JSON.stringify(data, null, 2);

// LazyFile instances for each data file
const usersFile = new LazyFile<UsersFile>(USERS_FILE, {}, parseJson, toJson);
const authsFile = new LazyFile<AuthsFile>(AUTHS_FILE, {}, parseJson, toJson);
const userStateFile = new LazyFile<UserStateFile>(USER_STATE_FILE, {}, parseJson, toJson);

/**
 * Initialize the auth module. Call once at startup.
 */
export function initAuth(): void {
  usersFile.load();
  authsFile.load();
  userStateFile.load();
}

/**
 * Flush all pending writes. Call on shutdown.
 */
export function flushAuth(): void {
  usersFile.flush();
  authsFile.flush();
  userStateFile.flush();
}

// Get password for a user (handles both old string format and new object format)
function getUserPassword(users: UsersFile, userId: string): string | null {
  const entry = users[userId];
  if (!entry) return null;
  if (typeof entry === "string") return entry;  // Old format
  return entry.password;  // New format
}

// Check if user is admin
function isUserAdmin(users: UsersFile, userId: string): boolean {
  const entry = users[userId];
  if (!entry) return false;
  if (typeof entry === "string") return false;  // Old format = not admin
  return entry.isAdmin === true;
}

// Export for use in admin routes
export function checkIsAdmin(userId: string): boolean {
  return isUserAdmin(usersFile.data, userId);
}

// Generate a random auth key
function generateAuthKey(): string {
  return "auth-" + randomBytes(32).toString("hex");
}

/**
 * Get the last trip ID for a user.
 */
export function getLastTripId(userId: string): string | null {
  const state = userStateFile.data;
  return state[userId]?.lastTripId ?? null;
}

/**
 * Set the last trip ID for a user.
 * Only marks dirty if the value actually changed.
 */
export function setLastTripId(userId: string, tripId: string): void {
  const state = userStateFile.data;
  
  // Only mark dirty if the value is different
  if (state[userId]?.lastTripId === tripId) {
    return;
  }
  
  if (!state[userId]) {
    state[userId] = {};
  }
  state[userId].lastTripId = tripId;
  userStateFile.setDirty(state);
}

// ============================================================================
// Password Hashing (scrypt)
// ============================================================================

/**
 * Hash a password using scrypt. Returns "salt:hash" format.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
    });
  });
}

// Get current date as ISO string (date only)
function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Lookup city from IP address using ip-api.com (free, no key needed)
 */
async function lookupCity(ip: string): Promise<string> {
  // Skip lookup for localhost/private IPs
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return "localhost";
  }
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json() as { city?: string; country?: string };
      if (data.city) {
        return data.country ? `${data.city}, ${data.country}` : data.city;
      }
    }
  } catch {
    // Ignore lookup failures
  }
  return "unknown";
}

/**
 * Validate a username/password combination.
 * Returns an authKey if valid, null if invalid.
 */
export async function login(
  userId: string, 
  password: string, 
  deviceId: string, 
  deviceInfo: string,
  ip: string
): Promise<string | null> {
  const users = usersFile.data;
  const storedHash = getUserPassword(users, userId);
  
  if (!storedHash) {
    return null;
  }
  
  const isValid = await verifyPassword(password, storedHash);
  if (!isValid) {
    return null;
  }
  
  // Ensure deviceId has proper prefix
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  
  // Lookup city from IP
  const city = await lookupCity(ip);
  
  // Generate and store auth key
  const authKey = generateAuthKey();
  const auths = authsFile.data;
  
  if (!auths[userId]) {
    auths[userId] = {};
  }
  
  const now = today();
  auths[userId][deviceId] = {
    authKey,
    label: deviceInfo || "unknown device",
    city,
    firstSeen: auths[userId][deviceId]?.firstSeen || now,
    lastSeen: now
  };
  
  authsFile.setDirty(auths);
  
  return authKey;
}

/**
 * Authentication result from authenticateAndFetchUser.
 */
export interface AuthResult {
  valid: boolean;
  user: User | null;
}

/**
 * Validate an existing authKey and return the authenticated user.
 * Also updates lastSeen on successful auth.
 */
export function authenticateAndFetchUser(userId: string, deviceId: string, authKey: string): AuthResult {
  if (!userId || !deviceId || !authKey) {
    return { valid: false, user: null };
  }
  
  // Ensure proper prefixes
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  if (!authKey.startsWith("auth-")) {
    return { valid: false, user: null };
  }
  
  const auths = authsFile.data;
  const deviceAuth = auths[userId]?.[deviceId];
  
  if (deviceAuth?.authKey === authKey) {
    // Update lastSeen
    deviceAuth.lastSeen = today();
    authsFile.setDirty(auths);
    
    // Load user prefs on first access
    const prefs = ensureUserPrefsFile(userId);
    
    return {
      valid: true,
      user: {
        userId,
        isAdmin: isUserAdmin(usersFile.data, userId),
        prefs,
        clientDataCache: new ClientDataCache()
      }
    };
  }
  
  return { valid: false, user: null };
}

/**
 * Logout a user's device by removing their auth key.
 */
export function logout(userId: string, deviceId: string): void {
  if (!deviceId.startsWith("device-")) {
    deviceId = "device-" + deviceId;
  }
  
  const auths = authsFile.data;
  if (auths[userId]) {
    delete auths[userId][deviceId];
    // Clean up empty user entries
    if (Object.keys(auths[userId]).length === 0) {
      delete auths[userId];
    }
    authsFile.setDirty(auths);
  }
}

/**
 * Get list of devices for a user.
 */
export function getDevices(userId: string): Array<{ deviceId: string; label: string; city: string; firstSeen: string; lastSeen: string }> {
  const auths = authsFile.data;
  const userAuths = auths[userId] || {};
  
  return Object.entries(userAuths).map(([deviceId, auth]) => ({
    deviceId,
    label: auth.label,
    city: auth.city,
    firstSeen: auth.firstSeen,
    lastSeen: auth.lastSeen
  }));
}

/**
 * Check if the auth system is properly configured (has at least one user).
 * If this returns false, the server should refuse to start.
 */
export function isAuthConfigured(): boolean {
  const users = usersFile.data;
  const hasUsers = Object.keys(users).length > 0;
  if (!hasUsers) {
    console.error("[isAuthConfigured] FATAL: No users configured in", USERS_FILE);
  }
  return hasUsers;
}
