/**
 * data-room-chat-filter.test.ts
 * All-companies filters (pure): the forgiving whitelist (only an unknown field or a
 * missing value is refused; state codes or names, yes/no words, numeric strings),
 * matching over the roster (unknown values never match), the list
 * answer (count intro, A–Z only, capped at 20, "…and n more", no matches) and the
 * fixed reply for anything that isn't one valid filter.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_MODE_REPLY,
  answerAllCompanies,
  answerFilter,
  matchCountIntro,
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
  return {
    intent: "filter_list",
    topic: null,
    attribute: null,
    filter: null,
    criteriaCount: 1,
    exactValue: false,
    intro: "",
    ...overrides,
  };
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

  it("state: eq or contains, a two-letter code or a full state name, any case → the code", () => {
    const co = { field: "state", op: "eq", value: "CO" };
    for (const raw of [
      { field: "state", op: "contains", value: "Colorado" },
      { field: "state", op: "eq", value: "Colorado" },
      { field: "state", op: "eq", value: "colorado" },
      { field: "state", op: "contains", value: "COLORADO" },
      { field: "state", op: "eq", value: "co" },
      { field: "state", op: "contains", value: "CO" },
      { field: "state", op: "eq", value: " Co " },
      { field: "state", op: "contains", value: "the state of Colorado" },
      { field: "state", value: "Colorado" },
    ]) {
      expect(parseRosterFilter(raw), JSON.stringify(raw)).toEqual(co);
    }
    expect(parseRosterFilter({ field: "state", op: "contains", value: "West Virginia" })).toMatchObject({ value: "WV" });
    expect(parseRosterFilter({ field: "state", op: "eq", value: "new york" })).toMatchObject({ value: "NY" });
  });

  it("state: an unknown state is kept and matches no company (not the fixed reply)", () => {
    expect(parseRosterFilter({ field: "state", op: "eq", value: "Atlantis" })).toEqual({ field: "state", op: "eq", value: "ATLANTIS" });
    expect(parseRosterFilter({ field: "state", op: "eq", value: "XX" })).toEqual({ field: "state", op: "eq", value: "XX" });
    expect(names({ field: "state", op: "eq", value: "ATLANTIS" })).toEqual([]);
  });

  it("industry and metro: eq and contains are the same case-insensitive contains", () => {
    for (const op of ["eq", "contains", "EQ", "like", undefined]) {
      expect(parseRosterFilter({ field: "industry", op, value: "Dental" }), String(op)).toEqual({
        field: "industry",
        op: "contains",
        value: "Dental",
      });
      expect(parseRosterFilter({ field: "metro", op, value: "denver" }), String(op)).toEqual({
        field: "metro",
        op: "contains",
        value: "denver",
      });
    }
    expect(names({ field: "industry", op: "eq", value: "DENT" })).toEqual(["Summit Dental Group", "Maple Family Dentistry"]);
    expect(names({ field: "metro", op: "eq", value: "denver" })).toEqual(["Falcon Market"]);
    expect(parseRosterFilter({ field: "metro", op: "contains", value: "x".repeat(61) })).toMatchObject({ op: "contains" });
  });

  it("territory and online booking: true/false as booleans or the words true/false/yes/no", () => {
    for (const [value, expected] of [
      [true, true],
      [false, false],
      ["true", true],
      ["false", false],
      ["yes", true],
      ["no", false],
      [" Yes ", true],
      ["NO", false],
      ["True", true],
    ] as const) {
      expect(parseRosterFilter({ field: "territory", op: "eq", value }), String(value)).toEqual({
        field: "territory",
        op: "eq",
        value: expected,
      });
      expect(parseRosterFilter({ field: "online_booking", op: "contains", value }), String(value)).toEqual({
        field: "online_booking",
        op: "eq",
        value: expected,
      });
    }
  });

  it("locations: a number or a numeric string, with eq/gt/gte/lt/lte (or a common spelling)", () => {
    expect(parseRosterFilter({ field: "locations", op: "gt", value: "3" })).toEqual({ field: "locations", op: "gt", value: 3 });
    expect(parseRosterFilter({ field: "locations", op: "eq", value: " 1 " })).toEqual({ field: "locations", op: "eq", value: 1 });
    expect(parseRosterFilter({ field: "locations", op: "gte", value: 5 })).toEqual({ field: "locations", op: "gte", value: 5 });
    expect(parseRosterFilter({ field: "locations", op: ">=", value: "5" })).toEqual({ field: "locations", op: "gte", value: 5 });
    expect(parseRosterFilter({ field: "locations", op: "less_than", value: 4 })).toEqual({ field: "locations", op: "lt", value: 4 });
    expect(parseRosterFilter({ field: "locations", op: "contains", value: 3 })).toEqual({ field: "locations", op: "eq", value: 3 });
    expect(parseRosterFilter({ field: "locations", value: 0 })).toEqual({ field: "locations", op: "eq", value: 0 });
  });

  it("rejects only a field outside the whitelist or a missing value", () => {
    for (const raw of [
      null,
      "online_booking",
      [{ field: "industry", op: "eq", value: "Dental" }],
      { field: "software", op: "eq", value: "Zentrix" },
      { field: "research_facts", op: "contains", value: "budget" },
      { field: "fit_rank", op: "lte", value: 1 },
      { field: "class", op: "eq", value: "strong_fit" },
      { field: "STATE", op: "eq", value: "CO" },
      { op: "eq", value: "CO" },
      { field: "state", op: "eq" },
      { field: "state", op: "eq", value: "  " },
      { field: "industry", op: "eq", value: "   " },
      { field: "metro", op: "contains", value: null },
      { field: "locations", op: "gt", value: "three" },
      { field: "locations", op: "gt", value: -1 },
      { field: "locations", op: "gt", value: "" },
      { field: "locations", op: "gt", value: true },
      { field: "territory", op: "eq" },
      { field: "territory", op: "eq", value: "maybe" },
      { field: "online_booking", op: "eq", value: 1 },
    ]) {
      expect(parseRosterFilter(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("matching", () => {
  it("text fields: case-insensitive contains", () => {
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
  it("results match the roster, A–Z, each with its list line, after a count intro; no other order", () => {
    expect(answerFilter({ field: "online_booking", op: "eq", value: true }, ROSTER)).toEqual({
      intro: "3 companies match.",
      items: [
        { companyId: "aspen", companyName: "Aspen Vet Clinic", text: "Veterinary" },
        { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
        { companyId: "outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
      ],
    });
  });

  it("one match: the singular count", () => {
    expect(answerFilter({ field: "territory", op: "eq", value: false }, ROSTER)).toEqual({
      intro: "1 company matches.",
      items: [{ companyId: "outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" }],
    });
    expect(matchCountIntro(1)).toBe("1 company matches.");
    expect(matchCountIntro(12)).toBe("12 companies match.");
  });

  it("at most 20; the count, then the rest counted on a second intro line", () => {
    const many: FilterCompany[] = Array.from({ length: 27 }, (_, i) => ({
      ...ROSTER[1]!,
      id: `c${i}`,
      name: `Clinic ${String(26 - i).padStart(2, "0")}`,
    }));
    const answer = answerFilter({ field: "online_booking", op: "eq", value: true }, many);
    expect(answer.items).toHaveLength(MAX_FILTER_RESULTS);
    expect(answer.items[0]?.companyName).toBe("Clinic 00");
    expect(answer.items[19]?.companyName).toBe("Clinic 19");
    expect(answer.intro).toBe("27 companies match.\n…and 7 more. Use the search box above the list to narrow it down.");
    expect(answer.intro).toBe(`${matchCountIntro(27)}\n${moreMatchesIntro(7)}`);
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

  it("one valid filter runs (a missing criteria count reads as one); more than one criterion, no filter, or any other intent → the fixed reply", () => {
    expect(answerAllCompanies(decision({ filter: bookingFilter }), ROSTER).items).toHaveLength(3);
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: null }), ROSTER).items).toHaveLength(3);
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: 0 }), ROSTER).items).toHaveLength(3);
    expect(MAX_FILTER_CRITERIA).toBe(1);
    const fixed = { intro: ALL_MODE_REPLY, items: [] };
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: 2 }), ROSTER)).toEqual(fixed);
    expect(answerAllCompanies(decision({ filter: null }), ROSTER)).toEqual(fixed);
    for (const intent of ["overview", "attribute_lookup", "specific_research", "compare", "meta_or_bulk", "off_topic"] as const) {
      expect(answerAllCompanies(decision({ intent, filter: bookingFilter }), ROSTER), intent).toEqual(fixed);
    }
    expect(ALL_MODE_REPLY).toBe(
      "In All companies mode I can filter by one thing at a time, such as industry, city or state, number of locations, territory, or online booking. Open a company to research it in depth."
    );
  });

  it('"Which companies are in Colorado?" with {"field":"state","op":"contains","value":"Colorado"} lists the Colorado companies', () => {
    const filter = parseRosterFilter({ field: "state", op: "contains", value: "Colorado" });
    expect(answerAllCompanies(decision({ filter }), ROSTER)).toEqual({
      intro: "3 companies match.",
      items: [
        { companyId: "falcon", companyName: "Falcon Market", text: "Retail · 1 location · Denver, CO" },
        { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
        { companyId: "summit", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
      ],
    });
  });

  it("each forgiving form runs the filter instead of the fixed reply", () => {
    for (const [raw, count] of [
      [{ field: "state", op: "eq", value: "co" }, 3],
      [{ field: "industry", op: "eq", value: "dent" }, 2],
      [{ field: "metro", op: "eq", value: "boulder" }, 1],
      [{ field: "territory", op: "eq", value: "yes" }, 3],
      [{ field: "online_booking", op: "eq", value: "no" }, 1],
      [{ field: "locations", op: "gte", value: "3" }, 2],
    ] as const) {
      expect(answerAllCompanies(decision({ filter: parseRosterFilter(raw) }), ROSTER).items, JSON.stringify(raw)).toHaveLength(
        count
      );
    }
  });
});
