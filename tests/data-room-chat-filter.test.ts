/**
 * data-room-chat-filter.test.ts
 * All-companies filters (pure): the whitelist (fields, operators, value types,
 * state codes), matching over the roster (unknown values never match), the list
 * answer (A–Z only, capped at 20, "…and n more", no matches) and the fixed reply
 * for anything that isn't one valid filter.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_MODE_REPLY,
  answerAllCompanies,
  answerFilter,
  matchesFilter,
  MAX_FILTER_CRITERIA,
  MAX_FILTER_RESULTS,
  moreMatchesIntro,
  NO_FILTER_MATCHES_REPLY,
  parseRosterFilter,
  type FilterCompany,
  type RosterFilter,
} from "@/lib/data-room-chat-filter";
import type { RouterDecision } from "@/lib/data-room-chat-router";

const ROSTER: FilterCompany[] = [
  { id: "summit", name: "Summit Dental Group", industry: "Dental", locations: 8, metro: "Front Range, CO", inTerritory: true, onlineBooking: false },
  { id: "outdoor", name: "Summit Outdoor Gear", industry: "Retail", locations: 2, metro: "Boise, ID", inTerritory: false, onlineBooking: true },
  { id: "falcon", name: "Falcon Market", industry: "Retail", locations: 1, metro: "Denver, CO", inTerritory: true, onlineBooking: null },
  { id: "maple", name: "Maple Family Dentistry", industry: "Dental", locations: 3, metro: "Boulder, CO", inTerritory: null, onlineBooking: true },
  { id: "aspen", name: "Aspen Vet Clinic", industry: "Veterinary", locations: null, metro: null, inTerritory: true, onlineBooking: true },
];

const names = (filter: RosterFilter): string[] =>
  ROSTER.filter((company) => matchesFilter(company, filter)).map((company) => company.name);

function decision(overrides: Partial<RouterDecision>): RouterDecision {
  return { intent: "filter_list", topic: null, attribute: null, filter: null, criteriaCount: 1, ...overrides };
}

describe("the whitelist", () => {
  it("accepts each field with an operator and value type it allows", () => {
    expect(parseRosterFilter({ field: "industry", op: "contains", value: " dent " })).toEqual({
      field: "industry",
      op: "contains",
      value: "dent",
    });
    expect(parseRosterFilter({ field: "metro", op: "eq", value: "Denver, CO" })).not.toBeNull();
    expect(parseRosterFilter({ field: "locations", op: "gte", value: 3 })).toEqual({ field: "locations", op: "gte", value: 3 });
    expect(parseRosterFilter({ field: "territory", op: "eq", value: false })).toEqual({ field: "territory", op: "eq", value: false });
    expect(parseRosterFilter({ field: "online_booking", op: "eq", value: true })).not.toBeNull();
  });

  it("a state becomes its two-letter code (a full name too)", () => {
    expect(parseRosterFilter({ field: "state", op: "eq", value: "co" })).toEqual({ field: "state", op: "eq", value: "CO" });
    expect(parseRosterFilter({ field: "state", op: "eq", value: "Colorado" })).toEqual({ field: "state", op: "eq", value: "CO" });
    expect(parseRosterFilter({ field: "state", op: "eq", value: "Atlantis" })).toBeNull();
    expect(parseRosterFilter({ field: "state", op: "eq", value: "XX" })).toBeNull();
  });

  it("rejects other fields, operators a field doesn't allow, wrong value types and bad values", () => {
    for (const raw of [
      null,
      "online_booking",
      [{ field: "industry", op: "eq", value: "Dental" }],
      { field: "software", op: "eq", value: "Zentrix" },
      { field: "research_facts", op: "contains", value: "budget" },
      { field: "fit_rank", op: "lte", value: 1 },
      { field: "class", op: "eq", value: "strong_fit" },
      { field: "industry", op: "gt", value: "Dental" },
      { field: "state", op: "contains", value: "CO" },
      { field: "territory", op: "contains", value: true },
      { field: "locations", op: "contains", value: 3 },
      { field: "locations", op: "gt", value: "3" },
      { field: "locations", op: "gt", value: -1 },
      { field: "online_booking", op: "eq", value: "yes" },
      { field: "industry", op: "eq", value: "   " },
      { field: "metro", op: "contains", value: "x".repeat(61) },
      { field: "industry", op: "regex", value: "Dental" },
    ]) {
      expect(parseRosterFilter(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("matching", () => {
  it("text fields: eq or contains, any case", () => {
    expect(names({ field: "industry", op: "eq", value: "dental" })).toEqual(["Summit Dental Group", "Maple Family Dentistry"]);
    expect(names({ field: "industry", op: "contains", value: "vet" })).toEqual(["Aspen Vet Clinic"]);
    expect(names({ field: "metro", op: "contains", value: "denver" })).toEqual(["Falcon Market"]);
  });

  it("state reads the metro's two-letter suffix", () => {
    expect(names({ field: "state", op: "eq", value: "CO" })).toEqual([
      "Summit Dental Group",
      "Falcon Market",
      "Maple Family Dentistry",
    ]);
  });

  it("numbers and yes/no; an unknown value never matches", () => {
    expect(names({ field: "locations", op: "gt", value: 2 })).toEqual(["Summit Dental Group", "Maple Family Dentistry"]);
    expect(names({ field: "locations", op: "lte", value: 2 })).toEqual(["Summit Outdoor Gear", "Falcon Market"]);
    expect(names({ field: "locations", op: "eq", value: 1 })).toEqual(["Falcon Market"]);
    expect(names({ field: "territory", op: "eq", value: false })).toEqual(["Summit Outdoor Gear"]);
    expect(names({ field: "online_booking", op: "eq", value: false })).toEqual(["Summit Dental Group"]);
  });
});

describe("the list answer", () => {
  it("results match the roster, A–Z, each with its list line; no other order", () => {
    expect(answerFilter({ field: "online_booking", op: "eq", value: true }, ROSTER)).toEqual({
      intro: "",
      items: [
        { companyId: "aspen", companyName: "Aspen Vet Clinic", text: "Veterinary" },
        { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
        { companyId: "outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
      ],
    });
  });

  it("at most 20; the rest are counted in the intro", () => {
    const many: FilterCompany[] = Array.from({ length: 27 }, (_, i) => ({
      ...ROSTER[1]!,
      id: `c${i}`,
      name: `Clinic ${String(26 - i).padStart(2, "0")}`,
    }));
    const answer = answerFilter({ field: "online_booking", op: "eq", value: true }, many);
    expect(answer.items).toHaveLength(MAX_FILTER_RESULTS);
    expect(answer.items[0]?.companyName).toBe("Clinic 00");
    expect(answer.items[19]?.companyName).toBe("Clinic 19");
    expect(answer.intro).toBe(moreMatchesIntro(7));
    expect(moreMatchesIntro(7)).toBe("…and 7 more. Use the search box above the list to narrow it down.");
  });

  it("no matches", () => {
    expect(answerFilter({ field: "industry", op: "eq", value: "Legal" }, ROSTER)).toEqual({
      intro: NO_FILTER_MATCHES_REPLY,
      items: [],
    });
    expect(NO_FILTER_MATCHES_REPLY).toBe("No companies match that.");
  });
});

describe("All-companies answers", () => {
  const bookingFilter: RosterFilter = { field: "online_booking", op: "eq", value: true };

  it("one valid filter runs; more than one criterion, no filter, or any other intent → the fixed reply", () => {
    expect(answerAllCompanies(decision({ filter: bookingFilter }), ROSTER).items).toHaveLength(3);
    expect(MAX_FILTER_CRITERIA).toBe(1);
    const fixed = { intro: ALL_MODE_REPLY, items: [] };
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: 2 }), ROSTER)).toEqual(fixed);
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: null }), ROSTER)).toEqual(fixed);
    expect(answerAllCompanies(decision({ filter: null }), ROSTER)).toEqual(fixed);
    for (const intent of ["overview", "attribute_lookup", "specific_research", "compare", "meta_or_bulk", "off_topic"] as const) {
      expect(answerAllCompanies(decision({ intent, filter: bookingFilter }), ROSTER), intent).toEqual(fixed);
    }
    expect(ALL_MODE_REPLY).toBe(
      "In All companies mode I can filter by one thing at a time, such as industry, city or state, number of locations, territory, or online booking. Open a company to research it in depth."
    );
  });
});
