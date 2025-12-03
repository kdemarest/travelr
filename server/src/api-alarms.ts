/**
 * Alarms API endpoint for mobile app polling.
 * 
 * GET /api/alarms - Get all alarms across trips with CRC for efficient polling
 * 
 * Query params:
 *   crc - If provided and matches current alarms hash, returns { unchanged: true }
 * 
 * Returns:
 *   { alarms: Alarm[], crc: string } or { unchanged: true }
 */

import { Router, Request, Response } from "express";
import { createHash } from "node:crypto";
import { rebuildModel } from "./journal-state.js";
import type { TripCache } from "./trip-cache.js";
import type { Alarm, Activity } from "./types.js";

export function createAlarmsRouter(tripCache: TripCache): Router {
  const router = Router();

  router.get("/alarms", async (req: Request, res: Response) => {
    try {
      const clientCrc = req.query.crc as string | undefined;
      
      // Get all trips
      const trips = await tripCache.listTrips();
      
      // Collect all alarms from all trips
      const allAlarms: AlarmWithComputed[] = [];
      
      for (const tripName of trips) {
        const trip = await tripCache.getTrip(tripName);
        const model = rebuildModel(trip);
        if (!model?.alarms) continue;
        
        for (const alarm of model.alarms) {
          // Compute actual alarm time for activity-linked alarms
          const computed = computeAlarmDateTime(alarm, model.activities);
          allAlarms.push({
            ...alarm,
            ...computed,
            tripName
          });
        }
      }
      
      // Sort by date/time (soonest first)
      allAlarms.sort((a, b) => {
        const aDateTime = `${a.date ?? "9999-99-99"}T${a.time ?? "99:99"}`;
        const bDateTime = `${b.date ?? "9999-99-99"}T${b.time ?? "99:99"}`;
        return aDateTime.localeCompare(bDateTime);
      });
      
      // Compute CRC of alarms
      const crc = computeAlarmsCrc(allAlarms);
      
      // If client CRC matches, return unchanged
      if (clientCrc && clientCrc === crc) {
        return res.json({ unchanged: true, crc });
      }
      
      // Return alarms with CRC
      res.json({ alarms: allAlarms, crc });
    } catch (error) {
      console.error("Failed to get alarms:", error);
      res.status(500).json({ ok: false, error: "Failed to get alarms" });
    }
  });

  return router;
}

interface AlarmWithComputed extends Alarm {
  tripName: string;
}

/**
 * Compute alarm date/time for activity-linked alarms
 */
function computeAlarmDateTime(
  alarm: Alarm,
  activities: Activity[]
): { date?: string; time?: string } {
  // If not linked to activity, use stored date/time
  if (!alarm.activityUid) {
    return { date: alarm.date, time: alarm.time };
  }
  
  // Find the activity
  const activity = activities.find(a => a.uid === alarm.activityUid);
  if (!activity?.date || !activity?.time) {
    // Activity not found or missing date/time, use stored values
    return { date: alarm.date, time: alarm.time };
  }
  
  // Compute alarm time by subtracting minutesBefore
  const minutesBefore = alarm.minutesBefore ?? 30;
  const dateTime = new Date(`${activity.date}T${activity.time}:00`);
  dateTime.setMinutes(dateTime.getMinutes() - minutesBefore);
  
  const date = dateTime.toISOString().slice(0, 10);
  const time = dateTime.toTimeString().slice(0, 5);
  
  return { date, time };
}

/**
 * Compute CRC/hash of alarms for change detection
 */
function computeAlarmsCrc(alarms: AlarmWithComputed[]): string {
  // Create a stable string representation
  const data = alarms.map(a => ({
    uid: a.uid,
    tripId: a.tripId,
    tripName: a.tripName,
    activityUid: a.activityUid,
    minutesBefore: a.minutesBefore,
    date: a.date,
    time: a.time,
    label: a.label,
    location: a.location,
    enabled: a.enabled,
    dismissed: a.dismissed
  }));
  
  const json = JSON.stringify(data);
  return createHash("md5").update(json).digest("hex");
}
