import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import path from "node:path";
import fs from "fs-extra";

// Import all command handlers to trigger registration
import "./cmd-add.js";
import "./cmd-addcountry.js";
import "./cmd-delete.js";
import "./cmd-deletealarm.js";
import "./cmd-disablealarm.js";
import "./cmd-edit.js";
import "./cmd-enablealarm.js";
import "./cmd-help.js";
import "./cmd-insertday.js";
import "./cmd-intent.js";
import "./cmd-mark.js";
import "./cmd-model.js";
import "./cmd-moveday.js";
import "./cmd-newtrip.js";
import "./cmd-redo.js";
import "./cmd-refreshcountries.js";
import "./cmd-removeday.js";
import "./cmd-setalarm.js";
import "./cmd-trip.js";
import "./cmd-undo.js";
import "./cmd-userpref.js";
import "./cmd-websearch.js";
import "./cmd-whoami.js";

import { TripCache, initTripCache } from "./trip-cache.js";
import {
  DEFAULT_MODEL,
  checkOpenAIConnection
} from "./gpt.js";
import { loadExchangeRateCatalog, refreshExchangeRateCatalogOnStartup, flushExchangeRateCatalog } from "./exchange.js";
import { createChatHandler } from "./api-chat.js";
import { createCommandRouteHandler } from "./api-command.js";
import { createAlarmsRouter } from "./api-alarms.js";
import { gptQueue } from "./gpt-queue.js";
import { checkSecretsOnStartup } from "./secrets.js";
import { login, authenticateAndFetchUser, logout, isAuthConfigured, initAuth, flushAuth, getLastTripId } from "./auth.js";
import { flushUserPreferences } from "./user-preferences.js";
import { populateBootstrapData } from "./cache-population.js";
import type { User } from "./user.js";
import { createMcpRouter } from "./api-mcp.js";

// Extend Express Request to include authenticated user
export interface AuthenticatedRequest extends Request {
  user: User;
}
import { loadConfig, getServerPort, shouldExpressServeStatic } from "./config.js";
import adminRouter, { isMaintenanceMode, getMaintenanceMessage } from "./api-admin.js";
import { initS3Sync, downloadFromS3, startPeriodicSync, shutdownSync } from "./s3-sync.js";
import { writePidFile, removePidFile } from "./pid-file.js";
import { Paths } from "./data-paths.js";

const dataTripsDir = Paths.dataTrips;
const clientDistDir = Paths.clientDist;
const tripCache = initTripCache(dataTripsDir);

async function ensureDataDir() {
  await fs.ensureDir(dataTripsDir);
}

async function bootstrap() {
  await ensureDataDir();
  await loadConfig();  // Load config early so other modules can use it
  
  // Initialize S3 sync if configured
  const s3Bucket = process.env.TRAVELR_S3_BUCKET;
  initS3Sync(s3Bucket);
  
  // Download data from S3 on startup (before loading any data)
  if (s3Bucket) {
    await downloadFromS3();
  }
  
  // Initialize auth module (load user data files)
  initAuth();
  
  // SECURITY: Verify auth configuration before starting
  // Auth is ALWAYS required - if no users exist, refuse to start
  if (!isAuthConfigured()) {
    console.error("=".repeat(60));
    console.error("FATAL: No users are configured in dataUsers/users.json!");
    console.error("Authentication is always required. Add at least one user.");
    console.error("Refusing to start in an insecure state.");
    console.error("=".repeat(60));
    process.exit(1);
  }
  
  await checkSecretsOnStartup();
  loadExchangeRateCatalog();
  await refreshExchangeRateCatalogOnStartup();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/ping", (_req, res) => {
    res.send("pong");
  });

  // =========================================================================
  // Authentication routes (unprotected - needed to log in)
  // =========================================================================
  
  // Check if auth is required
  app.get("/auth/status", (_req, res) => {
    res.json({ authRequired: true });
  });

  // Validate cached auth key
  app.get("/auth", async (req, res) => {
    const userIdParam = req.query.user as string;
    const deviceId = req.query.deviceId as string;
    const authKey = req.query.authKey as string;
    
    const { valid, user } = authenticateAndFetchUser(userIdParam, deviceId, authKey);
    if (valid && user) {
      const lastTripId = getLastTripId(user.userId);
      
      // Populate bootstrap data for client
      await populateBootstrapData(user);
      const clientDataCache = user.clientDataCache.getData();
      
      res.json({ ok: true, userId: user.userId, lastTripId, clientDataCache });
    } else {
      res.status(401).json({ ok: false, error: "Invalid or expired auth key" });
    }
  });

  // Login with username/password
  app.post("/auth", async (req, res) => {
    const { user: userId, password, deviceId, deviceInfo } = req.body;
    
    if (!userId || !password) {
      return res.status(400).json({ ok: false, error: "Missing user or password" });
    }
    
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: "Missing deviceId" });
    }
    
    // Get client IP (handles proxies)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() 
      || req.socket.remoteAddress 
      || "";
    
    const authKey = await login(userId, password, deviceId, deviceInfo || "", ip);
    if (authKey) {
      // Get the User object to populate bootstrap data
      const { user } = authenticateAndFetchUser(userId, deviceId, authKey);
      const lastTripId = getLastTripId(userId);
      
      if (user) {
        await populateBootstrapData(user);
        const clientDataCache = user.clientDataCache.getData();
        res.json({ ok: true, user: userId, authKey, lastTripId, clientDataCache });
      } else {
        res.json({ ok: true, user: userId, authKey, lastTripId });
      }
    } else {
      res.status(401).json({ ok: false, error: "Invalid username or password" });
    }
  });

  // Logout
  app.post("/auth/logout", (req, res) => {
    const userId = req.query.userId as string || req.body.userId;
    const deviceId = req.query.deviceId as string || req.body.deviceId;
    if (userId && deviceId) {
      logout(userId, deviceId);
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // MCP endpoint for ChatGPT connectors (no auth for now)
  // =========================================================================
  app.use("/mcp", createMcpRouter());

  // =========================================================================
  // Static file serving - BEFORE auth so the login page can load
  // The client app handles showing the login screen when API calls return 401
  // =========================================================================
  if (shouldExpressServeStatic()) {
    console.log(`Serving static files from ${clientDistDir}`);
    app.use(express.static(clientDistDir));
  }

  // =========================================================================
  // Auth middleware - protects EVERYTHING below this point
  // =========================================================================
  
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    // Check for auth in headers or query params
    const authKey = req.headers["x-auth-key"] as string || req.query.authKey as string;
    const userHeader = req.headers["x-auth-user"] as string || req.query.user as string;
    const deviceId = req.headers["x-auth-device"] as string || req.query.deviceId as string;
    
    const { valid, user } = authenticateAndFetchUser(userHeader, deviceId, authKey);
    if (valid && user) {
      // Attach user to request for downstream handlers
      (req as AuthenticatedRequest).user = user;
      return next();
    }
    
    // Not authenticated - return 401
    res.status(401).json({ ok: false, error: "Authentication required" });
  };

  // Apply auth middleware globally (everything after this requires auth)
  app.use(requireAuth);

  // Maintenance mode check - block data-modifying requests during deploy
  const checkMaintenance = (req: Request, res: Response, next: NextFunction) => {
    // Only block POST/PUT/PATCH/DELETE - allow GET for status checks
    if (isMaintenanceMode() && req.method !== "GET") {
      return res.status(503).json({ 
        ok: false, 
        maintenance: true,
        message: getMaintenanceMessage()
      });
    }
    next();
  };

  app.use(checkMaintenance);

  // =========================================================================
  // Admin routes (protected by isAdmin check)
  // =========================================================================
  app.use("/admin", adminRouter);

  // Mount alarms router (for mobile app polling)
  app.use("/api", createAlarmsRouter(tripCache));

  app.post("/api/trip/:tripName/command", createCommandRouteHandler(tripCache));

  app.get("/api/gpt/health", async (_req, res) => {
    try {
      await checkOpenAIConnection();
      res.json({ ok: true, model: DEFAULT_MODEL, message: `ChatGPT ${DEFAULT_MODEL} connected.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.get("/api/trip/:tripName/conversation", async (req, res) => {
    const tripName = req.params.tripName;
    try {
      const trip = await tripCache.getTrip(tripName);
      const history = trip.conversation.read();
      res.json({ ok: true, history });
    } catch (error) {
      console.error("Failed to read conversation history", { tripName, error });
      res.status(500).json({ ok: false, error: "Failed to load conversation history." });
    }
  });

  app.post("/api/trip/:tripName/chat", createChatHandler(tripCache));

  // Poll for chained GPT response by GUID
  app.get("/api/chain/:guid", async (req, res) => {
    const guid = req.params.guid;
    
    if (!gptQueue.has(guid)) {
      return res.status(404).json({ error: "GPT task not found or already retrieved." });
    }
    
    try {
      const result = await gptQueue.fetch(guid);
      if (!result) {
        return res.status(404).json({ error: "GPT task expired." });
      }
      
      res.json({
        ok: !result.error,
        text: result.text,
        model: result.model,
        executedCommands: result.executedCommands,
        updatedModel: result.updatedModel,
        chatbotActivityMarks: result.markedActivities,
        chatbotDateMarks: result.markedDates,
        pendingChatbot: result.nextGuid,
        error: result.error
      });
    } catch (error) {
      console.error("Failed to fetch GPT result", { guid, error });
      res.status(500).json({ error: "Failed to retrieve GPT response." });
    }
  });

  // SPA fallback - serve index.html for any unmatched routes (in production)
  if (shouldExpressServeStatic()) {
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDistDir, "index.html"));
    });
  }

  const port = getServerPort();
  const server = app.listen(port, () => {
    console.log(`Travelr API listening on http://localhost:${port}`);
    
    // Write PID file for hot-reload detection
    writePidFile();
    
    // Start periodic S3 sync (every 10 minutes)
    if (process.env.TRAVELR_S3_BUCKET) {
      startPeriodicSync(10);
    }
  });
  
  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    
    // Remove PID file first (signals to relaunch script we're shutting down)
    removePidFile();
    
    // Flush pending writes
    flushAuth();
    flushUserPreferences();
    flushExchangeRateCatalog();
    await tripCache.flushAllTrips();
    
    // Final S3 sync
    await shutdownSync();
    
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };
  
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
