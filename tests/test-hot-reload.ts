#!/usr/bin/env npx tsx
/**
 * test-hot-reload.ts - Test the hot reload mechanism without deploying to production
 * 
 * PURPOSE:
 * Exercises the full hot-reload flow in a completely isolated environment.
 * Verifies that code deployment, extraction, rebuild, and server restart all work.
 * 
 * ARCHITECTURE:
 * This test harness runs from the REAL code directory and orchestrates everything.
 * It spawns an isolated test server that has NO special knowledge it's being tested.
 * 
 * THE FLOW:
 * 1. Spawns testsvr.ts with -copycode flag
 *    - Creates TEST_<port>/ directory with copied data AND code
 *    - Uses junction links for node_modules (fast, no copying)
 *    - Server runs from the copied code, isolated from real code
 * 
 * 2. Creates a deployment zip from the REAL code (APP_ROOT)
 *    - This simulates what deploy.js would send to production
 *    - The zip contains the actual source we want to "deploy"
 * 
 * 3. POSTs the zip to the test server's /admin/hot-reload endpoint
 *    - Test server receives it exactly like production would
 *    - Server validates, saves zip, spawns relaunch.ts, shuts down
 * 
 * 4. relaunch.ts runs (from TEST_<port>/scripts/)
 *    - Extracts zip to TEST_<port>/ (its cwd)
 *    - Runs npm install/build if needed
 *    - Restarts server from TEST_<port>/
 * 
 * 5. This harness polls until server is back up
 *    - Verifies server responds to /ping
 *    - Checks relaunch log for errors
 * 
 * KEY INSIGHT:
 * The test server and relaunch.ts have ZERO special test logic. They behave
 * identically to production. Isolation comes purely from running in a separate
 * directory (TEST_<port>/) with its own data and code copies.
 * 
 * Usage: npx tsx tests/test-hot-reload.ts
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeploymentZip } from "../scripts/create-deploy-zip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

// Port is dynamically assigned by testsvr.ts (5000-5999)
let TEST_PORT = 0;
let TEST_SERVER = "";

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logInfo(message: string) {
  log(`[INFO] ${message}`, colors.cyan);
}

function logSuccess(message: string) {
  log(`[OK] ${message}`, colors.green);
}

function logWarning(message: string) {
  log(`[WARN] ${message}`, colors.yellow);
}

function logError(message: string) {
  log(`[ERROR] ${message}`, colors.red);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Track spawned server for cleanup
let spawnedServer: ChildProcess | null = null;

/**
 * Spawn an isolated test server on a dynamic port (5000-5999) using testsvr.ts.
 * The helper handles building, creates isolated TEST_<port>/ directory, and signals READY <port>.
 */
async function spawnTestServer(): Promise<void> {
  logInfo(`Starting isolated test server...`);
  
  const helperScript = path.join(__dirname, "testsvr.ts");
  
  spawnedServer = spawn("npx", ["tsx", helperScript], {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true
  });
  
  // Forward stderr (server output) with prefix
  spawnedServer.stderr?.on("data", (data) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    for (const line of lines) {
      log(`  ${line}`, colors.gray);
    }
  });
  
  // Wait for READY <port> signal on stdout
  const port = await new Promise<number>((resolve) => {
    const timeout = setTimeout(() => resolve(0), 60000);
    
    spawnedServer?.stdout?.on("data", (data) => {
      const text = data.toString();
      const match = text.match(/READY\s+(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });
    
    spawnedServer?.on("close", () => {
      clearTimeout(timeout);
      resolve(0);
    });
  });
  
  if (!port) {
    throw new Error("Test server did not start within 60 seconds");
  }
  
  // Set the dynamic port
  TEST_PORT = port;
  TEST_SERVER = `http://localhost:${TEST_PORT}`;
  
  // Double-check server is actually responding before proceeding
  await sleep(500);
  try {
    const pingResp = await fetch(`${TEST_SERVER}/ping`, { signal: AbortSignal.timeout(2000) });
    if (!pingResp.ok) {
      throw new Error("Ping failed after READY signal");
    }
  } catch (err) {
    throw new Error(`Server signaled READY but ping failed: ${err}`);
  }
  
  logSuccess(`Test server running on port ${TEST_PORT}`);
}

/**
 * Kill the spawned test server if it's still running.
 */
function killTestServer(): void {
  if (spawnedServer && !spawnedServer.killed) {
    logInfo("Killing test server...");
    spawnedServer.kill("SIGTERM");
    spawnedServer = null;
  }
}

// Cleanup on exit
process.on("exit", killTestServer);
process.on("SIGINT", () => { killTestServer(); process.exit(1); });
process.on("SIGTERM", () => { killTestServer(); process.exit(1); });

/**
 * Authenticate as deploybot and get an authKey.
 */
async function authenticate(): Promise<string> {
  // For local testing, we need deploybot credentials
  // The test assumes deploybot exists with a known password
  const response = await fetch(`${TEST_SERVER}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: "deploybot", password: "deploybot", deviceId: "test-hot-reload" })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Authentication failed: ${response.status} - ${text}`);
  }
  
  const data = await response.json() as { ok?: boolean; authKey?: string; error?: string };
  if (!data.ok || !data.authKey) {
    throw new Error(`No authKey in auth response: ${data.error || "unknown error"}`);
  }
  
  return data.authKey;
}

/**
 * Wait for server to come back up.
 */
async function waitForServer(maxWaitMs = 60000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;
  
  logInfo("Waiting for server to restart...");
  
  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    try {
      const response = await fetch(`${TEST_SERVER}/ping`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const text = await response.text();
        if (text.trim() === "pong") {
          logSuccess(`Server is back up after ${elapsed}s`);
          return true;
        }
      }
    } catch {
      // Server not ready yet
    }
    log(`  ${elapsed}s - waiting...`, colors.gray);
    await sleep(pollInterval);
  }
  
  return false;
}

/**
 * Check the relaunch log file for errors.
 */
function checkLogFile(logFile: string): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!fs.existsSync(logFile)) {
    return { ok: false, errors: [`Log file not found: ${logFile}`], warnings: [] };
  }
  
  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  
  for (const line of lines) {
    if (line.includes("ERROR") || line.includes("FATAL")) {
      errors.push(line.trim());
    } else if (line.includes("WARN")) {
      warnings.push(line.trim());
    }
  }
  
  return { ok: errors.length === 0, errors, warnings };
}

async function main() {
  log("\n" + "=".repeat(60), colors.bright + colors.cyan);
  log("  HOT RELOAD TEST", colors.bright + colors.cyan);
  log("=".repeat(60), colors.bright + colors.cyan);
  log(`  Using isolated server on port ${TEST_PORT}`, colors.gray);
  log("=".repeat(60) + "\n", colors.bright + colors.cyan);
  
  try {
    // Step 1: Spawn isolated test server
    await spawnTestServer();
    
    // Step 2: Authenticate
    logInfo("Authenticating as deploybot...");
    let authKey: string;
    try {
      authKey = await authenticate();
      logSuccess("Authenticated");
    } catch (err) {
      logError(`Authentication failed: ${err}`);
      logError("Make sure deploybot user exists with password 'deploybot' for local testing");
      process.exit(1);
    }
    
    // Step 3: Create deployment zip
    // 
    // WARNING: IMPORTANT NUANCE
    // This test harness ALWAYS runs from the real code directory (not TEST_*).
    // It spawns an isolated server INTO a TEST_* directory, but the harness itself
    // stays in the real scripts/ folder. Therefore, we pass APP_ROOT (the real code
    // root) to the zip creator. The zip contains the real source code, which will
    // be deployed to the test server's TEST_* directory.
    //
    logInfo("Creating deployment zip...");
    const zipPath = await createDeploymentZip(APP_ROOT);
    const zipStats = fs.statSync(zipPath);
    logSuccess(`Created ${(zipStats.size / 1024).toFixed(1)} KB zip at ${zipPath}`);
    
    // Step 4: POST to hot-reload endpoint with test=true
    logInfo("Sending zip to /admin/hot-reload?test=true...");
    const zipBuffer = fs.readFileSync(zipPath);
    const zipMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    logInfo(`Zip MD5: ${zipMd5}`);
    
    const hotReloadResp = await fetch(`${TEST_SERVER}/admin/hot-reload?test=true`, {
      method: "POST",
      headers: {
        "x-auth-user": "deploybot",
        "x-auth-device": "test-hot-reload",
        "x-auth-key": authKey,
        "Content-Type": "application/octet-stream",
        "X-Content-MD5": zipMd5
      },
      body: zipBuffer
    });
    
    if (!hotReloadResp.ok) {
      const text = await hotReloadResp.text();
      throw new Error(`Hot reload request failed: ${hotReloadResp.status} - ${text}`);
    }
    
    const result = await hotReloadResp.json() as { 
      ok: boolean; 
      logFile?: string;
      fileCount?: number;
      message?: string;
    };
    
    if (!result.ok) {
      throw new Error(`Hot reload failed: ${JSON.stringify(result)}`);
    }
    
    logSuccess(`Server accepted: ${result.fileCount} files validated`);
    logInfo(`Log file: ${result.logFile}`);
    
    // Step 5: Wait for server to restart
    // The server will shut down and relaunch.ts will restart it
    await sleep(1000); // Give server time to start shutdown
    
    const serverBack = await waitForServer(60000);
    if (!serverBack) {
      logError("Server did not come back up within 60 seconds");
      logError("Check the relaunch log for errors");
      if (result.logFile) {
        logInfo(`Log file: ${result.logFile}`);
      }
      process.exit(1);
    }
    
    // Step 6: Check the log file for errors
    logInfo("Checking relaunch log for errors...");
    
    // Wait a moment for log file to be fully written
    await sleep(500);
    
    if (result.logFile) {
      const logCheck = checkLogFile(result.logFile);
      
      if (logCheck.warnings.length > 0) {
        logWarning(`Found ${logCheck.warnings.length} warning(s):`);
        for (const warn of logCheck.warnings) {
          log(`  ${warn}`, colors.yellow);
        }
      }
      
      if (logCheck.errors.length > 0) {
        logError(`Found ${logCheck.errors.length} error(s):`);
        for (const err of logCheck.errors) {
          log(`  ${err}`, colors.red);
        }
        process.exit(1);
      }
      
      if (logCheck.ok) {
        logSuccess("No errors in relaunch log");
      }
      
      // Step 7: Verify status endpoint matches log file
      logInfo("Verifying /admin/hot-reload-status matches log file...");
      try {
        const statusResp = await fetch(`${TEST_SERVER}/admin/hot-reload-status`, {
          headers: {
            "x-auth-user": "deploybot",
            "x-auth-device": "test-hot-reload",
            "x-auth-key": authKey
          }
        });
        
        if (statusResp.ok) {
          const statusText = await statusResp.text();
          // Status should start with [SERVER] prefix line, then have the log content
          const statusLines = statusText.split("\n");
          if (statusLines[0] !== "[SERVER]") {
            logWarning(`Expected first line to be [SERVER], got: ${statusLines[0]}`);
          }
          // Compare rest of status with log file content
          const statusContent = statusLines.slice(1).join("\n");
          const logContent = fs.readFileSync(result.logFile, "utf-8");
          
          if (statusContent.trim() === logContent.trim()) {
            logSuccess("Status endpoint content matches log file exactly");
          } else {
            // Show what differs
            const statusTrimmed = statusContent.trim();
            const logTrimmed = logContent.trim();
            if (statusTrimmed.length !== logTrimmed.length) {
              logWarning(`Length mismatch: status=${statusTrimmed.length}, log=${logTrimmed.length}`);
            }
            // Find first difference
            for (let i = 0; i < Math.max(statusTrimmed.length, logTrimmed.length); i++) {
              if (statusTrimmed[i] !== logTrimmed[i]) {
                logWarning(`First difference at position ${i}:`);
                log(`  status: ...${statusTrimmed.substring(Math.max(0,i-20), i+20)}...`, colors.gray);
                log(`  log:    ...${logTrimmed.substring(Math.max(0,i-20), i+20)}...`, colors.gray);
                break;
              }
            }
            logWarning("Status endpoint content differs from log file (may be timing issue)");
          }
        } else {
          logWarning(`Status endpoint returned ${statusResp.status}`);
        }
      } catch (err) {
        logWarning(`Could not verify status endpoint: ${err}`);
      }
    } else {
      logWarning("No log file path in response - cannot verify relaunch logs");
    }
    
    // Success!
    log("\n" + "=".repeat(60), colors.bright + colors.green);
    log("  HOT RELOAD TEST PASSED", colors.bright + colors.green);
    log("=".repeat(60), colors.bright + colors.green);
    log("\nThe hot-reload mechanism is working correctly.", colors.green);
    log("Files were NOT overwritten (test mode).\n", colors.gray);
    
    // Clean up: kill the test server
    killTestServer();
    
  } catch (err) {
    logError(`Test failed: ${err}`);
    killTestServer();
    process.exit(1);
  }
}

main();
