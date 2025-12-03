/**
 * PID file management for clean shutdown detection.
 * 
 * The server writes its PID to a file on startup.
 * On graceful shutdown, it deletes the file.
 * The relaunch script can poll for the file to disappear.
 */

import fs from "node:fs";
import { Paths } from "./data-paths.js";

// PID file location - in the data root (supports test isolation)
const PID_FILE = Paths.pidFile;

/**
 * Write current process PID to file.
 * Call this on server startup.
 */
export function writePidFile(): void {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
    console.log(`[PID] Wrote PID ${process.pid} to ${PID_FILE}`);
  } catch (err) {
    console.error(`[PID] Failed to write PID file:`, err);
  }
}

/**
 * Remove PID file.
 * Call this on graceful shutdown.
 */
export function removePidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      console.log(`[PID] Removed PID file`);
    }
  } catch (err) {
    console.error(`[PID] Failed to remove PID file:`, err);
  }
}

/**
 * Get the PID file path (for relaunch script).
 */
export function getPidFilePath(): string {
  return PID_FILE;
}
