/**
 * Fixes positional arguments in .travlrjournal files.
 * Converts "/command barevalue ..." to "/command key=barevalue ..."
 * 
 * Usage: npx ts-node scripts/fix-positional-args.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Positional key mapping - must match what's in cmd-*.ts files
const POSITIONAL_KEYS: Record<string, string> = {
  add: "activityType",
  edit: "uid",
  delete: "uid",
  deletealarm: "uid",
  enablealarm: "uid",
  disablealarm: "uid",
  newtrip: "tripId",
  trip: "target",
  model: "target",
  undo: "count",
  redo: "count",
  websearch: "query",
  addcountry: "countryName",
};

function normalizePositionalArg(line: string): string {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return line;
  }

  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const spaceIndex = trimmed.indexOf(" ");

  // No arguments at all
  if (spaceIndex === -1) {
    return line;
  }

  const keyword = trimmed.slice(1, spaceIndex).toLowerCase();
  const positionalKey = POSITIONAL_KEYS[keyword];

  // This command doesn't have a positional argument
  if (!positionalKey) {
    return line;
  }

  const argsText = trimmed.slice(spaceIndex + 1).trimStart();
  if (!argsText) {
    return line;
  }

  // Check if the first thing is a quoted string
  if (argsText.startsWith('"')) {
    // Find the end of the quoted string
    let index = 1;
    let escaped = false;
    while (index < argsText.length) {
      const char = argsText[index];
      if (char === '"' && !escaped) {
        // Found end of quoted value
        const quotedValue = argsText.slice(0, index + 1);
        const rest = argsText.slice(index + 1).trimStart();
        return `${leadingWhitespace}/${keyword} ${positionalKey}=${quotedValue}${rest ? " " + rest : ""}`;
      }
      escaped = char === "\\" && !escaped;
      index++;
    }
    // Unterminated quote - leave as-is
    return line;
  }

  // Check if first token is a bare value (no =)
  const firstTokenEnd = argsText.search(/\s|$/);
  const firstToken = firstTokenEnd === -1 ? argsText : argsText.slice(0, firstTokenEnd);

  // If it contains =, it's already a key=value, not positional
  if (firstToken.includes("=")) {
    return line;
  }

  // Convert positional to key=value
  const rest = firstTokenEnd === -1 ? "" : argsText.slice(firstTokenEnd).trimStart();
  const needsQuotes = /[\s"]/.test(firstToken);
  const formattedValue = needsQuotes ? JSON.stringify(firstToken) : `"${firstToken}"`;

  return `${leadingWhitespace}/${keyword} ${positionalKey}=${formattedValue}${rest ? " " + rest : ""}`;
}

function processFile(filePath: string, dryRun: boolean): { changed: number; file: string } {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  let changed = 0;

  const newLines = lines.map((line, i) => {
    const normalized = normalizePositionalArg(line);
    if (normalized !== line) {
      changed++;
      if (dryRun) {
        console.log(`  Line ${i + 1}:`);
        console.log(`    - ${line}`);
        console.log(`    + ${normalized}`);
      }
    }
    return normalized;
  });

  if (changed > 0 && !dryRun) {
    fs.writeFileSync(filePath, newLines.join("\n"), "utf-8");
  }

  return { changed, file: path.basename(filePath) };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const dataTripsDir = path.join(__dirname, "..", "dataTrips");
  const files = fs.readdirSync(dataTripsDir).filter(f => f.endsWith(".travlrjournal"));

  if (dryRun) {
    console.log("DRY RUN - no files will be modified\n");
  }

  let totalChanged = 0;
  for (const file of files) {
    const filePath = path.join(dataTripsDir, file);
    if (dryRun) {
      console.log(`Checking ${file}:`);
    }
    const result = processFile(filePath, dryRun);
    if (result.changed > 0) {
      totalChanged += result.changed;
      if (!dryRun) {
        console.log(`Updated ${result.file}: ${result.changed} lines fixed`);
      }
    }
  }

  console.log(`\nTotal: ${totalChanged} lines ${dryRun ? "would be" : ""} fixed`);
}

main();
