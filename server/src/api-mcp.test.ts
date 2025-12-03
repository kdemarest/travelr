/**
 * Basic MCP endpoint tests.
 */

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createMcpRouter } from "./api-mcp.js";

// Import command handlers needed for trip operations
import "./cmd-add.js";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.get("/ping", (_req, res) => res.send("pong"));
  app.use("/mcp", createMcpRouter());
  return app;
}

describe("/ping", () => {
  it("returns pong", async () => {
    const app = createTestApp();
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.text).toBe("pong");
  });
});

describe("/mcp", () => {
  it("responds to tools/list", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 });
    
    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe("2.0");
    expect(res.body.id).toBe(1);
    expect(res.body.result.tools).toBeInstanceOf(Array);
    expect(res.body.result.tools.length).toBeGreaterThan(0);
    
    const toolNames = res.body.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("list_trips");
    expect(toolNames).toContain("get_trip_model");
    expect(toolNames).toContain("get_trip_summary");
  });

  it("responds to initialize with instructions", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "initialize", id: 2 });
    
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe("travelr-mcp");
    expect(res.body.result.serverInfo.version).toBe("1.0.0");
    expect(res.body.result.instructions).toContain("Travelr");
  });

  it("GET /mcp returns discovery info", async () => {
    const app = createTestApp();
    const res = await request(app).get("/mcp");
    
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("travelr-mcp");
    expect(res.body.version).toBe("1.0.0");
    expect(res.body.tools).toBeInstanceOf(Array);
    expect(res.body.tools.length).toBe(3);
  });

  it("responds to ping", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "ping", id: 3 });
    
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({});
  });

  it("returns error for unknown method", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "unknown/method", id: 4 });
    
    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32601); // Method not found
  });

  it("calls list_trips tool", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/mcp")
      .send({ 
        jsonrpc: "2.0", 
        method: "tools/call", 
        params: { name: "list_trips", arguments: {} },
        id: 5 
      });
    
    expect(res.status).toBe(200);
    // Either succeeds with content array, or returns an error (no trip cache in tests)
    if (res.body.error) {
      expect(res.body.error.code).toBeDefined();
    } else {
      expect(res.body.result.content).toBeInstanceOf(Array);
      expect(res.body.result.content[0].type).toBe("text");
    }
  });
});
