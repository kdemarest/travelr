export interface NewTripCommand {
  commandId: "newtrip";
  tripId: string;
}

export interface AddCommand {
  commandId: "add";
  activityType: string;
  fields: Record<string, string>;
  uid?: string;
}

export interface EditCommand {
  commandId: "edit";
  uid: string;
  changes: Record<string, string>;
}

export interface DeleteCommand {
  commandId: "delete";
  uid: string;
}

export interface HelpCommand {
  commandId: "help";
}

export interface WhoAmICommand {
  commandId: "whoami";
}

export interface TripCommand {
  commandId: "trip";
  target?: string;
}

export interface ModelCommand {
  commandId: "model";
  target?: string;
}

export interface WebSearchCommand {
  commandId: "websearch";
  query: string;
}

export interface AddCountryCommand {
  commandId: "addcountry";
  countryName: string;
  countryAlpha2?: string;
  currencyAlpha3?: string;
  id?: string;
  exchangeRateToUSD?: number;
  exchangeRateLastUpdate?: string;
}

export interface RefreshCountriesCommand {
  commandId: "refreshcountries";
}

export interface UserPrefCommand {
  commandId: "userpref";
  key: string;
  value: unknown;
}

export interface UndoCommand {
  commandId: "undo";
  count: number;
}

export interface RedoCommand {
  commandId: "redo";
  count: number;
}

export interface MarkCommand {
  commandId: "mark";
  markType: "activities" | "dates";
  add: string[];
  remove: string[];
}

export interface IntentCommand {
  commandId: "intent";
  what: string;
}

export interface MoveDayCommand {
  commandId: "moveday";
  from: string;  // YYYY-MM-DD format
  to: string;    // YYYY-MM-DD format
}

export interface InsertDayCommand {
  commandId: "insertday";
  after: string;  // Insert a blank day after this date, pushing subsequent days forward
}

export interface RemoveDayCommand {
  commandId: "removeday";
  date: string;   // Remove this day, pulling subsequent days backward
}

export interface SetAlarmCommand {
  commandId: "setalarm";
  uid?: string;              // alarm uid (generated if not provided)
  
  // Either relative to activity...
  activityUid?: string;      // activity to attach alarm to
  minutesBefore?: number;    // minutes before activity (default: 30)
  
  // ...or absolute time
  date?: string;             // YYYY-MM-DD
  time?: string;             // HH:MM
  
  // Display
  label?: string;            // alarm description
  location?: string;         // geofence location
}

export interface DeleteAlarmCommand {
  commandId: "deletealarm";
  uid: string;               // alarm uid to delete
}

export interface EnableAlarmCommand {
  commandId: "enablealarm";
  uid: string;               // alarm uid to enable
}

export interface DisableAlarmCommand {
  commandId: "disablealarm";
  uid: string;               // alarm uid to disable
}

export type ParsedCommand =
  | NewTripCommand
  | AddCommand
  | EditCommand
  | DeleteCommand
  | UndoCommand
  | RedoCommand
  | HelpCommand
  | WhoAmICommand
  | TripCommand
  | ModelCommand
  | WebSearchCommand
  | AddCountryCommand
  | RefreshCountriesCommand
  | UserPrefCommand
  | MarkCommand
  | IntentCommand
  | MoveDayCommand
  | InsertDayCommand
  | RemoveDayCommand
  | SetAlarmCommand
  | DeleteAlarmCommand
  | EnableAlarmCommand
  | DisableAlarmCommand;
