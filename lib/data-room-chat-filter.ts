/**
 * data-room-chat-filter.ts
 * All-companies questions for the Data Room assistant (pure; no DB, no network). In
 * All companies mode no model picks or reads company data: the router returns the
 * question's conditions (filters, as many as it asks for) over public roster
 * attributes, this module validates them against a whitelist and runs them over the
 * roster in code (different fields must all match; within a field, a company must
 * match one of its positive conditions, if there are any, and none of its negative
 * ones ("ne" / "not_contains": "not in Colorado", "outside", "except"), so two
 * positives mean either one and two negatives exclude both, except locations, where
 * every comparison must hold; an industry condition that names one of the roster's
 * industries exactly, any case, matches only that industry, any other industry value
 * matches as "contains"), and the answer lists
 * every matching company from the database, A–Z or in the order the question asked
 * for (by locations or name; never by fit), under a count line and with no opening
 * sentence (as a table: layout "table", each item with its card values). A request
 * for the previous list again in another order keeps that list's companies (all of
 * its conditions), re-sorted. A question that also asks for something no filter can
 * express (the router's unfiltered: software, budget, risks…) still gets the list for
 * the conditions it could apply, under a count line naming them (from the config's
 * labels) and a fixed note that research can't be searched across all companies. A
 * "how many companies are there?" question (no conditions) gets the roster total; an
 * answer-key or rule-breaking question its own reply; any other All-companies
 * question one fixed reply. The roster's industry names (industryNames, any
 * simulation) also go to the router, so it can pick from them. Used by
 * lib/data-room-chat-router.ts (filter validation) and POST /api/student/data-room-chat.
 */

import { filterFieldsPhrase, getDataRoomChatConfig, joinList, type DataRoomChatConfig } from "@/lib/data-room-chat-config";
import type { RouterDecision } from "@/lib/data-room-chat-router";
import { formatRosterListLine, type NameQueryCompany, type ScopedAnswer } from "@/lib/data-room-chat-scope";

// ── Fixed replies ───

/** The reply to every All-companies question that isn't valid conditions, with the simulation's filterable fields. */
export function allModeReply(config: DataRoomChatConfig = getDataRoomChatConfig()): string {
  return `In All companies mode I can filter by ${filterFieldsPhrase(config, "reply")}. Switch to Selected and ask about a company to research it in depth.`;
}

/** The reply to an answer-key or rule-breaking question (meta_or_bulk) in All companies mode. */
export function metaAllModeReply(config: DataRoomChatConfig = getDataRoomChatConfig()): string {
  return `I can't share hidden or internal information. In All companies mode I can filter every company by ${filterFieldsPhrase(config, "reply")}.`;
}

/** The reply to every All-companies question that isn't valid conditions (or a name, count or answer-key question); Tempo's wording. */
export const ALL_MODE_REPLY = allModeReply();

/** An answer-key or rule-breaking question (meta_or_bulk) in All companies mode; Tempo's wording. */
export const META_ALL_MODE_REPLY = metaAllModeReply();

export const NO_FILTER_MATCHES_REPLY = "No companies match that.";

/** The intro of every filter answer with matches: "{n} companies match." ("1 company matches."). */
export function matchCountIntro(count: number): string {
  return count === 1 ? "1 company matches." : `${count} companies match.`;
}

/**
 * The count line of an answer that applied only some of what the question asked
 * (unfiltered): "{n} companies match the filters I could apply (industry and state)."
 * ("1 company matches …", "No companies match …"), the fields in plain words from
 * the config (appliedFilterLabels), each once, in filter-field order.
 */
export function partialMatchCountIntro(
  count: number,
  filters: readonly RosterFilter[],
  config: DataRoomChatConfig = getDataRoomChatConfig()
): string {
  const fields = joinList(
    FILTER_FIELDS.filter((field) => filters.some((filter) => filter.field === field)).map(
      (field) => config.appliedFilterLabels[field]
    ),
    "and"
  );
  const subject = count === 0 ? "No companies match" : count === 1 ? "1 company matches" : `${count} companies match`;
  return `${subject} the filters I could apply (${fields}).`;
}

/** The note under a partial All-companies answer: research can't be searched across every company. */
export function unfilteredNote(config: DataRoomChatConfig = getDataRoomChatConfig()): string {
  return `I can't search research like ${joinList(config.unfilteredResearchExamples, "or")} across all companies. Switch to Selected and ask about a company to check.`;
}

/** The answer to "how many companies are there?": the roster total. */
export function totalCountReply(count: number): string {
  return count === 1 ? "There is 1 company in the Data Room." : `There are ${count} companies in the Data Room.`;
}

// ── Filter shape ───

export const FILTER_FIELDS = ["industry", "metro", "state", "locations", "territory", "online_booking"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPS = ["eq", "contains", "ne", "not_contains", "gt", "gte", "lt", "lte"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type RosterFilter = { field: FilterField; op: FilterOp; value: string | number | boolean };

/** An order for a list answer: by number of locations or by name (never by fit). The default is name A–Z. */
export type RosterSort = { field: "locations" | "name"; direction: "asc" | "desc" };

/** Field spellings a model may use for a sort. */
const SORT_FIELDS: Record<string, RosterSort["field"]> = {
  locations: "locations",
  location: "locations",
  loc: "locations",
  name: "name",
  names: "name",
  company: "name",
  company_name: "name",
};

/** Direction spellings a model may use; a missing direction is ascending. */
const SORT_DIRECTIONS: Record<string, RosterSort["direction"]> = {
  asc: "asc",
  ascending: "asc",
  increasing: "asc",
  desc: "desc",
  descending: "desc",
  decreasing: "desc",
};

/**
 * A sort from the router's reply ({"field", "direction"}), or null when it is
 * missing or names something else (only locations and name can order a list).
 */
export function parseRosterSort(raw: unknown): RosterSort | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { field, direction } = raw as Record<string, unknown>;
  const sortField = typeof field === "string" ? SORT_FIELDS[field.trim().toLowerCase()] : undefined;
  if (!sortField) {
    return null;
  }
  if (direction === undefined || direction === null || direction === "") {
    return { field: sortField, direction: "asc" };
  }
  const sortDirection = typeof direction === "string" ? SORT_DIRECTIONS[direction.trim().toLowerCase()] : undefined;
  return sortDirection ? { field: sortField, direction: sortDirection } : null;
}

/**
 * The companies in the list's order: by name A–Z when there is no sort; by name
 * (A–Z or Z–A) or by number of locations (ties by name A–Z, companies with no
 * number on record last). Sorting by locations or name is not ranking fit.
 */
export function sortCompanies<T extends { name: string; locations: number | null }>(
  companies: readonly T[],
  sort?: RosterSort | null
): T[] {
  const byName = (a: T, b: T): number => a.name.localeCompare(b.name);
  if (!sort || sort.field === "name") {
    const sorted = [...companies].sort(byName);
    return sort?.direction === "desc" ? sorted.reverse() : sorted;
  }
  return [...companies].sort((a, b) => {
    if (a.locations === null || b.locations === null) {
      return a.locations === b.locations ? byName(a, b) : a.locations === null ? 1 : -1;
    }
    const difference = sort.direction === "asc" ? a.locations - b.locations : b.locations - a.locations;
    return difference !== 0 ? difference : byName(a, b);
  });
}

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

/** Spellings of a negative comparison ("is not", "doesn't contain"), after locationOpKey and dropping apostrophes. */
const NEGATIVE_OPS: ReadonlySet<string> = new Set([
  "ne",
  "!=",
  "<>",
  "neq",
  "not",
  "not_eq",
  "not_equal",
  "not_equals",
  "is_not",
  "not_contains",
  "not_contain",
  "does_not_contain",
  "doesnt_contain",
  "excludes",
  "exclude",
  "not_in",
  "except",
]);

/** True when the router's op is a negative comparison (any common spelling). */
function isNegativeOp(op: unknown): boolean {
  return NEGATIVE_OPS.has(locationOpKey(op).replace(/['’]/g, ""));
}

/** True for a negative condition ("ne" / "not_contains"): the company must not match it. */
export function isNegativeFilter(filter: RosterFilter): boolean {
  return filter.op === "ne" || filter.op === "not_contains";
}

/**
 * Validates the router's filter, forgiving wherever the meaning is clear: industry
 * and metro always match as case-insensitive "contains" (eq or contains), or, with a
 * negative op ("ne", "not_contains", "!=", "excludes"…), as "doesn't contain"
 * (not_contains); state takes eq or contains with a two-letter code or a full name,
 * any case, or a negative op (ne: "not in"); territory and online booking take
 * true/false or "true"/"false"/"yes"/"no" (a negative op flips the value, so "not in
 * territory" is never read as "in territory"); locations takes a number or a numeric
 * string (0 or more) with eq/gt/gte/lt/lte (or a common spelling such as
 * "fewer_than", "under", "at_most", "<", "<="). A field outside the whitelist, a
 * missing value, or a locations comparison it doesn't recognise (never read as
 * "equals") gives null.
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
      return text ? { field, op: isNegativeOp(op) ? "not_contains" : "contains", value: text } : null;
    }
    case "state": {
      const text = textValue(value);
      return text ? { field, op: isNegativeOp(op) ? "ne" : "eq", value: stateCode(text) } : null;
    }
    case "locations": {
      const text = textValue(value);
      const count = text ? Number(text) : NaN;
      const comparison = LOCATION_OPS[locationOpKey(op)];
      return comparison && Number.isFinite(count) && count >= 0 ? { field, op: comparison, value: count } : null;
    }
    default: {
      const flag = typeof value === "boolean" ? value : BOOLEAN_WORDS[textValue(value).toLowerCase()];
      return typeof flag === "boolean" ? { field, op: "eq", value: isNegativeOp(op) ? !flag : flag } : null;
    }
  }
}

/**
 * The router's conditions, as many as the question asks for: its "filters" list, or
 * a reply that still uses the single "filter" field read as a one-item list. Null
 * (→ the fixed reply) when there are none or any one the whitelist can't read.
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
  if (list.length === 0) {
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

/**
 * The roster's distinct industry names, A–Z (trimmed; one spelling per name, any
 * case): what the router is shown to pick an industry filter from. Industry names
 * only, never anything about a company.
 */
export function industryNames(companies: ReadonlyArray<{ industry: string }>): string[] {
  const byKey = new Map<string, string>();
  for (const company of companies) {
    const name = company.industry.trim();
    if (name && !byKey.has(name.toLowerCase())) {
      byKey.set(name.toLowerCase(), name);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

/** The roster's industry names, lowercased: an industry value among them matches exactly. */
function industryKeys(companies: readonly FilterCompany[]): ReadonlySet<string> {
  return new Set(industryNames(companies).map((name) => name.toLowerCase()));
}

/**
 * An industry condition: a value that is one of the roster's industries (knownIndustries,
 * lowercased; any case) matches that industry exactly; any other value matches as
 * "contains", as before.
 */
function matchesIndustry(actual: string, expected: string, knownIndustries?: ReadonlySet<string>): boolean {
  const value = expected.trim().toLowerCase();
  return knownIndustries?.has(value) ? actual.trim().toLowerCase() === value : matchesText(actual, expected);
}

/**
 * True when the company matches the filter. A missing (unknown) value never matches,
 * for a negative condition too (an unknown state is not "outside Colorado").
 * knownIndustries: the roster's industry names, lowercased (industry conditions that
 * name one match it exactly; without them every industry value is "contains"). A
 * negative condition matches when the company is known and doesn't match its
 * positive form: industry not_contains a listed name excludes exactly that industry,
 * any other value excludes industries containing it; metro not_contains excludes
 * metros containing it; state ne excludes that state.
 */
export function matchesFilter(company: FilterCompany, filter: RosterFilter, knownIndustries?: ReadonlySet<string>): boolean {
  const isNegative = isNegativeFilter(filter);
  switch (filter.field) {
    case "industry": {
      if (!company.industry.trim()) {
        return false;
      }
      const matches = matchesIndustry(company.industry, String(filter.value), knownIndustries);
      return isNegative ? !matches : matches;
    }
    case "metro": {
      if (!company.metro?.trim()) {
        return false;
      }
      const matches = matchesText(company.metro, String(filter.value));
      return isNegative ? !matches : matches;
    }
    case "state": {
      const state = stateOfMetro(company.metro);
      if (state === null) {
        return false;
      }
      return isNegative ? state !== filter.value : state === filter.value;
    }
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
 * all match. Within one field, the company must match at least one of its positive
 * conditions (if it has any: "Colorado or Utah" is either one) and every one of its
 * negative conditions ("not in Colorado or Utah" excludes both; "dental or vet, not
 * in Colorado" works too); locations, where every comparison must hold ("between 3
 * and 8 locations").
 */
export function matchesFilters(
  company: FilterCompany,
  filters: readonly RosterFilter[],
  knownIndustries?: ReadonlySet<string>
): boolean {
  return FILTER_FIELDS.every((field) => {
    const conditions = filters.filter((filter) => filter.field === field);
    if (conditions.length === 0) {
      return true;
    }
    if (field === "locations") {
      return conditions.every((filter) => matchesFilter(company, filter, knownIndustries));
    }
    const positives = conditions.filter((filter) => !isNegativeFilter(filter));
    const negatives = conditions.filter(isNegativeFilter);
    return (
      (positives.length === 0 || positives.some((filter) => matchesFilter(company, filter, knownIndustries))) &&
      negatives.every((filter) => matchesFilter(company, filter, knownIndustries))
    );
  });
}

/**
 * The answer for one condition or several (matchesFilters): the count intro
 * (matchCountIntro), then every matching company (no cap, no ranking) A–Z, or in the
 * order the question asked for (sort: by locations or name), each "{Industry} · {N}
 * locations · {Metro}" under its name from the database.
 * It is shown as a table (layout "table"): each item also carries its card values
 * (industry, locations, metro, territory, online booking); the text stays the fallback.
 * The companies' own industry names decide exact industry matches (matchesIndustry).
 */
export function answerFilter(
  filter: RosterFilter | readonly RosterFilter[],
  companies: readonly FilterCompany[],
  sort?: RosterSort | null
): ScopedAnswer {
  const filters: readonly RosterFilter[] = Array.isArray(filter) ? filter : [filter as RosterFilter];
  const knownIndustries = industryKeys(companies);
  return listAnswer(
    companies.filter((company) => matchesFilters(company, filters, knownIndustries)),
    sort
  );
}

/** A list answer for these companies, in the list's order (sortCompanies): the count line and the table. */
function listAnswer(companies: readonly FilterCompany[], sort?: RosterSort | null): ScopedAnswer {
  const matches = sortCompanies(companies, sort);
  if (matches.length === 0) {
    return { intro: NO_FILTER_MATCHES_REPLY, items: [] };
  }
  return {
    intro: matchCountIntro(matches.length),
    layout: "table",
    items: matches.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      text: formatRosterListLine(company),
      card: {
        industry: company.industry.trim(),
        locations: company.locations,
        metro: company.metro?.trim() || null,
        inTerritory: company.inTerritory,
        onlineBooking: company.onlineBooking,
      },
    })),
  };
}

/**
 * The answer to an All-companies question:
 * - a filter_list question with valid conditions runs over the roster. When it also
 *   asks for something no filter can express (unfiltered), the list is the same, under
 *   partialMatchCountIntro and with unfilteredNote as its note;
 * - a filter_list question with no conditions at all (criteria count 0, "how many
 *   companies are there?") gets the roster total;
 * - an answer-key or rule-breaking question (meta_or_bulk) gets the answer-key reply;
 * - everything else, including a question with no valid condition, gets the fixed
 *   reply (all worded from the simulation's config, lib/data-room-chat-config.ts;
 *   Tempo's: META_ALL_MODE_REPLY, ALL_MODE_REPLY).
 */
export function answerAllCompanies(
  decision: RouterDecision,
  companies: readonly FilterCompany[],
  previousListIds: readonly string[] = [],
  config: DataRoomChatConfig = getDataRoomChatConfig()
): ScopedAnswer {
  const { intent, filters, criteriaCount, sort, unfiltered } = decision;
  if (intent === "meta_or_bulk") {
    return { intro: metaAllModeReply(config), items: [] };
  }
  // The previous list again in another order ("give this again by locations"): the
  // same companies, so every one of its conditions is kept, re-sorted; a condition
  // the router read narrows it further.
  if (sort && previousListIds.length > 0 && (intent === "filter_list" || intent === "overview")) {
    const ids = new Set(previousListIds);
    const listed = companies.filter((company) => ids.has(company.id));
    if (listed.length > 0) {
      const knownIndustries = industryKeys(companies);
      return listAnswer(filters ? listed.filter((company) => matchesFilters(company, filters, knownIndustries)) : listed, sort);
    }
  }
  if (intent === "filter_list" && filters === null && criteriaCount === 0) {
    return { intro: totalCountReply(companies.length), items: [] };
  }
  if (intent === "filter_list" && filters && filters.length > 0) {
    const answer = answerFilter(filters, companies, sort);
    if (!unfiltered) {
      return answer;
    }
    // Only part of the question could be filtered: the same list, saying what was applied.
    return {
      ...answer,
      intro: partialMatchCountIntro(answer.items.length, filters, config),
      note: unfilteredNote(config),
    };
  }
  return { intro: allModeReply(config), items: [] };
}

// ── Follow-ups about the previous list ───

/** Words that point back at the previous answer's list ("give this again", "sort them", "those, by name"). */
const PREVIOUS_LIST_REFERENCE = /\b(?:this|these|them|those|again|same)\b/i;

/** True when the question points back at the previous list (PREVIOUS_LIST_REFERENCE). */
export function refersToPreviousList(text: string): boolean {
  return PREVIOUS_LIST_REFERENCE.test(text);
}

/**
 * The companies the previous answer listed, from the client-sent history: the ids
 * of the last entry when it is an All-companies answer ({ role: "assistant", scope:
 * { mode: "all" }, items }); empty otherwise. Only ids, which the caller matches
 * against the roster.
 */
export function parsePreviousListIds(history: unknown): string[] {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }
  const last: unknown = history[history.length - 1];
  if (!last || typeof last !== "object") {
    return [];
  }
  const { role, scope, items } = last as Record<string, unknown>;
  const isAllScope = Boolean(scope) && typeof scope === "object" && (scope as { mode?: unknown }).mode === "all";
  if (role !== "assistant" || !isAllScope || !Array.isArray(items)) {
    return [];
  }
  return items.flatMap((item: unknown): string[] => {
    const companyId = item && typeof item === "object" ? (item as { companyId?: unknown }).companyId : undefined;
    return typeof companyId === "string" ? [companyId] : [];
  });
}
