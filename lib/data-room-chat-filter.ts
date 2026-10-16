/**
 * data-room-chat-filter.ts
 * All-companies questions for the Data Room assistant (pure; no DB, no network). In
 * All companies mode no model picks or reads company data: the router returns up to
 * three conditions (filters) over public roster attributes, this module validates
 * them against a whitelist and runs them over the roster in code (different fields
 * must all match; two conditions on the same field mean either one, except
 * locations, where both must hold), and the answer lists the matching companies A–Z
 * from the database. Any other All-companies question gets one fixed reply. Used by
 * lib/data-room-chat-router.ts (filter validation) and POST /api/student/data-room-chat.
 */

import type { RouterDecision } from "@/lib/data-room-chat-router";
import { formatRosterListLine, type NameQueryCompany, type ScopedAnswer } from "@/lib/data-room-chat-scope";

// ── Config ───

/** How many conditions one All-companies question may filter by. */
export const MAX_FILTER_CRITERIA = 3;

/** Most companies one filter answer lists. */
export const MAX_FILTER_RESULTS = 20;

/** The reply to every All-companies question that isn't 1–3 valid conditions (or a name question). */
export const ALL_MODE_REPLY =
  "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking, up to 3 at a time. Open a company to research it in depth.";

export const NO_FILTER_MATCHES_REPLY = "No companies match that.";

/**
 * The intro of every filter answer with matches: "{n} companies match." ("1 company
 * matches."); with more than 20, the same line goes on to say only the first 20 are shown.
 */
export function matchCountIntro(count: number): string {
  if (count === 1) {
    return "1 company matches.";
  }
  const line = `${count} companies match.`;
  return count > MAX_FILTER_RESULTS
    ? `${line} Showing the first ${MAX_FILTER_RESULTS}; use the search box above the list to see the rest.`
    : line;
}

// ── Filter shape ───

export const FILTER_FIELDS = ["industry", "metro", "state", "locations", "territory", "online_booking"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPS = ["eq", "contains", "gt", "gte", "lt", "lte"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type RosterFilter = { field: FilterField; op: FilterOp; value: string | number | boolean };

/** Number comparisons for locations, with the spellings a model may use; anything else is invalid. */
const LOCATION_OPS: Record<string, FilterOp> = {
  eq: "eq", "=": "eq", "==": "eq", equals: "eq",
  gt: "gt", ">": "gt", greater_than: "gt", more_than: "gt",
  gte: "gte", ">=": "gte", at_least: "gte",
  lt: "lt", "<": "lt", less_than: "lt", fewer_than: "lt", under: "lt",
  lte: "lte", "<=": "lte", at_most: "lte",
};

/** A locations comparison as LOCATION_OPS spells it ("fewer than" → "fewer_than"); "" when missing. */
function locationOpKey(op: unknown): string {
  return typeof op === "string" ? op.trim().toLowerCase().replace(/\s+/g, "_") : "";
}

/** Yes/no values given as words. */
const BOOLEAN_WORDS: Record<string, boolean> = { true: true, yes: true, false: false, no: false };

/** US state names → two-letter codes (the router is asked for codes; names are accepted too). */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

const STATE_CODE_SET: ReadonlySet<string> = new Set(Object.values(STATE_CODES));

/** State names longest first, so "West Virginia" is found before "Virginia". */
const STATE_NAMES_LONGEST_FIRST: readonly string[] = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length);

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * A state's two-letter code: the code itself, the full name, or a full name inside
 * the text ("the state of Colorado"), any case. An unrecognized state is kept as
 * typed (uppercased) and simply matches no company.
 */
function stateCode(text: string): string {
  const lower = text.toLowerCase();
  if (text.length === 2 && STATE_CODE_SET.has(text.toUpperCase())) {
    return text.toUpperCase();
  }
  const name = STATE_CODES[lower]
    ? lower
    : STATE_NAMES_LONGEST_FIRST.find((stateName) => new RegExp(`\\b${stateName}\\b`).test(lower));
  return name ? STATE_CODES[name] : text.toUpperCase();
}

/** Text from a string or number; "" when missing. */
function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/**
 * Validates the router's filter, forgiving wherever the meaning is clear: industry
 * and metro always match as case-insensitive "contains" (eq or contains); state
 * takes eq or contains with a two-letter code or a full name, any case; territory
 * and online booking take true/false or "true"/"false"/"yes"/"no"; locations takes
 * a number or a numeric string (0 or more) with eq/gt/gte/lt/lte (or a common
 * spelling such as "fewer_than", "under", "at_most", "<", "<="). A field outside
 * the whitelist, a missing value, or a locations comparison it doesn't recognise
 * (never read as "equals") gives null.
 */
export function parseRosterFilter(raw: unknown): RosterFilter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { field, op, value } = raw as Record<string, unknown>;
  if (!isOneOf(FILTER_FIELDS, field)) {
    return null;
  }
  switch (field) {
    case "industry":
    case "metro": {
      const text = textValue(value);
      return text ? { field, op: "contains", value: text } : null;
    }
    case "state": {
      const text = textValue(value);
      return text ? { field, op: "eq", value: stateCode(text) } : null;
    }
    case "locations": {
      const text = textValue(value);
      const count = text ? Number(text) : NaN;
      const comparison = LOCATION_OPS[locationOpKey(op)];
      return comparison && Number.isFinite(count) && count >= 0 ? { field, op: comparison, value: count } : null;
    }
    default: {
      const flag = typeof value === "boolean" ? value : BOOLEAN_WORDS[textValue(value).toLowerCase()];
      return typeof flag === "boolean" ? { field, op: "eq", value: flag } : null;
    }
  }
}

/**
 * The router's conditions: its "filters" list, or a reply that still uses the single
 * "filter" field read as a one-item list. Null (→ the fixed reply) when there are
 * none, more than MAX_FILTER_CRITERIA, or any one the whitelist can't read.
 */
export function parseRosterFilters(rawFilters: unknown, rawFilter: unknown): RosterFilter[] | null {
  const list =
    rawFilters === null || rawFilters === undefined
      ? rawFilter === null || rawFilter === undefined
        ? []
        : [rawFilter]
      : Array.isArray(rawFilters)
        ? rawFilters
        : [rawFilters];
  if (list.length === 0 || list.length > MAX_FILTER_CRITERIA) {
    return null;
  }
  const filters = list.map(parseRosterFilter);
  return filters.every((filter): filter is RosterFilter => filter !== null) ? filters : null;
}

// ── Running a filter ───

/** The roster fields a filter reads and a list answer shows (all from the database). */
export type FilterCompany = NameQueryCompany & {
  inTerritory: boolean | null;
  onlineBooking: boolean | null;
};

/** The two-letter state at the end of a metro such as "Denver, CO". */
function stateOfMetro(metro: string | null): string | null {
  return metro?.trim().match(/,\s*([A-Za-z]{2})$/)?.[1]?.toUpperCase() ?? null;
}

function compareNumber(actual: number, op: FilterOp, expected: number): boolean {
  switch (op) {
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    default:
      return actual === expected;
  }
}

/** Industry and metro: eq and contains both mean a case-insensitive "contains". */
function matchesText(actual: string | null, expected: string): boolean {
  const text = actual?.trim().toLowerCase() ?? "";
  return text.length > 0 && text.includes(expected.toLowerCase());
}

/** True when the company matches the filter. A missing (unknown) value never matches. */
export function matchesFilter(company: FilterCompany, filter: RosterFilter): boolean {
  switch (filter.field) {
    case "industry":
      return matchesText(company.industry, String(filter.value));
    case "metro":
      return matchesText(company.metro, String(filter.value));
    case "state":
      return stateOfMetro(company.metro) === filter.value;
    case "locations":
      return company.locations !== null && compareNumber(company.locations, filter.op, Number(filter.value));
    case "territory":
      return company.inTerritory !== null && company.inTerritory === filter.value;
    default:
      return company.onlineBooking !== null && company.onlineBooking === filter.value;
  }
}

/**
 * True when the company matches every condition: conditions on different fields must
 * all match; two on the same field mean either one ("Colorado or Utah"), except
 * locations, where both must hold ("between 3 and 8 locations").
 */
export function matchesFilters(company: FilterCompany, filters: readonly RosterFilter[]): boolean {
  return FILTER_FIELDS.every((field) => {
    const conditions = filters.filter((filter) => filter.field === field);
    if (conditions.length === 0) {
      return true;
    }
    return field === "locations"
      ? conditions.every((filter) => matchesFilter(company, filter))
      : conditions.some((filter) => matchesFilter(company, filter));
  });
}

/**
 * The answer for one condition or several (matchesFilters): the count intro
 * (matchCountIntro; with more than 20 it says only the first 20 are shown), then the
 * matching companies A–Z (no other order, no ranking), up to 20, each
 * "{Industry} · {N} locations · {Metro}" under its name from the database.
 */
export function answerFilter(
  filter: RosterFilter | readonly RosterFilter[],
  companies: readonly FilterCompany[]
): ScopedAnswer {
  const filters: readonly RosterFilter[] = Array.isArray(filter) ? filter : [filter as RosterFilter];
  const matches = companies
    .filter((company) => matchesFilters(company, filters))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (matches.length === 0) {
    return { intro: NO_FILTER_MATCHES_REPLY, items: [] };
  }
  return {
    intro: matchCountIntro(matches.length),
    items: matches.slice(0, MAX_FILTER_RESULTS).map((company) => ({
      companyId: company.id,
      companyName: company.name,
      text: formatRosterListLine(company),
    })),
  };
}

/**
 * The answer to an All-companies question: a filter_list question with 1–3 valid
 * conditions runs over the roster; everything else gets ALL_MODE_REPLY. A criteria
 * count above the number of conditions means the question asked for something the
 * filters can't express, so it is refused too (a missing count is fine).
 */
export function answerAllCompanies(decision: RouterDecision, companies: readonly FilterCompany[]): ScopedAnswer {
  const { intent, filters, criteriaCount } = decision;
  const isComplete =
    filters !== null &&
    filters.length > 0 &&
    filters.length <= MAX_FILTER_CRITERIA &&
    (criteriaCount === null || criteriaCount <= filters.length);
  if (intent === "filter_list" && filters && isComplete) {
    return answerFilter(filters, companies);
  }
  return { intro: ALL_MODE_REPLY, items: [] };
}
