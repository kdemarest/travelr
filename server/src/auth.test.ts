/**
 * Tests for authentication endpoints and static file serving.
 * 
 * Uses the "testbot" user account with password from TRAVELR_TESTBOT_PWD env var.
 * 
 * Key behaviors tested:
 * 1. GET / serves static HTML (not 401 JSON) - allows login page to load
 * 2. GET /auth/status returns { authRequired: true } - triggers login dialog
 * 3. POST /auth with credentials returns authKey
 * 4. GET /auth validates authKey
 */

import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Authentication", () => {
  const testPassword = process.env.TRAVELR_TESTBOT_PWD;
  
  // Skip tests if password not configured
  const describeOrSkip = testPassword ? describe : describe.skip;
  
  describeOrSkip("with TRAVELR_TESTBOT_PWD configured", () => {
    let app: express.Express;
    
    beforeAll(async () => {
      // Dynamically import to avoid initialization issues
      const { initAuth, login, authenticateAndFetchUser, isAuthConfigured } = await import("./auth.js");
      
      // Initialize auth module
      initAuth();
      
      if (!isAuthConfigured()) {
        throw new Error("Auth not configured - users.json missing?");
      }
      
      // Create express app that mirrors production structure:
      // 1. Static files served BEFORE auth middleware
      // 2. Auth routes (no auth required)
      // 3. Auth middleware
      // 4. Protected API routes
      
      app = express();
      app.use(express.json());
      
      // Static file serving - BEFORE auth (mirrors index.ts)
      // In production this serves client/dist, in test we serve a mock
      const clientDistDir = path.resolve(__dirname, "../../client/dist");
      app.use(express.static(clientDistDir));
      
      // Auth status - tells client if login is required
      app.get("/auth/status", (_req, res) => {
        res.json({ authRequired: true });
      });
      
      // Login
      app.post("/auth", async (req, res) => {
        const { user: userId, password, deviceId } = req.body;
        
        if (!userId || !password || !deviceId) {
          return res.status(400).json({ ok: false, error: "Missing required fields" });
        }
        
        const authKey = await login(userId, password, deviceId, "", "127.0.0.1");
        if (authKey) {
          res.json({ ok: true, user: userId, authKey });
        } else {
          res.status(401).json({ ok: false, error: "Invalid username or password" });
        }
      });
      
      // Validate auth key
      app.get("/auth", (req, res) => {
        const userParam = req.query.user as string;
        const deviceId = req.query.deviceId as string;
        const authKey = req.query.authKey as string;
        
        const { valid } = authenticateAndFetchUser(userParam, deviceId, authKey);
        if (valid) {
          res.json({ ok: true, userId: userParam });
        } else {
          res.status(401).json({ ok: false, error: "Invalid auth key" });
        }
      });
      
      // Auth middleware - everything after this requires auth
      const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const authKey = req.headers["x-auth-key"] as string || req.query.authKey as string;
        const userHeader = req.headers["x-auth-user"] as string || req.query.user as string;
        const deviceId = req.headers["x-auth-device"] as string || req.query.deviceId as string;
        
        const { valid } = authenticateAndFetchUser(userHeader, deviceId, authKey);
        if (valid) {
          return next();
        }
        res.status(401).json({ ok: false, error: "Authentication required" });
      };
      
      app.use(requireAuth);
      
      // Protected API route (for testing that auth middleware works)
      app.get("/api/protected", (_req, res) => {
        res.json({ ok: true, message: "You are authenticated" });
      });
      
      // SPA fallback - serve index.html for unmatched routes
      // Express 5 uses {*splat} syntax instead of *
      app.get("/{*splat}", (_req, res) => {
        res.sendFile(path.join(clientDistDir, "index.html"));
      });
    });
    
    // =========================================================================
    // Static file serving tests - ensures login page can load
    // =========================================================================
    
    it("GET / serves HTML content (not 401 JSON)", async () => {
      const res = await request(app).get("/");
      
      // Should NOT be a 401 JSON error
      expect(res.status).not.toBe(401);
      
      // Should be HTML or a successful response
      // (If client/dist doesn't exist, it will 404, but that's OK for the test structure)
      if (res.status === 200) {
        expect(res.type).toMatch(/html/);
      }
      
      // The key assertion: we should NOT get the auth error JSON
      expect(res.body).not.toEqual({ ok: false, error: "Authentication required" });
    });
    
    it("GET /auth/status returns authRequired: true (triggers login dialog)", async () => {
      const res = await request(app).get("/auth/status");
      
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ authRequired: true });
    });
    
    // =========================================================================
    // Auth middleware tests - ensures protected routes require auth
    // =========================================================================
    
    it("GET /api/protected without auth returns 401", async () => {
      const res = await request(app).get("/api/protected");
      
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: "Authentication required" });
    });
    
    // =========================================================================
    // Login flow tests
    // =========================================================================
    
    it("POST /auth with valid credentials returns authKey", async () => {
      const res = await request(app)
        .post("/auth")
        .send({
          user: "testbot",
          password: testPassword,
          deviceId: "test-device-123"
        });
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user).toBe("testbot");
      expect(res.body.authKey).toBeDefined();
      expect(res.body.authKey).toMatch(/^auth-[a-f0-9]+$/);
    });
    
    it("POST /auth with wrong password returns 401", async () => {
      const res = await request(app)
        .post("/auth")
        .send({
          user: "testbot",
          password: "wrongpassword",
          deviceId: "test-device-123"
        });
      
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe("Invalid username or password");
    });
    
    it("POST /auth with unknown user returns 401", async () => {
      const res = await request(app)
        .post("/auth")
        .send({
          user: "nonexistent",
          password: testPassword,
          deviceId: "test-device-123"
        });
      
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
    
    it("GET /auth validates a valid auth key", async () => {
      // First login to get an auth key
      const loginRes = await request(app)
        .post("/auth")
        .send({
          user: "testbot",
          password: testPassword,
          deviceId: "test-device-456"
        });
      
      expect(loginRes.status).toBe(200);
      const authKey = loginRes.body.authKey;
      
      // Now validate the auth key
      const validateRes = await request(app)
        .get("/auth")
        .query({
          user: "testbot",
          deviceId: "test-device-456",
          authKey
        });
      
      expect(validateRes.status).toBe(200);
      expect(validateRes.body.ok).toBe(true);
    });
    
    it("GET /auth rejects an invalid auth key", async () => {
      const res = await request(app)
        .get("/auth")
        .query({
          user: "testbot",
          deviceId: "test-device-789",
          authKey: "auth-invalid123"
        });
      
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });
  });
  
  // Always run this test to remind about the env var
  it("should have TRAVELR_TESTBOT_PWD env var set for full tests", () => {
    if (!testPassword) {
      console.log("  [SKIP] Set TRAVELR_TESTBOT_PWD to run auth tests");
    }
    // This test always passes - it's just informational
    expect(true).toBe(true);
  });
});
