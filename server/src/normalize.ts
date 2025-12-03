import { CommandError } from "./errors.js";
import { normalizeUserDate } from "./normalize-date.js";
import { normalizeUserTime } from "./normalize-time.js";
import { generateUid } from "./uid.js";
import { getCommandMetadata } from "./command-registry.js";
import { CommandWithArgs } from "./command.js";

const DATE_ARG_PATTERN = /\bdate=("(?:\\.|[^"\\])*"|[^\s]+)/gi;
const TIME_ARG_PATTERN = /\btime=("(?:\\.|[^"\\])*"|[^\s]+)/gi;

export interface FocusSummaryDetails {
  focusedActivityUid?: string | null;
}

export interface CommandTextNormalizationOptions {
  focus?: FocusSummaryDetails;
  referenceDate?: Date;
}

export function parseFocusSummary(input?: string): FocusSummaryDetails {
  if (typeof input !== "string" || !input.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    const focusedActivityUid = typeof parsed?.focusedActivityUid === "string" ? parsed.focusedActivityUid : null;
    return { focusedActivityUid };
  } catch {
    return {};
  }
}

/**
 * If the command has a positional argument (a leading bare value without key=),
 * convert it to the canonical key=value form.
 */
function normalizePositionalArg(line: string): string {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return line;
  }

  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const spaceIndex = trimmed.indexOf(" ");
  
  // No arguments at all
  if (spaceIndex === -1) {
    return line;
  }

  const keyword = trimmed.slice(1, spaceIndex).toLowerCase();
  const metadata = getCommandMetadata(keyword);
  
  // This command doesn't have a positional argument
  if (!metadata?.positionalKey) {
    return line;
  }
  const positionalKey = metadata.positionalKey;

  const argsText = trimmed.slice(spaceIndex + 1).trimStart();
  if (!argsText) {
    return line;
  }

  // Check if the first thing is a quoted string
  if (argsText.startsWith('"')) {
    // Find the end of the quoted string
    let index = 1;
    let escaped = false;
    while (index < argsText.length) {
      const char = argsText[index];
      if (char === '"' && !escaped) {
        // Found end of quoted value
        const quotedValue = argsText.slice(0, index + 1);
        const rest = argsText.slice(index + 1).trimStart();
        return `${leadingWhitespace}/${keyword} ${positionalKey}=${quotedValue}${rest ? " " + rest : ""}`;
      }
      escaped = char === "\\" && !escaped;
      index++;
    }
    // Unterminated quote - leave as-is
    return line;
  }

  // Check if first token is a bare value (no =)
  const firstTokenEnd = argsText.search(/\s|$/);
  const firstToken = firstTokenEnd === -1 ? argsText : argsText.slice(0, firstTokenEnd);
  
  // If it contains =, it's already a key=value, not positional
  if (firstToken.includes("=")) {
    return line;
  }

  // Convert positional to key=value
  const rest = firstTokenEnd === -1 ? "" : argsText.slice(firstTokenEnd).trimStart();
  const needsQuotes = /[\s"]/.test(firstToken);
  const formattedValue = needsQuotes ? JSON.stringify(firstToken) : firstToken;
  
  return `${leadingWhitespace}/${keyword} ${positionalKey}=${formattedValue}${rest ? " " + rest : ""}`;
}

export function normalizeCommandLine(line: string): CommandWithArgs {
  let current = line;
  current = convertUnknownCommandToEdit(current);
  current = normalizePositionalArg(current);
  let commandObj = new CommandWithArgs(current);
  normalizeDateFields(commandObj);
  normalizeTimeFields(commandObj);
  return commandObj;
}

function convertUnknownCommandToEdit(line: string): string {

  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return line;
  }

  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const spaceIndex = trimmed.indexOf(" ");
  const keyword = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
  // keyword includes the leading slash, strip it for lookup
  if (getCommandMetadata(keyword.slice(1))) {
    return line;
  }

  const fieldName = keyword.slice(1);
  if (!fieldName) {
    return line;
  }

  const rawValue = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
  if (!rawValue) {
    return line;
  }

  const encodedValue = JSON.stringify(rawValue);
  return `${leadingWhitespace}/edit ${fieldName}=${encodedValue}`;
}

export function normalizeDateFields(command: CommandWithArgs): void {	
  const dateValue = command.args["date"];
  if (!dateValue) {
    return;
  }

  const normalized = normalizeUserDate(dateValue, new Date());
  if (normalized) {
    command.args["date"] = normalized;
  }
}

export function normalizeTimeFields(command: CommandWithArgs): void {
  const timeValue = command.args["time"];
  if (!timeValue) {
    return;
  }

  const normalized = normalizeUserTime(timeValue);
  if (normalized) {
    command.args["time"] = normalized;
  }
}
