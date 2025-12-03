/**
 * Simple HTTP POST tester for dev server.
 * 
 * Usage:
 *   npx tsx scripts/post.ts <path> [json-body]
 * 
 * Examples:
 *   npx tsx scripts/post.ts /api/mcp '{"jsonrpc":"2.0","method":"tools/list","id":1}'
 *   npx tsx scripts/post.ts /api/mcp '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_trips"},"id":2}'
 *   npx tsx scripts/post.ts /ping
 */

const BASE_URL = "http://localhost:4000";

async function main() {
  const [, , path, bodyArg] = process.argv;

  if (!path) {
    console.log("Usage: npx tsx scripts/post.ts <path> [json-body]");
    console.log("");
    console.log("Examples:");
    console.log('  npx tsx scripts/post.ts /api/mcp \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'');
    console.log('  npx tsx scripts/post.ts /ping');
    process.exit(1);
  }

  const url = `${BASE_URL}${path}`;
  const method = bodyArg ? "POST" : "GET";
  
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (bodyArg) {
    try {
      // Validate it's valid JSON
      JSON.parse(bodyArg);
      options.body = bodyArg;
    } catch {
      console.error("Error: Body is not valid JSON");
      console.error("Received:", bodyArg);
      process.exit(1);
    }
  }

  console.log(`${method} ${url}`);
  if (bodyArg) {
    console.log(`Body: ${bodyArg}`);
  }
  console.log("---");

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    
    let body: unknown;
    if (contentType.includes("application/json")) {
      body = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(JSON.stringify(body, null, 2));
    } else {
      body = await response.text();
      console.log(`Status: ${response.status}`);
      console.log(body);
    }
  } catch (error) {
    if (error instanceof Error && error.cause) {
      const cause = error.cause as { code?: string };
      if (cause.code === "ECONNREFUSED") {
        console.error("Error: Connection refused. Is the dev server running on localhost:4000?");
        process.exit(1);
      }
    }
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
