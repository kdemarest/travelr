#!/usr/bin/env npx tsx
/**
 * Verify a password against a stored hash, or against a user in users.json
 * 
 * Usage:
 *   npx tsx scripts/verifyPassword.ts <password> <hash>
 *   npx tsx scripts/verifyPassword.ts <password> --user <username>
 * 
 * Examples:
 *   npx tsx scripts/verifyPassword.ts mySecret123 "salt:hash"
 *   npx tsx scripts/verifyPassword.ts mySecret123 --user deploybot
 */

import { scrypt, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage:");
    console.log("  npx tsx scripts/verifyPassword.ts <password> <hash>");
    console.log("  npx tsx scripts/verifyPassword.ts <password> --user <username>");
    process.exit(1);
  }

  const password = args[0];
  let storedHash: string;
  let label: string;

  if (args[1] === "--user") {
    const username = args[2];
    if (!username) {
      console.error("Error: --user requires a username");
      process.exit(1);
    }

    const usersPath = path.join(__dirname, "..", "dataUsers", "users.json");
    if (!fs.existsSync(usersPath)) {
      console.error(`Error: users.json not found at ${usersPath}`);
      process.exit(1);
    }

    const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    const user = users[username];
    if (!user) {
      console.error(`Error: User '${username}' not found in users.json`);
      console.log("Available users:", Object.keys(users).join(", "));
      process.exit(1);
    }

    storedHash = user.password;
    label = `user '${username}'`;
  } else {
    storedHash = args[1];
    label = "provided hash";
  }

  console.log(`Password: ${password}`);
  console.log(`Checking against: ${label}`);
  console.log(`Hash: ${storedHash.substring(0, 40)}...`);
  console.log();

  try {
    const match = await verifyPassword(password, storedHash);
    if (match) {
      console.log("✓ MATCH - Password is correct");
      process.exit(0);
    } else {
      console.log("✗ NO MATCH - Password is incorrect");
      process.exit(1);
    }
  } catch (err) {
    console.error("Error verifying password:", err);
    process.exit(1);
  }
}

main();
