import { CommandError } from "./errors.js";

const ARG_PATTERN = /([A-Za-z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;

export function parseArgs(input: string): Record<string, string> {
  const args: Record<string, string> = {};
  if (!input) {
    return args;
  }

  const matches = input.matchAll(ARG_PATTERN);
  for (const match of matches) {
    const [, key, rawValue] = match;
    args[key] = decodeValue(rawValue ?? "");
  }

  return args;
}

export function decodeValue(raw: string): string {
  if (raw.startsWith("\"")) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new CommandError("Invalid quoted string literal in command.");
    }
  }

  return raw;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^\d{2}:\d{2}$/;
export const TRIP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
