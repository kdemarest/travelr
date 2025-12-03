#!/usr/bin/env npx tsx
/**
 * testsvr.ts - Spawn an isolated test server
 * 
 * PURPOSE:
 * Creates a fully isolated test environment that behaves identically to production.
 * The test server has NO special knowledge that it's a test - isolation comes purely
 * from running in a separate directory with copied data files.
 * 
 * HOW IT WORKS:
 * 1. Selects an available port from 5000-5999 (checks for existing TEST_<port>/ dirs)
 * 2. Creates TEST_<port>/ directory at the code root
 * 3. Copies data directories (dataUsers/, dataTrips/, etc.) into TEST_<port>/
 * 4. If -copycode flag: also copies scripts/, server/, client/ (needed for hot-reload tests)
 * 5. Generates config.test.json with the selected port
 * 6. Builds the server (npm run build in server/)
 * 7. Starts the server FROM the test directory (so __dirname paths resolve there)
 * 8. Waits for server to be ready, then signals the parent process
 * 
 * PORT DISCOVERY:
 * The selected port is communicated to the parent process via stdout:
 *   - When server is ready, prints "READY <port>" to stdout (e.g., "READY 5000")
 *   - Parent should parse this line to discover which port was assigned
 *   - All other output goes to stderr (prefixed with [testsvr])
 * 
 * Example parent code:
 *   const proc = spawn("npx", ["tsx", "scripts/testsvr.ts"]);
 *   proc.stdout.on("data", (data) => {
 *     const match = data.toString().match(/READY\s+(\d+)/);
 *     if (match) {
 *       const port = parseInt(match[1], 10);
 *       // Server is ready on `port`
 *     }
 *   });
 * 
 * CLEANUP:
 * - The TEST_<port>/ directory is NOT auto-cleaned (useful for debugging)
 * - Kill this process to stop the server
 * - Manually delete TEST_<port>/ when done
 * 
 * Usage:
 *   npx tsx scripts/testsvr.ts              # Auto-select port, spawn server
 *   npx tsx scripts/testsvr.ts -copycode    # Also copy scripts/, server/, client/
 *   npx tsx scripts/testsvr.ts -list        # List all test servers in 5000-5999 range
 *   npx tsx scripts/testsvr.ts -kill 5002   # Kill server on port 5002
 *   npx tsx scripts/testsvr.ts -remove 5002 # Kill server AND delete testDirs/TEST_5002/
 *   TEST_PORT=5042 npx tsx scripts/testsvr.ts  # Use specific port
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODE_ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(CODE_ROOT, "server");

// Port range for test servers
const PORT_MIN = 5000;
const PORT_MAX = 5999;

// All test directories live under testDirs/ to reduce clutter
const TEST_DIRS_ROOT = path.join(CODE_ROOT, "testDirs");

// ============================================================================
// MANAGEMENT COMMANDS: -list, -kill, -remove
// ============================================================================

/**
 * Check if a port is in use by attempting to connect.
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Get PID from server.pid file in test directory.
 */
function getPidFromFile(port: number): number | null {
  const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
      if (!isNaN(pid)) return pid;
    } catch {
      // Ignore read errors
    }
  }
  return null;
}

/**
 * List all test servers in the port range.
 */
async function listServers(): Promise<void> {
  console.log("Test servers (port range 5000-5999):\n");
  console.log("PORT   PID      DIR EXISTS   STATUS");
  console.log("─".repeat(50));
  
  let found = 0;
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    const dirExists = fs.existsSync(path.join(TEST_DIRS_ROOT, `TEST_${port}`));
    const pid = getPidFromFile(port);
    const portInUse = await isPortInUse(port);
    
    if (dirExists || portInUse) {
      found++;
      const pidStr = pid ? String(pid).padEnd(8) : "?       ";
      const dirStr = dirExists ? "yes" : "no ";
      const statusStr = portInUse ? "RUNNING" : (dirExists ? "stopped" : "");
      console.log(`${port}   ${pidStr} ${dirStr}          ${statusStr}`);
    }
  }
  
  if (found === 0) {
    console.log("(no test servers found)");
  }
  console.log("");
}

/**
 * Kill a test server by port.
 * Uses the PID file to find the process - no shell commands needed.
 */
async function killServer(port: number): Promise<boolean> {
  const pid = getPidFromFile(port);
  
  if (pid) {
    try {
      // Check if process exists first
      process.kill(pid, 0);
      // It exists, now kill it
      process.kill(pid, "SIGTERM");
      console.log(`Killed server on port ${port} (PID ${pid})`);
      
      // Clean up PID file
      const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
      try { fs.unlinkSync(pidFile); } catch { }
      
      return true;
    } catch (err: any) {
      if (err.code === "ESRCH") {
        console.log(`Server on port ${port} not running (stale PID file)`);
        // Clean up stale PID file
        const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
        try { fs.unlinkSync(pidFile); } catch { }
        return true;
      }
      console.error(`Failed to kill server on port ${port}: ${err.message}`);
      return false;
    }
  }
  
  // No PID file - check if directory exists
  const dirExists = fs.existsSync(path.join(TEST_DIRS_ROOT, `TEST_${port}`));
  const portInUse = await isPortInUse(port);
  
  if (portInUse && !dirExists) {
    // Something else is using this port, not our test server
    console.log(`Port ${port} is in use but no TEST_${port}/ directory exists.`);
    console.log(`This is not a test server we manage.`);
    return false;
  }
  
  if (portInUse) {
    console.log(`Port ${port} is in use but no PID file found.`);
    console.log(`Server may have been started externally. Cannot kill without PID.`);
    return false;
  }
  
  console.log(`No server running on port ${port}`);
  return true;
}

/**
 * Remove a test server - kill it and delete the directory.
 */
async function removeServer(port: number): Promise<boolean> {
  await killServer(port);
  
  const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
  if (fs.existsSync(dir)) {
    // Give it a moment for handles to release
    await new Promise(r => setTimeout(r, 500));
    
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Removed directory: ${dir}`);
      return true;
    } catch (err: any) {
      console.error(`Failed to remove ${dir}: ${err.message}`);
      return false;
    }
  } else {
    console.log(`Directory does not exist: ${dir}`);
    return true;
  }
}

// ============================================================================
// COMMAND DISPATCH
// ============================================================================

// Check for management commands first
const args = process.argv.slice(2);

if (args.includes("-list")) {
  listServers().then(() => process.exit(0));
} else if (args.includes("-kill")) {
  const idx = args.indexOf("-kill");
  const port = parseInt(args[idx + 1], 10);
  if (isNaN(port) || port < PORT_MIN || port > PORT_MAX) {
    console.error(`Usage: testsvr -kill <port>  (port must be ${PORT_MIN}-${PORT_MAX})`);
    process.exit(1);
  }
  killServer(port).then(ok => process.exit(ok ? 0 : 1));
} else if (args.includes("-remove")) {
  const idx = args.indexOf("-remove");
  const port = parseInt(args[idx + 1], 10);
  if (isNaN(port) || port < PORT_MIN || port > PORT_MAX) {
    console.error(`Usage: testsvr -remove <port>  (port must be ${PORT_MIN}-${PORT_MAX})`);
    process.exit(1);
  }
  removeServer(port).then(ok => process.exit(ok ? 0 : 1));
} else {
  // Normal spawn mode - continue to main()
  main();
}

// ============================================================================
// SPAWN MODE (original functionality)
// ============================================================================

// Parse args for spawn mode
const copyCode = args.includes("-copycode");

let testPort: number;
let testDir: string;
let serverProcess: ChildProcess | null = null;

function log(msg: string) {
  console.error(`[testsvr] ${msg}`);
}

/**
 * Find an available port by checking if TEST_<port>/ directory exists.
 */
function findAvailablePort(): number {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
    if (!fs.existsSync(dir)) {
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_MIN}-${PORT_MAX}`);
}

/**
 * Create the isolated test directory with copies of data files.
 */
function createTestDirectory(port: number): string {
  // Ensure testDirs/ exists
  if (!fs.existsSync(TEST_DIRS_ROOT)) {
    fs.mkdirSync(TEST_DIRS_ROOT);
  }
  
  const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
  
  // Clean slate - delete if exists
  if (fs.existsSync(dir)) {
    log(`Removing existing test directory: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  
  log(`Creating test directory: ${dir}`);
  fs.mkdirSync(dir);
  
  // Copy data directories
  const dataDirs = ["dataUsers", "dataUserPrefs", "dataTrips", "dataConfig"];
  for (const dataDir of dataDirs) {
    const src = path.join(CODE_ROOT, dataDir);
    const dest = path.join(dir, dataDir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
      log(`  Copied ${dataDir}/`);
    }
  }
  
  // Filter to skip node_modules and TEST_* when copying code
  // These would be huge/recursive and are not needed for tests
  const copyFilter = (src: string): boolean => {
    const basename = path.basename(src);
    if (basename === "node_modules") return false;
    if (basename.startsWith("TEST_")) return false;
    return true;
  };
  
  // Copy code directories if requested
  if (copyCode) {
    const codeDirs = ["scripts", "server", "client"];
    for (const codeDir of codeDirs) {
      const src = path.join(CODE_ROOT, codeDir);
      const dest = path.join(dir, codeDir);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true, filter: copyFilter });
        log(`  Copied ${codeDir}/`);
      }
    }
    // Also copy root package.json and tsconfig for npm commands
    for (const file of ["package.json", "tsconfig.base.json"]) {
      const src = path.join(CODE_ROOT, file);
      const dest = path.join(dir, file);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest);
        log(`  Copied ${file}`);
      }
    }
    
    // ========================================================================
    // JUNCTION LINKS FOR node_modules
    // ========================================================================
    // We copied server/ and client/ but SKIPPED their node_modules/ (huge!).
    // The copied code still needs to find its dependencies when it runs.
    // 
    // Solution: Create "junctions" - a Windows filesystem feature that acts
    // like a symlink for directories. When Node resolves require('express')
    // from TEST_5000/server/dist/, it walks up looking for node_modules/.
    // The junction at TEST_5000/server/node_modules/ transparently redirects
    // to CODE_ROOT/server/node_modules/, so modules are found.
    //
    // Why junctions instead of symlinks?
    // - Symlinks on Windows require admin rights or Developer Mode
    // - Junctions work without elevation for directories
    // - When we delete TEST_5000/, only the junction is deleted, not the
    //   real node_modules
    //
    // Note: Target path MUST be absolute on Windows.
    // ========================================================================
    const nodeModulesDirs = ["server", "client"];
    for (const subdir of nodeModulesDirs) {
      const realNodeModules = path.join(CODE_ROOT, subdir, "node_modules");
      const junctionPath = path.join(dir, subdir, "node_modules");
      if (fs.existsSync(realNodeModules)) {
        fs.symlinkSync(realNodeModules, junctionPath, "junction");
        log(`  Linked ${subdir}/node_modules/ (junction)`);
      }
    }
  }
  
  // Create empty directories for logs and temp files
  fs.mkdirSync(path.join(dir, "dataDiagnostics"));
  fs.mkdirSync(path.join(dir, "dataTemp"));
  
  // Copy generic test config and patch the port
  const srcConfig = path.join(CODE_ROOT, "dataConfig", "config.test-generic.json");
  const destConfig = path.join(dir, "dataConfig", "config.test.json");
  const config = JSON.parse(fs.readFileSync(srcConfig, "utf-8"));
  config.port = port;
  fs.writeFileSync(destConfig, JSON.stringify(config, null, 2));
  log(`  Created config.test.json (port ${port})`);
  
  return dir;
}

/**
 * Build the server.
 */
async function buildServer(): Promise<void> {
  log("Building server...");
  
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["run", "build"], {
      cwd: SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });
    
    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.stderr?.on("data", (d) => { output += d.toString(); });
    
    proc.on("close", (code) => {
      if (code === 0) {
        log("Build complete");
        resolve();
      } else {
        reject(new Error(`Build failed (code ${code}):\n${output}`));
      }
    });
    proc.on("error", reject);
  });
}

/**
 * Start the server from the test directory.
 */
function startServer(): void {
  log(`Starting server on port ${testPort} from ${testDir}...`);
  
  // Explicitly pass through important env vars
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    // API keys
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_CS_API_KEY: process.env.GOOGLE_CS_API_KEY,
    GOOGLE_CS_CX: process.env.GOOGLE_CS_CX,
    // Use the test config we generated
    TRAVELR_CONFIG: "test"
  };
  
  // WHERE THE SERVER CODE COMES FROM vs WHERE IT RUNS
  //
  // This is subtle but critical:
  //
  // - cwd (testDir): Always the test directory. This is where the server looks
  //   for data files, PID files, configs, etc. via process.cwd(). This provides
  //   DATA ISOLATION - the test server won't touch real data files.
  //
  // - serverScript: Where the actual JavaScript code lives.
  //   * Without -copycode: Uses CODE_ROOT's server/dist/. The test runs the REAL
  //     server code, just with isolated data. Good for most tests.
  //   * With -copycode: Uses testDir's server/dist/. The test runs a COPY of the
  //     server code. Required for hot-reload tests, where relaunch.ts will
  //     overwrite files in testDir and restart. If we ran from CODE_ROOT, the
  //     hot-reload would overwrite real code!
  //
  const serverRoot = copyCode ? testDir : CODE_ROOT;
  const serverScript = path.join(serverRoot, "server", "dist", "index.js");
  
  serverProcess = spawn("node", [serverScript], {
    cwd: testDir,  // This is the key - server runs FROM the test dir
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  
  // Forward server output to stderr (so parent can distinguish from our READY signal)
  serverProcess.stdout?.on("data", (data) => {
    process.stderr.write(data);
  });
  serverProcess.stderr?.on("data", (data) => {
    process.stderr.write(data);
  });
  
  serverProcess.on("close", (code) => {
    log(`Server exited with code ${code}`);
    serverProcess = null;
  });
  
  serverProcess.on("error", (err) => {
    log(`Server error: ${err}`);
  });
}

/**
 * Wait for server to respond to /ping.
 */
async function waitForReady(maxWaitMs = 30000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;
  const testServer = `http://localhost:${testPort}`;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await fetch(`${testServer}/ping`, {
        signal: AbortSignal.timeout(1000)
      });
      if (resp.ok && (await resp.text()).trim() === "pong") {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  return false;
}

/**
 * Kill the locally spawned server process (used during cleanup).
 */
function killLocalServer(): void {
  if (serverProcess && !serverProcess.killed) {
    log("Killing server...");
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

// Cleanup on exit
process.on("SIGINT", () => { killLocalServer(); process.exit(0); });
process.on("SIGTERM", () => { killLocalServer(); process.exit(0); });

async function main() {
  try {
    // Determine port
    testPort = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : findAvailablePort();
    if (testPort < PORT_MIN || testPort > PORT_MAX) {
      throw new Error(`TEST_PORT must be in range ${PORT_MIN}-${PORT_MAX}`);
    }
    log(`Using port ${testPort}`);
    
    // Create isolated test directory
    testDir = createTestDirectory(testPort);
    
    // Build server
    await buildServer();
    
    // Start server from test directory
    startServer();
    
    // Wait for ready
    const ready = await waitForReady(30000);
    if (!ready) {
      log("Server did not become ready within 30 seconds");
      killLocalServer();
      process.exit(1);
    }
    
    // Signal to parent that we're ready (include port so they know which one)
    console.log(`READY ${testPort}`);
    log(`Server ready on port ${testPort}`);
    log(`Test directory: ${testDir}`);
    
    // Keep running until killed
    await new Promise(() => {});
    
  } catch (err) {
    log(`Error: ${err}`);
    killLocalServer();
    process.exit(1);
  }
}
