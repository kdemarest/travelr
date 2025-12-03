/**
 * MCP (Model Context Protocol) HTTP endpoint for ChatGPT connectors.
 * 
 * Exposes read-only tools for querying trip data.
 * See: https://platform.openai.com/docs/guides/tools
 * 
 * Routes:
 *   POST /api/mcp - JSON-RPC 2.0 endpoint for MCP protocol
 */

import { Router, type Request, type Response } from "express";
import { getTripCache } from "./trip-cache.js";
import { rebuildModel } from "./journal-state.js";
import { finalizeModel } from "./finalize-model.js";

// --- Tool Definitions ---

const TOOLS = [
  {
    name: "list_trips",
    description: "List all available trips. Returns an array of trip IDs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "get_trip_model",
    description: "Get the full compiled model for a specific trip, including all activities, days, countries, and alarms.",
    inputSchema: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description: "The ID of the trip to retrieve"
        }
      },
      required: ["tripId"]
    }
  },
  {
    name: "get_trip_summary",
    description: "Get a brief summary of a trip: date range, countries visited, and activity count.",
    inputSchema: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description: "The ID of the trip to summarize"
        }
      },
      required: ["tripId"]
    }
  }
];

// --- Tool Handlers ---

async function handleListTrips(): Promise<unknown> {
  const tripCache = getTripCache();
  const trips = await tripCache.listTrips();
  return { trips };
}

async function handleGetTripModel(args: { tripId: string }): Promise<unknown> {
  const tripCache = getTripCache();
  
  if (!await tripCache.tripExists(args.tripId)) {
    return { error: `Trip '${args.tripId}' not found` };
  }
  
  const trip = await tripCache.getTrip(args.tripId);
  const model = rebuildModel(trip);
  const finalizedModel = finalizeModel(model);
  
  return { tripId: args.tripId, model: finalizedModel };
}

async function handleGetTripSummary(args: { tripId: string }): Promise<unknown> {
  const tripCache = getTripCache();
  
  if (!await tripCache.tripExists(args.tripId)) {
    return { error: `Trip '${args.tripId}' not found` };
  }
  
  const trip = await tripCache.getTrip(args.tripId);
  const model = rebuildModel(trip);
  const finalizedModel = finalizeModel(model);
  
  const countries = (finalizedModel.countries ?? []).map(c => c.country);
  const activityCount = finalizedModel.activities.length;
  const daySummaries = finalizedModel.daySummaries ?? [];
  const dayCount = daySummaries.length;
  
  // Find date range from day summaries
  const dates = daySummaries.map(d => d.date).filter(Boolean).sort();
  const startDate = dates[0] || null;
  const endDate = dates[dates.length - 1] || null;
  
  return {
    tripId: args.tripId,
    summary: {
      startDate,
      endDate,
      dayCount,
      activityCount,
      countries
    }
  };
}

// --- MCP Protocol Handler ---

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function handleMcpRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = req;
  
  try {
    switch (method) {
      // MCP discovery: list available tools
      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TOOLS }
        };
      }
      
      // MCP tool invocation
      case "tools/call": {
        const { name, arguments: args } = params as { name: string; arguments: unknown };
        
        let result: unknown;
        switch (name) {
          case "list_trips":
            result = await handleListTrips();
            break;
          case "get_trip_model":
            result = await handleGetTripModel(args as { tripId: string });
            break;
          case "get_trip_summary":
            result = await handleGetTripSummary(args as { tripId: string });
            break;
          default:
            return {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Unknown tool: ${name}` }
            };
        }
        
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
        };
      }
      
      // MCP initialization (required handshake)
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "travelr-mcp",
              version: "1.0.0"
            },
            instructions: "This is the Travelr travel planning server. Use these tools when the user asks about their trips, travel itineraries, activities, or destinations. You can list available trips, get full trip details, or get trip summaries."
          }
        };
      }
      
      // Ping for health check
      case "ping": {
        return {
          jsonrpc: "2.0",
          id,
          result: {}
        };
      }
      
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` }
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message }
    };
  }
}

// --- Express Router ---

export function createMcpRouter(): Router {
  const router = Router();
  
  // Main MCP endpoint - handles JSON-RPC requests
  router.post("/", async (req: Request, res: Response) => {
    const request = req.body as JsonRpcRequest;
    
    if (!request.jsonrpc || request.jsonrpc !== "2.0") {
      res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request" }
      });
      return;
    }
    
    console.log(`[MCP] ${request.method}`, request.params ? JSON.stringify(request.params) : "");
    
    const response = await handleMcpRequest(request);
    res.json(response);
  });
  
  // Simple GET for discovery/health check
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "travelr-mcp",
      version: "1.0.0",
      description: "MCP server for Travelr trip data",
      tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
    });
  });
  
  return router;
}
