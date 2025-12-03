/**
 * Get the PID of the process using a given port.
 * Usage: npx tsx scripts/portpid.ts <port>
 */
import netstat from "node-netstat";

const port = parseInt(process.argv[2], 10);
if (isNaN(port)) {
  console.error("Usage: npx tsx scripts/portpid.ts <port>");
  process.exit(1);
}

let found = false;

netstat({
  filter: { local: { port } },
  done: () => {
    if (!found) {
      console.log(`No process found on port ${port}`);
    }
    process.exit(found ? 0 : 1);
  }
}, (data: { pid: number; local: { port: number } }) => {
  if (data.local.port === port) {
    console.log(data.pid);
    found = true;
  }
});
