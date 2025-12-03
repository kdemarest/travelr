export interface Activity {
  uid?: string;
  activityType?: string;
  name?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  duration?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: "idea" | "planned" | "booked" | "completed" | "cancelled";
  price?: number;
  currency?: string;
  currencyAndPrice?: string;
  paymentMade?: boolean;
  paymentMethod?: string;
  paymentDate?: string;
  notesUser?: string;
  notesAi?: string;
  [key: string]: unknown;
}

export interface CountryInfo {
  country: string;
  id: string;
  countryAlpha2: string;
  currencyAlpha3: string;
  exchangeRateToUSD: number;
}

export interface DaySummary {
  date: string;
  dayOfWeek: string;
  hasPotentialLodging: boolean;
  lodgingBooked: boolean;
  issueMoreThanOneLodging: boolean;
  issueNoLodging: boolean;
  lodgingCity: string | null;
  flightCount: number;
  flightBooked: boolean;
  hasRentalCar: boolean;
  rentalCarBooked: boolean;
  issueMoreThanOneRentalCar: boolean;
  activityCount: number;
  activityUids: string[];
  activitiesWithoutTimes: number;
  activitiesNeedingBooking: number;
  mainActivityUid: string | null;
  mealsDiningOut: number;
  mealsNeedingReservation: number;
  totalCostUSD: number;
  earliestTime: string | null;
  latestTime: string | null;
  hasIdeas: boolean;
  hasCancelled: boolean;
  issueActivitiesWithMismatchedBookingDates: string;  // space-separated UIDs where date ≠ bookingDate
  issueNoTransportToLodging: boolean;
  issueNoTransportToFlight: boolean;
}

export interface Alarm {
  uid: string;
  tripId: string;
  
  // Either relative to activity OR absolute time
  activityUid?: string;      // if set, alarm time is computed from activity
  minutesBefore?: number;    // minutes before activity start (default: 30)
  
  // Absolute time (used when no activityUid, or as computed cache)
  date?: string;             // "2025-12-15"
  time?: string;             // "09:00"
  
  // Display
  label: string;
  location?: string;         // geofence address or "lat,lng"
  
  // State
  enabled: boolean;
  dismissed?: boolean;       // user stopped this specific alarm instance
}

export interface TripModel {
  tripName: string;
  tripId?: string;
  activities: Activity[];
  countries?: CountryInfo[];
  daySummaries?: DaySummary[];
  alarms?: Alarm[];
}

/**
 * Create an empty TripModel with the given trip name.
 */
export function createEmptyTripModel(tripName: string): TripModel {
  return {
    tripName,
    tripId: tripName,
    activities: [],
    countries: []
  };
}
