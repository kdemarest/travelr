/**
 * Admin API endpoints for file persistence and system management.
 * 
 * GET /admin/files - Download all persistent files as JSON
 * POST /admin/files - Upload and restore persistent files
 * POST /admin/maintenance - Enable/disable maintenance mode
 * POST /admin/persist - Upload local files to S3
 * POST /admin/hot-reload - Receive zip, trigger server restart with new code
 * GET /admin/hot-reload-status - Get the most recent relaunch log file
 * 
 * Protected by isAdmin check on authenticated user.
 */

import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { uploadToS3, isS3Enabled } from "./s3-sync.js";
import { isHotReloadAllowed, isTestMode, getServerPort } from "./config.js";
import { removePidFile } from "./pid-file.js";
import { Paths } from "./data-paths.js";
import type { AuthenticatedRequest } from "./index.js";

const router = Router();

// Maintenance mode - when true, server rejects data-modifying requests
let maintenanceMode = false;

export function isMaintenanceMode(): boolean {
  return maintenanceMode;
}

export function getMaintenanceMessage(): string {
  return "Please wait while the server is being updated. This usually takes about a minute.";
}

interface FileEntry {
  name: string;
  content: string;
}

interface FilesPayload {
  timestamp: string;
  files: FileEntry[];
}

/**
 * Middleware to check admin access.
 * User is already authenticated by requireAuth middleware in index.ts.
 */
function requireAdmin(req: Request, res: Response, next: () => void) {
  const user = (req as AuthenticatedRequest).user;
  
  if (!user.isAdmin) {
    return res.status(403).json({ ok: false, error: "Admin access required" });
  }

  next();
}

/**
 * Read all files from a directory (non-recursive, files only).
 */
function readDirFiles(dir: string, prefix: string = ""): FileEntry[] {
  const files: FileEntry[] = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(dir, entry.name);
      const content = fs.readFileSync(filePath, "utf-8");
      files.push({
        name: prefix ? `${prefix}/${entry.name}` : entry.name,
        content
      });
    } else if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      files.push(...readDirFiles(path.join(dir, entry.name), subPrefix));
    }
  }

  return files;
}

/**
 * GET /admin/files - Download all persistent files
 */
router.get("/files", requireAdmin, (_req: Request, res: Response) => {
  try {
    const files: FileEntry[] = [];

    // Read dataUsers files
    const userFiles = readDirFiles(Paths.dataUsers);
    for (const f of userFiles) {
      files.push({ name: `dataUsers/${f.name}`, content: f.content });
    }

    // Read dataTrips files
    const tripFiles = readDirFiles(Paths.dataTrips);
    for (const f of tripFiles) {
      files.push({ name: `dataTrips/${f.name}`, content: f.content });
    }

    const payload: FilesPayload = {
      timestamp: new Date().toISOString(),
      files
    };

    res.json(payload);
  } catch (error) {
    console.error("Failed to read files:", error);
    res.status(500).json({ error: "Failed to read files" });
  }
});

/**
 * POST /admin/files - Upload and restore persistent files
 */
router.post("/files", requireAdmin, (req: Request, res: Response) => {
  try {
    const payload = req.body as FilesPayload;
    
    if (!payload.files || !Array.isArray(payload.files)) {
      return res.status(400).json({ error: "Invalid payload: expected { files: [...] }" });
    }

    let restored = 0;
    for (const file of payload.files) {
      if (!file.name || typeof file.content !== "string") {
        continue;
      }

      // Determine target directory based on prefix
      // WARNING: users.json contains password hashes - never allow overwriting via this endpoint
      if (file.name === "dataUsers/users.json") {
        console.warn("Skipping users.json - cannot overwrite password file via API");
        continue;
      }

      let targetPath: string;
      if (file.name.startsWith("dataUsers/")) {
        targetPath = path.join(Paths.dataUsers, file.name.replace("dataUsers/", ""));
      } else if (file.name.startsWith("dataTrips/")) {
        targetPath = path.join(Paths.dataTrips, file.name.replace("dataTrips/", ""));
      } else {
        // Skip unknown prefixes for safety
        console.warn(`Skipping unknown file prefix: ${file.name}`);
        continue;
      }

      // Ensure directory exists
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(targetPath, file.content, "utf-8");
      restored++;
    }

    res.json({ ok: true, restored, total: payload.files.length });
  } catch (error) {
    console.error("Failed to restore files:", error);
    res.status(500).json({ ok: false, error: "Failed to restore files" });
  }
});

/**
 * POST /admin/maintenance - Enable or disable maintenance mode
 * 
 * Body: { enabled: true/false }
 * 
 * When enabled, the server will reject data-modifying requests with a friendly message.
 * Call this BEFORE /admin/persist during deploy.
 */
router.post("/maintenance", requireAdmin, (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ ok: false, error: "Expected { enabled: true/false }" });
  }
  
  maintenanceMode = enabled;
  console.log(`[Admin] Maintenance mode ${enabled ? "ENABLED" : "DISABLED"}`);
  
  res.json({ 
    ok: true, 
    maintenanceMode: enabled,
    message: enabled ? getMaintenanceMessage() : "Server is accepting requests normally"
  });
});

/**
 * POST /admin/persist - Upload local files to S3
 * 
 * Called by deploy script before rebuilding to ensure data is saved.
 */
router.post("/persist", requireAdmin, async (_req: Request, res: Response) => {
  try {
    if (!isS3Enabled()) {
      return res.status(400).json({ 
        ok: false, 
        error: "S3 not configured - set TRAVELR_S3_BUCKET environment variable" 
      });
    }
    
    const filesUploaded = await uploadToS3();
    
    res.json({ 
      ok: true, 
      filesUploaded,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to persist to S3:", error);
    res.status(500).json({ ok: false, error: "Failed to persist to S3" });
  }
});

/**
 * POST /admin/hot-reload - Receive deployment zip and restart server
 * 
 * Requires:
 * - isAdmin user
 * - hotReloadAllowed: true in config
 * 
 * Body: raw zip file (application/zip or application/octet-stream)
 * 
 * Flow:
 * 1. Save zip to dataTemp/quick-deploy-inbound.zip
 * 2. Validate zip by extracting in-memory (ensures it's valid before shutdown)
 * 3. Spawn relaunch.ts as detached process
 * 4. Respond with success
 * 5. Gracefully shutdown server
 * 6. relaunch.ts waits for PID file to disappear, then extracts and restarts
 */
router.post("/hot-reload", requireAdmin, async (req: Request, res: Response) => {
  const testMode = req.query.test === "true";
  
  // Security check: must be explicitly enabled in config (unless test mode)
  if (!testMode && !isHotReloadAllowed()) {
    console.error("[HotReload] REJECTED - hotReloadAllowed is not true in config");
    return res.status(403).json({ 
      ok: false, 
      error: "Hot reload is not enabled on this server. Set hotReloadAllowed: true in config." 
    });
  }
  
  try {
    // Get expected MD5 from header
    const expectedMd5 = req.headers["x-content-md5"] as string | undefined;
    if (!expectedMd5) {
      return res.status(400).json({ ok: false, error: "Missing X-Content-MD5 header" });
    }
    
    // Get raw body as buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const zipBuffer = Buffer.concat(chunks);
    
    if (zipBuffer.length === 0) {
      return res.status(400).json({ ok: false, error: "No zip data received" });
    }
    
    // Validate MD5 checksum
    const actualMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    if (actualMd5 !== expectedMd5) {
      console.error(`[HotReload] MD5 mismatch: expected ${expectedMd5}, got ${actualMd5}`);
      return res.status(400).json({ 
        ok: false, 
        error: `MD5 checksum mismatch: expected ${expectedMd5}, got ${actualMd5}` 
      });
    }
    console.log(`[HotReload] MD5 verified: ${actualMd5}`);
    
    // Validate it looks like a zip (starts with PK)
    if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
      return res.status(400).json({ ok: false, error: "Invalid zip file (bad magic bytes)" });
    }
    
    console.log(`[HotReload] Received ${zipBuffer.length} bytes`);
    
    // Validate zip by extracting in-memory before committing to shutdown
    // This uses basic zip structure parsing - same approach as relaunch.ts
    let fileCount = 0;
    try {
      let offset = 0;
      
      while (offset < zipBuffer.length - 4) {
        // Look for local file header signature (PK\x03\x04)
        if (zipBuffer[offset] !== 0x50 || zipBuffer[offset + 1] !== 0x4B) {
          break;
        }
        if (zipBuffer[offset + 2] !== 0x03 || zipBuffer[offset + 3] !== 0x04) {
          // Not a local file header, might be central directory - that's fine
          break;
        }
        
        // Parse local file header
        const generalPurposeFlag = zipBuffer.readUInt16LE(offset + 6);
        const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
        const compressedSize = zipBuffer.readUInt32LE(offset + 18);
        const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
        const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);
        
        const fileNameStart = offset + 30;
        const fileName = zipBuffer.toString("utf-8", fileNameStart, fileNameStart + fileNameLength);
        const dataStart = fileNameStart + fileNameLength + extraFieldLength;
        
        // Check if data descriptor is used (bit 3 of general purpose flag)
        const hasDataDescriptor = (generalPurposeFlag & 0x08) !== 0;
        
        // Validate we can decompress the file (skip if using data descriptor - sizes are unreliable)
        if (!fileName.endsWith("/") && !hasDataDescriptor && compressedSize > 0) {
          const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);
          
          if (compressionMethod === 0) {
            // Stored (no compression) - just validate we can read it
            if (compressedData.length !== compressedSize) {
              throw new Error(`File ${fileName} has invalid size`);
            }
          } else if (compressionMethod === 8) {
            // Deflate - try to decompress
            zlib.inflateRawSync(compressedData);
          } else {
            throw new Error(`Unsupported compression method: ${compressionMethod} for ${fileName}`);
          }
        }
        
        if (!fileName.endsWith("/")) {
          fileCount++;
        }
        
        // Skip to next entry
        if (hasDataDescriptor || compressedSize === 0) {
          // Can't reliably skip with data descriptor, just count files from central directory
          // Find End of Central Directory (PK\x05\x06) and get file count from there
          break;
        }
        offset = dataStart + compressedSize;
      }
      
      // If we couldn't parse local headers (data descriptors), get count from central directory
      if (fileCount === 0) {
        // Find EOCD signature from the end
        for (let i = zipBuffer.length - 22; i >= 0; i--) {
          if (zipBuffer[i] === 0x50 && zipBuffer[i + 1] === 0x4B &&
              zipBuffer[i + 2] === 0x05 && zipBuffer[i + 3] === 0x06) {
            fileCount = zipBuffer.readUInt16LE(i + 10);
            break;
          }
        }
      }
      
      if (fileCount === 0) {
        throw new Error("Zip contains no files");
      }
      
      console.log(`[HotReload] Validated zip: ${fileCount} files`);
    } catch (err) {
      console.error("[HotReload] Zip validation failed:", err);
      return res.status(400).json({ ok: false, error: `Invalid zip file: ${err}` });
    }
    
    // Save to our own temp directory (safer than /tmp)
    const tempDir = Paths.dataTemp;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const zipPath = path.join(tempDir, "quick-deploy-inbound.zip");
    fs.writeFileSync(zipPath, zipBuffer);
    console.log(`[HotReload] Saved zip to ${zipPath}`);
    
    // Spawn relaunch.ts as detached process
    // It will wait for the server to shut down, then extract and restart
    const relaunchScript = path.join(Paths.scripts, "relaunch.ts");
    
    // Generate timestamped log file path
    const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const diagnosticsDir = Paths.dataDiagnostics;
    if (!fs.existsSync(diagnosticsDir)) {
      fs.mkdirSync(diagnosticsDir, { recursive: true });
    }
    const logFile = path.join(diagnosticsDir, `relaunch-${logTimestamp}.log`);
    
    console.log(`[HotReload] Spawning relaunch script: ${relaunchScript}${testMode ? " (TEST MODE)" : ""}`);
    console.log(`[HotReload] Log file: ${logFile}`);
    
    // relaunch.ts operates entirely from cwd - no path arguments needed
    const relaunchArgs = ["tsx", relaunchScript, zipPath, `--log=${logFile}`, `--md5=${actualMd5}`, `--port=${getServerPort()}`];
    if (testMode) {
      relaunchArgs.push("--test");
    }
    if (isTestMode()) {
      // In test environments (isTest: true in config), skip npm install
      // to protect junction-linked node_modules from being modified
      relaunchArgs.push("--noNpmInstall");
    }
    
    const child = spawn("npx", relaunchArgs, {
      detached: true,
      stdio: "ignore",
      cwd: Paths.dataRoot,
      shell: true
    });
    child.unref();
    
    console.log(`[HotReload] Relaunch process spawned (PID ${child.pid})`);
    
    // Respond before shutting down
    res.json({ 
      ok: true, 
      message: testMode 
        ? "Hot reload TEST initiated. Server will restart, but files will not be overwritten."
        : "Hot reload initiated. Server will restart shortly.",
      zipSize: zipBuffer.length,
      fileCount,
      relaunchPid: child.pid,
      logFile,
      testMode
    });
    
    // Give response time to send, then gracefully shutdown
    // In test mode, we still shutdown - the relaunch script will restart us
    setTimeout(() => {
      console.log("[HotReload] Initiating graceful shutdown...");
      removePidFile();
      process.exit(0);
    }, 500);
    
  } catch (error) {
    console.error("[HotReload] Failed:", error);
    res.status(500).json({ ok: false, error: `Hot reload failed: ${error}` });
  }
});

/**
 * GET /admin/hot-reload-status - Get the most recent relaunch log file
 * 
 * Returns the contents of the most recent relaunch-*.log file from dataDiagnostics.
 * Useful for diagnosing what happened during a hot reload, especially if the
 * server restarted but the deploy failed (e.g., MD5 mismatch).
 */
router.get("/hot-reload-status", requireAdmin, (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(Paths.dataDiagnostics)) {
      return res.status(404).json({ ok: false, error: "No diagnostics directory found" });
    }
    
    // Find all relaunch-*.log files
    const files = fs.readdirSync(Paths.dataDiagnostics)
      .filter(f => f.startsWith("relaunch-") && f.endsWith(".log"))
      .sort()
      .reverse(); // Most recent first (lexicographic sort works for ISO timestamps)
    
    if (files.length === 0) {
      return res.status(404).json({ ok: false, error: "No relaunch logs found" });
    }
    
    const latestLog = files[0];
    const logPath = path.join(Paths.dataDiagnostics, latestLog);
    const content = fs.readFileSync(logPath, "utf-8");
    
    res.setHeader("Content-Type", "text/plain");
    res.send("[SERVER]\n" + content);
  } catch (error) {
    console.error("[HotReloadStatus] Failed:", error);
    res.status(500).json({ ok: false, error: `Failed to read log: ${error}` });
  }
});

export default router;
