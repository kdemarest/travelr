#!/usr/bin/env npx tsx
/**
 * create-deploy-zip.ts - Create a deployment zip for hot reload
 * 
 * Creates a zip containing all source files needed for a hot reload deployment.
 * Used by deploy.js for quick deploys and by test scripts.
 * 
 * IMPORTANT: Caller MUST provide sourceRoot - this script has no opinion about
 * where source code lives. The caller always knows their context.
 * 
 * Usage: 
 *   npx tsx scripts/create-deploy-zip.ts <sourceRoot> [outputPath]
 *   
 * Example:
 *   npx tsx scripts/create-deploy-zip.ts . ./my-deploy.zip
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Archiver } from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a deployment zip containing source files for hot reload.
 * 
 * @param sourceRoot - The root directory containing source code to zip (REQUIRED)
 * @param outputPath - Where to write the zip (optional, defaults to sourceRoot/dataTemp/)
 * @returns Path to the created zip file
 */
export async function createDeploymentZip(sourceRoot: string, outputPath?: string): Promise<string> {
  if (!sourceRoot) {
    throw new Error("sourceRoot is required - caller must specify where source code lives");
  }
  
  const resolvedRoot = path.resolve(sourceRoot);
  
  // Dynamic import for archiver (ESM/CJS compatibility)
  const archiverModule = await import("archiver");
  const archiver = archiverModule.default as (format: string, options?: object) => Archiver;
  
  const zipPath = outputPath || path.join(resolvedRoot, "dataTemp", "quick-deploy-outbound.zip");
  
  // Ensure dataTemp directory exists
  const dataTemp = path.dirname(zipPath);
  if (!fs.existsSync(dataTemp)) {
    fs.mkdirSync(dataTemp, { recursive: true });
  }
  
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  return new Promise((resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", reject);
    
    archive.pipe(output);
    
    // Whitelist approach: only include *.ts, *.svg, package*.json, tsconfig*.json, 
    // index.html, vite.config.ts, and prompt-template.md
    // Also explicitly exclude TEST_* directories (test isolation directories)
    const allowedExtensions = [".ts", ".svg"];
    const allowedFiles = ["package.json", "package-lock.json", "tsconfig.json", "index.html"];
    
    // Filter returns false to skip, or entry data to include
    const fileFilter = (entry: { name: string }) => {
      // Exclude TEST_* directories anywhere in the path
      if (/[/\\]TEST_/.test(entry.name) || entry.name.startsWith("TEST_")) {
        return false;
      }
      const ext = path.extname(entry.name);
      const base = path.basename(entry.name);
      if (allowedExtensions.includes(ext) || allowedFiles.includes(base)) {
        return entry; // include with original entry data
      }
      return false; // skip
    };
    
    // Source directories (filtered to whitelist)
    archive.directory(path.join(resolvedRoot, "server", "src"), "server/src", fileFilter);
    archive.directory(path.join(resolvedRoot, "client", "src"), "client/src", fileFilter);
    archive.directory(path.join(resolvedRoot, "scripts"), "scripts", fileFilter);
    
    // Root package files
    archive.file(path.join(resolvedRoot, "package.json"), { name: "package.json" });
    archive.file(path.join(resolvedRoot, "package-lock.json"), { name: "package-lock.json" });
    archive.file(path.join(resolvedRoot, "tsconfig.base.json"), { name: "tsconfig.base.json" });
    
    // Server package/config
    archive.file(path.join(resolvedRoot, "server", "package.json"), { name: "server/package.json" });
    archive.file(path.join(resolvedRoot, "server", "tsconfig.json"), { name: "server/tsconfig.json" });
    
    // Client package/config/build
    archive.file(path.join(resolvedRoot, "client", "package.json"), { name: "client/package.json" });
    archive.file(path.join(resolvedRoot, "client", "tsconfig.json"), { name: "client/tsconfig.json" });
    archive.file(path.join(resolvedRoot, "client", "index.html"), { name: "client/index.html" });
    archive.file(path.join(resolvedRoot, "client", "vite.config.ts"), { name: "client/vite.config.ts" });
    
    // Prompt template (used by chatbot)
    archive.file(path.join(resolvedRoot, "dataConfig", "prompt-template.md"), { name: "dataConfig/prompt-template.md" });
    
    archive.finalize();
  });
}

// Run standalone if executed directly
// Check if this file is being run directly (not imported)
const runningDirectly = process.argv[1]?.includes("create-deploy-zip");
if (runningDirectly) {
  const sourceRoot = process.argv[2];
  const outputPath = process.argv[3];
  
  if (!sourceRoot) {
    console.error("Usage: npx tsx scripts/create-deploy-zip.ts <sourceRoot> [outputPath]");
    process.exit(1);
  }
  
  createDeploymentZip(sourceRoot, outputPath)
    .then(zipPath => {
      const stats = fs.statSync(zipPath);
      console.log(zipPath);
      console.error(`Created ${(stats.size / 1024).toFixed(1)} KB`);
    })
    .catch(err => {
      console.error("Failed to create zip:", err);
      process.exit(1);
    });
}
