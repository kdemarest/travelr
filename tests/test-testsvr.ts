#!/usr/bin/env npx tsx
/**
 * test-testsvr.ts - Verify that testsvr.ts creates proper isolated environments
 * 
 * Tests:
 * 1. Can spawn a test server without -copycode (data isolation only)
 * 2. Can spawn a test server with -copycode (full isolation)
 * 3. Server responds to /ping
 * 4. TEST_<port>/ directory has expected structure
 * 5. Junction links work for node_modules (with -copycode)
 * 6. Cleanup works (directory can be deleted)
 * 
 * Usage: npx tsx tests/test-testsvr.ts
 */

import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const TEST_DIRS_ROOT = path.join(APP_ROOT, "testDirs");

// Test state
let testProcess: ChildProcess | null = null;
let testPort = 0;
let testDir = "";
let passCount = 0;
let failCount = 0;

// Colors
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function log(msg: string) {
  console.log(msg);
}

function pass(name: string) {
  passCount++;
  log(`${GREEN}✓ ${name}${RESET}`);
}

function fail(name: string, reason?: string) {
  failCount++;
  log(`${RED}✗ ${name}${reason ? `: ${reason}` : ""}${RESET}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Spawn testsvr.ts and wait for READY signal.
 * Returns the port number, or 0 on failure.
 */
async function spawnTestServer(copyCode: boolean): Promise<number> {
  const args = ["tsx", path.join(APP_ROOT, "scripts", "testsvr.ts")];
  if (copyCode) args.push("-copycode");
  
  testProcess = spawn("npx", args, {
    cwd: APP_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true
  });
  
  // Collect stderr for debugging
  testProcess.stderr?.on("data", (data) => {
    // Uncomment to see testsvr output:
    // process.stderr.write(data);
  });
  
  // Wait for READY <port>
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(0), 60000);
    
    testProcess?.stdout?.on("data", (data) => {
      const match = data.toString().match(/READY\s+(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });
    
    testProcess?.on("close", () => {
      clearTimeout(timeout);
      resolve(0);
    });
  });
}

/**
 * Kill the test server process.
 */
function killTestServer(): void {
  if (testProcess) {
    testProcess.kill();
    testProcess = null;
  }
}

/**
 * Clean up test directory with retries.
 * Windows can be slow to release file handles after process termination.
 */
async function cleanupTestDir(): Promise<boolean> {
  if (!testDir || !fs.existsSync(testDir)) {
    return true;
  }
  
  // Try a few times with delays - Windows holds handles briefly
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt < 4) {
        await sleep(500);
      } else {
        log(`Warning: Could not clean up ${testDir}: ${err}`);
        return false;
      }
    }
  }
  return false;
}

// ============================================================================
// TESTS
// ============================================================================

async function testBasicSpawn(): Promise<void> {
  log(`\n${CYAN}Test: Basic spawn (no -copycode)${RESET}`);
  
  testPort = await spawnTestServer(false);
  if (!testPort) {
    fail("Server started", "Did not receive READY signal");
    return;
  }
  pass("Server started");
  
  testDir = path.join(TEST_DIRS_ROOT, `TEST_${testPort}`);
  
  // Check directory exists
  if (fs.existsSync(testDir)) {
    pass("TEST_<port>/ directory created");
  } else {
    fail("TEST_<port>/ directory created");
    return;
  }
  
  // Check data directories exist
  const dataDirs = ["dataUsers", "dataUserPrefs", "dataTrips", "dataConfig"];
  for (const dir of dataDirs) {
    if (fs.existsSync(path.join(testDir, dir))) {
      pass(`${dir}/ copied`);
    } else {
      fail(`${dir}/ copied`);
    }
  }
  
  // Check code directories do NOT exist (no -copycode)
  const codeDirs = ["scripts", "server", "client"];
  for (const dir of codeDirs) {
    if (!fs.existsSync(path.join(testDir, dir))) {
      pass(`${dir}/ NOT copied (expected without -copycode)`);
    } else {
      fail(`${dir}/ NOT copied (expected without -copycode)`, "Directory exists but shouldn't");
    }
  }
  
  // Check server responds to ping
  try {
    const resp = await fetch(`http://localhost:${testPort}/ping`, {
      signal: AbortSignal.timeout(2000)
    });
    if (resp.ok && (await resp.text()).trim() === "pong") {
      pass("Server responds to /ping");
    } else {
      fail("Server responds to /ping", `Got ${resp.status}`);
    }
  } catch (err) {
    fail("Server responds to /ping", String(err));
  }
  
  // Cleanup
  killTestServer();
  await sleep(1000);
  const cleaned = await cleanupTestDir();
  
  if (cleaned) {
    pass("Cleanup successful");
  } else {
    fail("Cleanup successful", "Directory still exists");
  }
}

async function testCopyCodeSpawn(): Promise<void> {
  log(`\n${CYAN}Test: Spawn with -copycode${RESET}`);
  
  testPort = await spawnTestServer(true);
  if (!testPort) {
    fail("Server started", "Did not receive READY signal");
    return;
  }
  pass("Server started");
  
  testDir = path.join(TEST_DIRS_ROOT, `TEST_${testPort}`);
  
  // Check directory exists
  if (fs.existsSync(testDir)) {
    pass("TEST_<port>/ directory created");
  } else {
    fail("TEST_<port>/ directory created");
    return;
  }
  
  // Check code directories exist
  const codeDirs = ["scripts", "server", "client"];
  for (const dir of codeDirs) {
    if (fs.existsSync(path.join(testDir, dir))) {
      pass(`${dir}/ copied`);
    } else {
      fail(`${dir}/ copied`);
    }
  }
  
  // Check node_modules junctions exist and are valid
  const junctionDirs = ["server", "client"];
  for (const dir of junctionDirs) {
    const junctionPath = path.join(testDir, dir, "node_modules");
    if (fs.existsSync(junctionPath)) {
      // Check it's a symlink/junction
      const stats = fs.lstatSync(junctionPath);
      if (stats.isSymbolicLink()) {
        pass(`${dir}/node_modules/ junction exists`);
        
        // Verify it resolves to real node_modules
        const target = fs.realpathSync(junctionPath);
        const expectedTarget = path.join(APP_ROOT, dir, "node_modules");
        if (target === expectedTarget) {
          pass(`${dir}/node_modules/ junction points to correct target`);
        } else {
          fail(`${dir}/node_modules/ junction points to correct target`, 
               `Expected ${expectedTarget}, got ${target}`);
        }
      } else {
        fail(`${dir}/node_modules/ junction exists`, "Exists but is not a junction");
      }
    } else {
      fail(`${dir}/node_modules/ junction exists`);
    }
  }
  
  // Check server responds to ping
  try {
    const resp = await fetch(`http://localhost:${testPort}/ping`, {
      signal: AbortSignal.timeout(2000)
    });
    if (resp.ok && (await resp.text()).trim() === "pong") {
      pass("Server responds to /ping");
    } else {
      fail("Server responds to /ping", `Got ${resp.status}`);
    }
  } catch (err) {
    fail("Server responds to /ping", String(err));
  }
  
  // Cleanup
  killTestServer();
  await sleep(1000);
  const cleaned = await cleanupTestDir();
  
  if (cleaned) {
    pass("Cleanup successful (junctions don't block deletion)");
  } else {
    fail("Cleanup successful", "Directory still exists");
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log("=".repeat(60));
  log("  TESTSVR.TS TEST SUITE");
  log("=".repeat(60));
  
  try {
    await testBasicSpawn();
    await testCopyCodeSpawn();
  } finally {
    // Ensure cleanup on any failure
    killTestServer();
    await cleanupTestDir();
  }
  
  log("\n" + "=".repeat(60));
  log(`  Results: ${GREEN}${passCount} passed${RESET}, ${failCount > 0 ? RED : ""}${failCount} failed${RESET}`);
  log("=".repeat(60));
  
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async err => {
  console.error("Test suite crashed:", err);
  killTestServer();
  await cleanupTestDir();
  process.exit(1);
});
