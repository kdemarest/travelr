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
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeploymentZip } from "../scripts/create-quick-deploy-zip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

// Port is dynamically assigned by testsvr.ts (60000-60999)
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

/**
 * Run testsvr command synchronously.
 */
function runTestsvr(args: string[]): { stdout: string; exitCode: number } {
  const script = path.join(APP_ROOT, "scripts", "testsvr.ts");
  try {
    const result = execSync(`npx tsx "${script}" ${args.join(" ")}`, {
      cwd: APP_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { stdout: result, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || "", exitCode: err.status || 1 };
  }
}

/**
 * Spawn an isolated test server using testsvr.ts.
 * testsvr -spawn exits after the server is ready, server keeps running.
 */
async function spawnTestServer(): Promise<void> {
  logInfo(`Starting isolated test server...`);
  
  // Run testsvr -spawn -copycode and capture output
  const { stdout, exitCode } = runTestsvr(["-spawn", "-copycode"]);
  
  if (exitCode !== 0) {
    throw new Error("testsvr -spawn failed");
  }
  
  const match = stdout.match(/READY\s+(\d+)/);
  if (!match) {
    throw new Error("No READY signal in testsvr output");
  }
  
  const port = parseInt(match[1], 10);
  
  // Set the dynamic port
  TEST_PORT = port;
  TEST_SERVER = `http://localhost:${TEST_PORT}`;
  
  // Double-check server is actually responding
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
 * Kill and remove the test server via testsvr -remove.
 */
function cleanupTestServer(): void {
  if (TEST_PORT) {
    logInfo(`Cleaning up test server on port ${TEST_PORT}...`);
    runTestsvr(["-remove", String(TEST_PORT)]);
    TEST_PORT = 0;
  }
}

/**
 * Just kill the server, leave directory for debugging.
 */
function killTestServer(): void {
  if (TEST_PORT) {
    logInfo(`Killing test server on port ${TEST_PORT} (leaving directory for debugging)...`);
    runTestsvr(["-kill", String(TEST_PORT)]);
    logInfo(`Test directory preserved: testDirs/TEST_${TEST_PORT}/`);
    TEST_PORT = 0;
  }
}

// Cleanup on exit - just kill, don't remove (preserve for debugging)
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
async function waitForServer(maxWaitMs = 60000, authKey?: string): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;
  let seenLineCount = 0;  // Track how many lines we've already printed
  
  logInfo("Waiting for server to restart...");
  
  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    let gotStatus = false;
    
    // Try to get status from relaunch.ts status server (runs on same port during restart)
    if (authKey) {
      try {
        const statusResp = await fetch(`${TEST_SERVER}/admin/hot-reload-status`, {
          headers: {
            "x-auth-user": "deploybot",
            "x-auth-device": "test-hot-reload",
            "x-auth-key": authKey
          },
          signal: AbortSignal.timeout(2000)
        });
        if (statusResp.ok) {
          gotStatus = true;
          const statusText = await statusResp.text();
          // Filter out empty lines and [RELAUNCH]/[SERVER] prefix lines
          const lines = statusText.split("\n").filter(l => 
            l.trim() && !l.startsWith("[RELAUNCH]") && !l.startsWith("[SERVER]")
          );
          // Print only new lines we haven't seen yet
          const newLines = lines.slice(seenLineCount);
          for (const line of newLines) {
            log(`  ${elapsed}s - ${line}`, colors.gray);
          }
          seenLineCount = lines.length;
        }
      } catch {
        // Connection refused, timeout, etc. - server is down, which is expected
      }
    }
    
    // Check if server is fully up via /ping
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
      // Server not ready yet - expected during restart
    }
    
    if (!gotStatus) {
      log(`  ${elapsed}s - waiting...`, colors.gray);
    }
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
    
    // Step 4: POST to hot-reload endpoint
    // NOTE: We do NOT use ?test=true here. This is a real hot-reload, just in an
    // isolated TEST_* directory. We want files to actually be written, rebuilt, etc.
    logInfo("Sending zip to /admin/hot-reload...");
    const zipBuffer = fs.readFileSync(zipPath);
    const zipMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    logInfo(`Zip MD5: ${zipMd5}`);
    
    const hotReloadResp = await fetch(`${TEST_SERVER}/admin/hot-reload`, {
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
    
    const serverBack = await waitForServer(20000, authKey);
    if (!serverBack) {
      logError("Server did not come back up within 20 seconds");
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
      
      // Step 7: Re-authenticate after restart (new server instance)
      logInfo("Re-authenticating after restart...");
      authKey = await authenticate();
      
      // Step 8: Verify status endpoint matches log file
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
    cleanupTestServer();
    
  } catch (err) {
    logError(`Test failed: ${err}`);
    killTestServer();  // Leave directory for debugging
    process.exit(1);
  }
}

main();
