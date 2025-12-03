/**
 * Centralized path configuration for the server.
 * 
 * CODE paths: Where source code lives (relative to __dirname)
 *   - Immutable, shared across all instances
 *   - Used for scripts, client/dist, catalog
 * 
 * DATA paths: Where runtime data lives (relative to process.cwd())
 *   - Mutable, instance-specific
 *   - Allows test isolation: `cd TEST_5000 && node ../server/dist/index.js`
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const Paths = {
  // CODE: Where the source code lives (immutable, shared)
  codeRoot: path.resolve(__dirname, "../.."),
  get scripts() { return path.join(this.codeRoot, "scripts"); },
  get clientDist() { return path.join(this.codeRoot, "client/dist"); },
  get catalog() { return path.join(this.codeRoot, "dataCountries"); },
  get serverDist() { return path.join(this.codeRoot, "server/dist"); },

  // DATA: Where runtime data lives (cwd, isolated in tests)
  dataRoot: process.cwd(),
  get dataUsers() { return path.join(this.dataRoot, "dataUsers"); },
  get dataTrips() { return path.join(this.dataRoot, "dataTrips"); },
  get dataUserPrefs() { return path.join(this.dataRoot, "dataUserPrefs"); },
  get dataConfig() { return path.join(this.dataRoot, "dataConfig"); },
  get dataDiagnostics() { return path.join(this.dataRoot, "dataDiagnostics"); },
  get dataTemp() { return path.join(this.dataRoot, "dataTemp"); },
  get pidFile() { return path.join(this.dataRoot, "server.pid"); },
};
