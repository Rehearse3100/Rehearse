/**
 * data-room-chat-filter.test.ts
 * All-companies filters (pure): the forgiving whitelist (only an unknown field, a
 * missing value or an unrecognised locations comparison is refused; state codes or
 * names, yes/no words, numeric strings), any number of conditions (different fields
 * AND, same field OR, locations AND), matching over the roster (unknown values never
 * match), the list answer (count intro, every match A–Z with no cap, no matches),
 * the roster total for a count question with no conditions, the answer-key reply,
 * and the fixed reply for anything that isn't valid conditions. 2026-11-07: a
 * question that also asks for something no filter can express (unfiltered) gets the
 * list for the conditions applied, under a count line naming those fields and a
 * fixed note; the criteria-count partial-filter refusal is gone.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_MODE_REPLY,
  answerAllCompanies,
  answerFilter,
  matchCountIntro,
  industryNames,
  isNegativeFilter,
  matchesFilter,
  matchesFilters,
  META_ALL_MODE_REPLY,
  NO_FILTER_MATCHES_REPLY,
  parsePreviousListIds,
  parseRosterFilter,
  parseRosterFilters,
  parseRosterSort,
  partialMatchCountIntro,
  refersToPreviousList,
  sortCompanies,
  totalCountReply,
  unfilteredNote,
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

/**
 * A filter answer as the pane receives it (2026-11-06): the same intro and list
 * lines, plus layout "table" and each company's card from the roster fixture.
 */
function asTable(answer: { intro: string; items: Array<{ companyId: string; companyName: string; text: string }> }): unknown {
  return {
    ...answer,
    layout: "table",
    items: answer.items.map((item) => {
      const company = ROSTER.find((row) => row.id === item.companyId);
      return {
        ...item,
        card: company
          ? {
              industry: company.industry,
              locations: company.locations,
              metro: company.metro,
              inTerritory: company.inTerritory,
              onlineBooking: company.onlineBooking,
            }
          : undefined,
      };
    }),
  };
}

/** A filter_list decision; `filter` is shorthand for a one-condition `filters` list. */
function decision(overrides: Partial<RouterDecision> & { filter?: RosterFilter | null }): RouterDecision {
  const { filter, ...rest } = overrides;
  return {
    intent: "filter_list",
    topic: null,
    attribute: null,
    filters: filter ? [filter] : null,
    criteriaCount: 1,
    exactValue: false,
    ...rest,
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
    expect(parseRosterFilter({ field: "locations", op: "contains", value: 3 })).toBeNull();
    expect(parseRosterFilter({ field: "locations", value: 0 })).toBeNull();
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
    expect(answerFilter({ field: "online_booking", op: "eq", value: true }, ROSTER)).toEqual(
      asTable({
        intro: "3 companies match.",
        items: [
          { companyId: "aspen", companyName: "Aspen Vet Clinic", text: "Veterinary" },
          { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
          { companyId: "outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
        ],
      })
    );
  });

  it("one match: the singular count", () => {
    expect(answerFilter({ field: "territory", op: "eq", value: false }, ROSTER)).toEqual(
      asTable({
        intro: "1 company matches.",
        items: [{ companyId: "outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" }],
      })
    );
    expect(matchCountIntro(1)).toBe("1 company matches.");
    expect(matchCountIntro(12)).toBe("12 companies match.");
  });

  it("a filter answer is a table: layout 'table', each company's card from the roster, the list line kept as the fallback", () => {
    const answer = answerFilter({ field: "territory", op: "eq", value: true }, ROSTER);
    expect(answer.layout).toBe("table");
    expect(answer.items.map((item) => [item.companyName, item.text, item.card])).toEqual([
      ["Aspen Vet Clinic", "Veterinary", { industry: "Veterinary", locations: null, metro: null, inTerritory: true, onlineBooking: true }],
      [
        "Falcon Market",
        "Retail · 1 location · Denver, CO",
        { industry: "Retail", locations: 1, metro: "Denver, CO", inTerritory: true, onlineBooking: null },
      ],
      [
        "Summit Dental Group",
        "Dental · 8 locations · Front Range, CO",
        { industry: "Dental", locations: 8, metro: "Front Range, CO", inTerritory: true, onlineBooking: false },
      ],
    ]);
    // No match, and every fixed reply: no layout (shown as text).
    expect(answerFilter({ field: "industry", op: "eq", value: "Legal" }, ROSTER).layout).toBeUndefined();
    expect(answerAllCompanies(decision({ intent: "overview", filters: null }), ROSTER).layout).toBeUndefined();
  });

  it("every match, A–Z, under a plain count line (no cap)", () => {
    const many: FilterCompany[] = Array.from({ length: 27 }, (_, i) => ({
      ...ROSTER[1]!,
      id: `c${i}`,
      name: `Clinic ${String(26 - i).padStart(2, "0")}`,
    }));
    const answer = answerFilter({ field: "online_booking", op: "eq", value: true }, many);
    expect(answer.items).toHaveLength(27);
    expect(answer.items[0]?.companyName).toBe("Clinic 00");
    expect(answer.items[26]?.companyName).toBe("Clinic 26");
    expect(answer.intro).toBe("27 companies match.");
    expect(answer.intro).toBe(matchCountIntro(27));
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

  it("one valid filter runs (whatever the criteria count); no filter, or any other intent → the fixed reply", () => {
    expect(answerAllCompanies(decision({ filter: bookingFilter }), ROSTER).items).toHaveLength(3);
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: null }), ROSTER).items).toHaveLength(3);
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: 0 }), ROSTER).items).toHaveLength(3);
    // 2026-11-07: a count above the filters no longer refuses (was the fixed reply);
    // what the filters can't express is the router's unfiltered.
    expect(answerAllCompanies(decision({ filter: bookingFilter, criteriaCount: 2 }), ROSTER).items).toHaveLength(3);
    const fixed = { intro: ALL_MODE_REPLY, items: [] };
    expect(answerAllCompanies(decision({ filter: null }), ROSTER)).toEqual(fixed);
    for (const intent of ["overview", "attribute_lookup", "specific_research", "compare", "off_topic"] as const) {
      expect(answerAllCompanies(decision({ intent, filter: bookingFilter }), ROSTER), intent).toEqual(fixed);
    }
    expect(ALL_MODE_REPLY).toBe(
      "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking. Switch to Selected and ask about a company to research it in depth."
    );
  });

  it("an answer-key or rule-breaking question (meta_or_bulk) gets its own reply", () => {
    expect(answerAllCompanies(decision({ intent: "meta_or_bulk", filter: bookingFilter }), ROSTER)).toEqual({
      intro: META_ALL_MODE_REPLY,
      items: [],
    });
    expect(META_ALL_MODE_REPLY).toBe(
      "I can't share hidden or internal information. In All companies mode I can filter every company by industry, city or state, number of locations, territory and online booking."
    );
  });

  it('a count question with no conditions ("how many companies are there?") gets the roster total', () => {
    expect(answerAllCompanies(decision({ filter: null, criteriaCount: 0 }), ROSTER)).toEqual({
      intro: `There are ${ROSTER.length} companies in the Data Room.`,
      items: [],
    });
    expect(totalCountReply(1)).toBe("There is 1 company in the Data Room.");
    // Not when the router saw conditions it couldn't express, or isn't sure it's a count.
    expect(answerAllCompanies(decision({ filter: null, criteriaCount: 1 }), ROSTER)).toEqual({ intro: ALL_MODE_REPLY, items: [] });
    expect(answerAllCompanies(decision({ intent: "overview", filter: null, criteriaCount: 0 }), ROSTER)).toEqual({
      intro: ALL_MODE_REPLY,
      items: [],
    });
  });

  it('"Which companies are in Colorado?" with {"field":"state","op":"contains","value":"Colorado"} lists the Colorado companies', () => {
    const filter = parseRosterFilter({ field: "state", op: "contains", value: "Colorado" });
    expect(answerAllCompanies(decision({ filter }), ROSTER)).toEqual(
      asTable({
        intro: "3 companies match.",
        items: [
          { companyId: "falcon", companyName: "Falcon Market", text: "Retail · 1 location · Denver, CO" },
          { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
          { companyId: "summit", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
        ],
      })
    );
  });

  it("the count line is the plain count at any size (no cap wording)", () => {
    expect(matchCountIntro(20)).toBe("20 companies match.");
    expect(matchCountIntro(21)).toBe("21 companies match.");
    expect(matchCountIntro(64)).toBe("64 companies match.");
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

describe("any number of conditions", () => {
  const CO: RosterFilter = { field: "state", op: "eq", value: "CO" };
  const ID: RosterFilter = { field: "state", op: "eq", value: "ID" };
  const DENTAL: RosterFilter = { field: "industry", op: "contains", value: "dental" };
  const BOOKING: RosterFilter = { field: "online_booking", op: "eq", value: true };
  const IN_TERRITORY: RosterFilter = { field: "territory", op: "eq", value: true };
  const namesAll = (filters: RosterFilter[]): string[] =>
    ROSTER.filter((company) => matchesFilters(company, filters)).map((company) => company.name);
  const listed = (filters: RosterFilter[] | null, criteriaCount: number | null): string[] =>
    answerAllCompanies(decision({ filters, criteriaCount }), ROSTER).items.map((item) => item.companyName);
  const fixed = { intro: ALL_MODE_REPLY, items: [] };

  it("reads a list of conditions; a reply with the single 'filter' field is a one-item list", () => {
    expect(parseRosterFilters([{ field: "state", op: "contains", value: "Colorado" }], undefined)).toEqual([CO]);
    expect(parseRosterFilters(undefined, { field: "state", op: "eq", value: "CO" })).toEqual([CO]);
    expect(parseRosterFilters(null, { field: "state", op: "eq", value: "co" })).toEqual([CO]);
    expect(parseRosterFilters({ field: "state", op: "eq", value: "CO" }, undefined)).toEqual([CO]);
    expect(
      parseRosterFilters(
        [
          { field: "industry", op: "eq", value: "dental" },
          { field: "state", op: "eq", value: "CO" },
          { field: "online_booking", op: "eq", value: "yes" },
        ],
        undefined
      )
    ).toEqual([DENTAL, CO, BOOKING]);
    // "filters" wins over a stray "filter".
    expect(parseRosterFilters([{ field: "state", op: "eq", value: "ID" }], { field: "state", op: "eq", value: "CO" })).toEqual([
      ID,
    ]);
  });

  it("none, or any condition it can't read → null; more than 3 is fine", () => {
    expect(parseRosterFilters([CO, ID, DENTAL, BOOKING, IN_TERRITORY], undefined)).toEqual([CO, ID, DENTAL, BOOKING, IN_TERRITORY]);
    for (const [filters, filter] of [
      [[], undefined],
      [undefined, undefined],
      [null, null],
      [[CO, { field: "software", op: "eq", value: "Zentrix" }], undefined],
      [[CO, { field: "budget", op: "contains", value: "freeze" }], undefined],
      [[CO, { field: "locations", op: "about", value: 3 }], undefined],
      [[CO, null], undefined],
      ["CO", undefined],
    ] as const) {
      expect(parseRosterFilters(filters, filter), JSON.stringify(filters)).toBeNull();
    }
  });

  it("conditions on different fields must all match", () => {
    expect(namesAll([DENTAL, CO])).toEqual(["Summit Dental Group", "Maple Family Dentistry"]);
    expect(namesAll([DENTAL, CO, BOOKING])).toEqual(["Maple Family Dentistry"]);
    expect(namesAll([CO, IN_TERRITORY])).toEqual(["Summit Dental Group", "Falcon Market"]);
  });

  it("two conditions on the same field mean either one (Colorado or Idaho)", () => {
    expect(namesAll([CO, ID])).toEqual(["Summit Dental Group", "Summit Outdoor Gear", "Falcon Market", "Maple Family Dentistry"]);
    expect(namesAll([DENTAL, { field: "industry", op: "contains", value: "vet" }])).toEqual([
      "Summit Dental Group",
      "Maple Family Dentistry",
      "Aspen Vet Clinic",
    ]);
    expect(namesAll([CO, ID, { field: "industry", op: "contains", value: "retail" }])).toEqual([
      "Summit Outdoor Gear",
      "Falcon Market",
    ]);
  });

  it("two locations conditions both hold (a range)", () => {
    expect(
      namesAll([
        { field: "locations", op: "gte", value: 2 },
        { field: "locations", op: "lte", value: 3 },
      ])
    ).toEqual(["Summit Outdoor Gear", "Maple Family Dentistry"]);
  });

  it("1, 2 or 3 conditions run in code and list A–Z under the count", () => {
    expect(listed([DENTAL], 1)).toEqual(["Maple Family Dentistry", "Summit Dental Group"]);
    expect(answerAllCompanies(decision({ filters: [DENTAL, CO], criteriaCount: 2 }), ROSTER)).toEqual(
      asTable({
        intro: "2 companies match.",
        items: [
          { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
          { companyId: "summit", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
        ],
      })
    );
    expect(answerAllCompanies(decision({ filters: [DENTAL, CO, BOOKING], criteriaCount: 3 }), ROSTER)).toEqual(
      asTable({
        intro: "1 company matches.",
        items: [{ companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" }],
      })
    );
    expect(listed([CO, ID], 2)).toEqual(["Falcon Market", "Maple Family Dentistry", "Summit Dental Group", "Summit Outdoor Gear"]);
    expect(listed([CO, ID], null)).toHaveLength(4);
  });

  it("an invalid condition → the fixed reply; a count above the conditions given now runs them (2026-11-07)", () => {
    // Was the fixed reply (the criteria-count partial-filter refusal, removed).
    expect(listed([DENTAL, CO], 3)).toEqual(["Maple Family Dentistry", "Summit Dental Group"]);
    expect(listed([DENTAL, CO, BOOKING], 4)).toEqual(["Maple Family Dentistry"]);
    const parsed = (raw: unknown[]): RosterFilter[] | null => parseRosterFilters(raw, undefined);
    expect(answerAllCompanies(decision({ filters: parsed([DENTAL, { field: "class", op: "eq", value: "strong_fit" }]) }), ROSTER)).toEqual(
      fixed
    );
  });

  it("four and five conditions run in code, like any other number", () => {
    const fiveOrMore: RosterFilter = { field: "locations", op: "gte", value: 5 };
    const noBooking: RosterFilter = { field: "online_booking", op: "eq", value: false };
    expect(answerAllCompanies(decision({ filters: [DENTAL, CO, IN_TERRITORY, fiveOrMore], criteriaCount: 4 }), ROSTER)).toEqual(
      asTable({
        intro: "1 company matches.",
        items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" }],
      })
    );
    expect(listed([DENTAL, CO, IN_TERRITORY, fiveOrMore, noBooking], 5)).toEqual(["Summit Dental Group"]);
  });

  it("a locations range counts as one condition: industry + territory + range is 3 conditions, 4 filters", () => {
    const range: RosterFilter[] = [
      { field: "locations", op: "gte", value: 2 },
      { field: "locations", op: "lte", value: 8 },
    ];
    // Maple (3 locations) has no territory on record, so only Summit (8) matches.
    expect(listed([DENTAL, IN_TERRITORY, ...range], 3)).toEqual(["Summit Dental Group"]);
  });

  it("hidden-research questions (budget freeze, software, risks, complaints, best prospect) → the fixed reply", () => {
    for (const raw of [
      [{ field: "budget", op: "contains", value: "freeze" }],
      [{ field: "software", op: "eq", value: "Zentrix" }],
      [{ field: "risks", op: "contains", value: "churn" }],
      [{ field: "complaints", op: "contains", value: "wait times" }],
      [{ field: "fit", op: "eq", value: "best" }],
    ]) {
      expect(answerAllCompanies(decision({ filters: parseRosterFilters(raw, undefined) }), ROSTER), JSON.stringify(raw)).toEqual(fixed);
    }
    // Asked as research (or "which is the best prospect?" as compare), not a filter list.
    for (const intent of ["specific_research", "compare"] as const) {
      expect(answerAllCompanies(decision({ intent, filters: [DENTAL] }), ROSTER), intent).toEqual(fixed);
    }
  });
});

describe("partial questions: what the filters could apply (2026-11-07)", () => {
  const CO: RosterFilter = { field: "state", op: "eq", value: "CO" };
  const ID: RosterFilter = { field: "state", op: "eq", value: "ID" };
  const DENTAL: RosterFilter = { field: "industry", op: "contains", value: "dental" };
  const range: RosterFilter[] = [
    { field: "locations", op: "gte", value: 5 },
    { field: "locations", op: "lte", value: 8 },
  ];
  const NOTE = "I can't search research like software, budget or risks across all companies. Switch to Selected and ask about a company to check.";

  it("valid filters + unfiltered: the same list, a count line naming the fields applied (config labels), and the fixed note", () => {
    expect(answerAllCompanies(decision({ filters: [DENTAL, CO], criteriaCount: 3, unfiltered: true }), ROSTER)).toEqual({
      ...(asTable({
        intro: "2 companies match the filters I could apply (industry and state).",
        items: [
          { companyId: "maple", companyName: "Maple Family Dentistry", text: "Dental · 3 locations · Boulder, CO" },
          { companyId: "summit", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
        ],
      }) as Record<string, unknown>),
      note: NOTE,
    });
    expect(unfilteredNote()).toBe(NOTE);
  });

  it("the '5 to 8 locations + SlotEasy' corner case: the range runs and the note says what it couldn't search", () => {
    const answer = answerAllCompanies(decision({ filters: [DENTAL, ...range], criteriaCount: 3, unfiltered: true }), ROSTER);
    expect(answer.intro).toBe("1 company matches the filters I could apply (industry and number of locations).");
    expect(answer.items.map((item) => item.companyName)).toEqual(["Summit Dental Group"]);
    expect(answer.note).toBe(NOTE);
  });

  it("each field once, in filter-field order, in plain words; one, none, and every field", () => {
    expect(partialMatchCountIntro(1, [CO, ID])).toBe("1 company matches the filters I could apply (state).");
    expect(partialMatchCountIntro(0, [{ field: "metro", op: "contains", value: "Austin" }])).toBe(
      "No companies match the filters I could apply (city)."
    );
    expect(
      partialMatchCountIntro(5, [
        { field: "online_booking", op: "eq", value: true },
        { field: "territory", op: "eq", value: true },
        { field: "locations", op: "gt", value: 2 },
        CO,
        { field: "metro", op: "contains", value: "Austin" },
        DENTAL,
      ])
    ).toBe("5 companies match the filters I could apply (industry, city, state, number of locations, territory and online booking).");
    // No match: the same line (with its note), not the plain "No companies match that."
    const none = answerAllCompanies(decision({ filters: [ID, DENTAL], unfiltered: true }), ROSTER);
    expect(none).toEqual({ intro: "No companies match the filters I could apply (industry and state).", items: [], note: NOTE });
  });

  it("no valid filter at all → the All-companies reply, unchanged; without unfiltered the list is as before", () => {
    expect(answerAllCompanies(decision({ filters: null, criteriaCount: 1, unfiltered: true }), ROSTER)).toEqual({
      intro: ALL_MODE_REPLY,
      items: [],
    });
    const plain = answerAllCompanies(decision({ filters: [DENTAL, CO] }), ROSTER);
    expect(plain.intro).toBe("2 companies match.");
    expect(plain).not.toHaveProperty("note");
    // A re-sort of the previous list and the total count are unchanged.
    expect(answerAllCompanies(decision({ filters: null, criteriaCount: 0, unfiltered: true }), ROSTER).intro).toBe(
      `There are ${ROSTER.length} companies in the Data Room.`
    );
  });
});

describe("locations comparisons", () => {
  it("recognises fewer_than, less_than, under, at_most, <, <= (also written with spaces)", () => {
    for (const [op, expected] of [
      ["fewer_than", "lt"],
      ["less_than", "lt"],
      ["under", "lt"],
      ["<", "lt"],
      ["at_most", "lte"],
      ["<=", "lte"],
      ["fewer than", "lt"],
      ["At Most", "lte"],
    ] as const) {
      expect(parseRosterFilter({ field: "locations", op, value: 3 }), op).toEqual({ field: "locations", op: expected, value: 3 });
    }
  });

  it("an unrecognised comparison is invalid (the fixed reply), never 'equals'", () => {
    for (const op of ["about", "around", "contains", "between", "", undefined, null, 3]) {
      expect(parseRosterFilter({ field: "locations", op, value: 3 }), String(op)).toBeNull();
    }
    expect(
      answerAllCompanies(decision({ filters: parseRosterFilters([{ field: "locations", op: "about", value: 3 }], undefined) }), ROSTER)
    ).toEqual({ intro: ALL_MODE_REPLY, items: [] });
  });
});

describe("sorting a list (by locations or name; never by fit)", () => {
  const names = (companies: readonly FilterCompany[]): string[] => companies.map((company) => company.name);

  it("the default stays A–Z; name Z–A; locations up or down, ties by name, no number on record last", () => {
    expect(names(sortCompanies(ROSTER))).toEqual([
      "Aspen Vet Clinic",
      "Falcon Market",
      "Maple Family Dentistry",
      "Summit Dental Group",
      "Summit Outdoor Gear",
    ]);
    expect(names(sortCompanies(ROSTER, { field: "name", direction: "desc" }))).toEqual([
      "Summit Outdoor Gear",
      "Summit Dental Group",
      "Maple Family Dentistry",
      "Falcon Market",
      "Aspen Vet Clinic",
    ]);
    expect(names(sortCompanies(ROSTER, { field: "locations", direction: "asc" }))).toEqual([
      "Falcon Market",
      "Summit Outdoor Gear",
      "Maple Family Dentistry",
      "Summit Dental Group",
      "Aspen Vet Clinic",
    ]);
    expect(names(sortCompanies(ROSTER, { field: "locations", direction: "desc" }))).toEqual([
      "Summit Dental Group",
      "Maple Family Dentistry",
      "Summit Outdoor Gear",
      "Falcon Market",
      "Aspen Vet Clinic",
    ]);
    const tied: FilterCompany[] = [
      { ...ROSTER[0]!, id: "b", name: "Bravo", locations: 4 },
      { ...ROSTER[0]!, id: "a", name: "Alpha", locations: 4 },
    ];
    expect(names(sortCompanies(tied, { field: "locations", direction: "desc" }))).toEqual(["Alpha", "Bravo"]);
  });

  it("the sort the router sends: locations or name, asc or desc (a few spellings); anything else is no sort", () => {
    expect(parseRosterSort({ field: "locations", direction: "asc" })).toEqual({ field: "locations", direction: "asc" });
    expect(parseRosterSort({ field: "Location", direction: "Decreasing" })).toEqual({ field: "locations", direction: "desc" });
    expect(parseRosterSort({ field: "name" })).toEqual({ field: "name", direction: "asc" });
    for (const raw of [null, undefined, "locations", [], { field: "fit", direction: "desc" }, { field: "locations", direction: "best" }]) {
      expect(parseRosterSort(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("a filter list in the order asked for; the count line is unchanged", () => {
    const answer = answerAllCompanies(
      decision({ filter: { field: "online_booking", op: "eq", value: true }, sort: { field: "locations", direction: "desc" } }),
      ROSTER
    );
    expect(answer.intro).toBe("3 companies match.");
    expect(answer.items.map((item) => item.companyName)).toEqual(["Maple Family Dentistry", "Summit Outdoor Gear", "Aspen Vet Clinic"]);
    expect(answerFilter({ field: "online_booking", op: "eq", value: true }, ROSTER).items.map((item) => item.companyName)).toEqual([
      "Aspen Vet Clinic",
      "Maple Family Dentistry",
      "Summit Outdoor Gear",
    ]);
  });
});

describe("the previous list again, in another order", () => {
  // The real case: "which are in colorado" → "more than 6?" → "give this again but in
  // increasing order of loc". The router rebuilt only "more than 6" (Colorado dropped).
  const roster: FilterCompany[] = [
    ...ROSTER,
    { id: "peak", name: "Peak Clinics", industry: "Dental", locations: 7, metro: "Denver, CO", inTerritory: true, onlineBooking: false },
    { id: "basin", name: "Basin Health", industry: "Dental", locations: 9, metro: "Boise, ID", inTerritory: false, onlineBooking: false },
  ];
  const coloradoOverSix = ["peak", "summit"];
  const resort = decision({
    filters: [{ field: "locations", op: "gt", value: 6 }],
    sort: { field: "locations", direction: "asc" },
  });

  it("keeps every condition of the previous list (the same companies), re-sorted; the count line counts them", () => {
    const answer = answerAllCompanies(resort, roster, coloradoOverSix);
    expect(answer.intro).toBe("2 companies match.");
    expect(answer.items.map((item) => item.companyName)).toEqual(["Peak Clinics", "Summit Dental Group"]);
    expect(answer.layout).toBe("table");
    // Without the previous list, the router's partial conditions bring Basin (Idaho) in.
    expect(answerAllCompanies(resort, roster).items.map((item) => item.companyName)).toEqual([
      "Peak Clinics",
      "Summit Dental Group",
      "Basin Health",
    ]);
  });

  it("with no conditions from the router, the whole previous list; a condition it adds narrows it", () => {
    expect(
      answerAllCompanies(decision({ filters: null, criteriaCount: 0, sort: { field: "name", direction: "desc" } }), roster, coloradoOverSix).items.map(
        (item) => item.companyName
      )
    ).toEqual(["Summit Dental Group", "Peak Clinics"]);
    expect(
      answerAllCompanies(
        decision({ filters: [{ field: "locations", op: "gte", value: 8 }], sort: { field: "locations", direction: "asc" } }),
        roster,
        coloradoOverSix
      ).items.map((item) => item.companyName)
    ).toEqual(["Summit Dental Group"]);
  });

  it("only for a sort request: without a sort the question is answered as usual", () => {
    expect(answerAllCompanies(decision({ filters: [{ field: "locations", op: "gt", value: 6 }] }), roster, coloradoOverSix).intro).toBe(
      "3 companies match."
    );
  });

  it("the question must point back at the list; the previous list is the last entry when it was an All-companies answer", () => {
    for (const text of ["give this again but in increasing order of loc", "sort them by name", "those, largest first", "same list by locations"]) {
      expect(refersToPreviousList(text), text).toBe(true);
    }
    for (const text of ["which are in Texas, largest first?", "sort by name"]) {
      expect(refersToPreviousList(text), text).toBe(false);
    }
    const ALL = { mode: "all" };
    const list = { role: "assistant", intro: "2 companies match.", items: [{ companyId: "peak", text: "x" }, { companyId: "summit", text: "y" }], scope: ALL };
    expect(parsePreviousListIds([{ role: "user", content: "more than 6?", scope: ALL }, list])).toEqual(["peak", "summit"]);
    expect(parsePreviousListIds([list, { role: "user", content: "next", scope: ALL }])).toEqual([]);
    expect(parsePreviousListIds([{ ...list, scope: { mode: "companies", companyIds: ["peak"] } }])).toEqual([]);
    expect(parsePreviousListIds("nope")).toEqual([]);
    expect(parsePreviousListIds([{ ...list, items: [{ companyId: 7 }, null, { companyId: "peak" }] }])).toEqual(["peak"]);
  });
});

describe("industries from the roster (2026-11-08)", () => {
  const company = (id: string, industry: string): FilterCompany => ({
    id,
    name: `Company ${id}`,
    industry,
    locations: 3,
    metro: "Austin, TX",
    inTerritory: true,
    onlineBooking: true,
  });
  const ROSTER_B = [
    company("a", "Fitness Studio"),
    company("b", "Fitness Studio Supplies"),
    company("c", "Legal Services"),
    company("d", " legal services "),
    company("e", "Auto Repair"),
    company("f", ""),
  ];
  const names = (answer: { items: Array<{ companyId: string }> }): string[] => answer.items.map((item) => item.companyId);
  const industry = (value: string): RosterFilter => ({ field: "industry", op: "contains", value });

  it("the distinct industry names, trimmed, one spelling per name, A–Z (no empty ones)", () => {
    expect(industryNames(ROSTER_B)).toEqual(["Auto Repair", "Fitness Studio", "Fitness Studio Supplies", "Legal Services"]);
    expect(industryNames(ROSTER)).toEqual(["Dental", "Retail", "Veterinary"]);
  });

  it("a value that is one of them (any case) matches that industry exactly", () => {
    expect(names(answerFilter([industry("Fitness Studio")], ROSTER_B))).toEqual(["a"]);
    expect(names(answerFilter([industry("legal services")], ROSTER_B))).toEqual(["c", "d"]);
    // Two industry conditions: either one.
    expect(names(answerFilter([industry("Auto Repair"), industry("Fitness Studio")], ROSTER_B))).toEqual(["a", "e"]);
  });

  it("any other value falls back to 'contains', as before", () => {
    expect(names(answerFilter([industry("fitness")], ROSTER_B))).toEqual(["a", "b"]);
    expect(names(answerFilter([industry("dent")], ROSTER))).toEqual(["maple", "summit"]);
    // Without the roster's names (matchesFilter alone), every value is "contains".
    expect(matchesFilter(company("x", "Fitness Studio Supplies"), industry("Fitness Studio"))).toBe(true);
    expect(matchesFilter(company("x", "Fitness Studio Supplies"), industry("Fitness Studio"), new Set(["fitness studio"]))).toBe(false);
  });

  it("a re-sorted previous list uses the whole roster's names", () => {
    const decision: RouterDecision = {
      intent: "filter_list",
      topic: null,
      attribute: null,
      filters: [industry("Fitness Studio")],
      criteriaCount: 1,
      exactValue: false,
      sort: { field: "name", direction: "asc" },
    };
    expect(names(answerAllCompanies(decision, ROSTER_B, ["a", "b"]))).toEqual(["a"]);
  });
});

describe("negative conditions: not, outside, except (2026-11-08)", () => {
  const TX: FilterCompany = { id: "lone", name: "Lone Star Clinics", industry: "Dental", locations: 5, metro: "Austin, TX", inTerritory: false, onlineBooking: false };
  const WITH_TX = [...ROSTER, TX];
  const ids = (filters: unknown[], companies: readonly FilterCompany[] = WITH_TX): string[] => {
    const parsed = parseRosterFilters(filters, undefined);
    expect(parsed, JSON.stringify(filters)).not.toBeNull();
    return answerFilter(parsed ?? [], companies).items.map((item) => item.companyId);
  };

  it("parses ne / not_contains (and common spellings) for industry, metro and state; a negative yes/no flips the value", () => {
    expect(parseRosterFilter({ field: "state", op: "ne", value: "Colorado" })).toEqual({ field: "state", op: "ne", value: "CO" });
    expect(parseRosterFilter({ field: "state", op: "not in", value: "CO" })).toEqual({ field: "state", op: "ne", value: "CO" });
    expect(parseRosterFilter({ field: "metro", op: "not_contains", value: "Denver" })).toEqual({ field: "metro", op: "not_contains", value: "Denver" });
    expect(parseRosterFilter({ field: "industry", op: "!=", value: "Dental" })).toEqual({ field: "industry", op: "not_contains", value: "Dental" });
    expect(parseRosterFilter({ field: "industry", op: "doesn't contain", value: "dent" })).toEqual({ field: "industry", op: "not_contains", value: "dent" });
    expect(parseRosterFilter({ field: "territory", op: "ne", value: true })).toEqual({ field: "territory", op: "eq", value: false });
    expect(parseRosterFilter({ field: "online_booking", op: "not", value: "yes" })).toEqual({ field: "online_booking", op: "eq", value: false });
    // Positive ops are read as before.
    expect(parseRosterFilter({ field: "state", op: "eq", value: "CO" })).toEqual({ field: "state", op: "eq", value: "CO" });
    expect(parseRosterFilter({ field: "industry", op: "eq", value: "Dental" })).toEqual({ field: "industry", op: "contains", value: "Dental" });
    // Locations keep their comparisons: "ne" is not one.
    expect(parseRosterFilter({ field: "locations", op: "ne", value: 3 })).toBeNull();
    expect(isNegativeFilter({ field: "state", op: "ne", value: "CO" })).toBe(true);
    expect(isNegativeFilter({ field: "state", op: "eq", value: "CO" })).toBe(false);
  });

  it('"outside Colorado" lists only the companies in other (known) states', () => {
    expect(ids([{ field: "state", op: "ne", value: "CO" }])).toEqual(["lone", "outdoor"]);
    // Aspen has no metro on record: an unknown state is not "outside Colorado".
    expect(ids([{ field: "state", op: "ne", value: "CO" }])).not.toContain("aspen");
  });

  it("industry: a negative listed name excludes exactly that industry; any other value excludes what contains it", () => {
    expect(ids([{ field: "industry", op: "ne", value: "Dental" }])).toEqual(["aspen", "falcon", "outdoor"]);
    expect(ids([{ field: "industry", op: "not_contains", value: "tail" }])).toEqual(["aspen", "lone", "maple", "summit"]);
  });

  it("metro: not_contains excludes metros containing it (a missing metro never matches)", () => {
    // (A–Z by name: Summit Dental Group before Summit Outdoor Gear.)
    expect(ids([{ field: "metro", op: "not_contains", value: "Denver" }])).toEqual(["lone", "maple", "summit", "outdoor"]);
  });

  it("within a field: one positive is enough, every negative must hold; different fields all hold", () => {
    // Positives Boulder or Denver, but not Boulder → Denver only.
    expect(
      ids([
        { field: "metro", op: "contains", value: "Boulder" },
        { field: "metro", op: "contains", value: "Denver" },
        { field: "metro", op: "not_contains", value: "Boulder" },
      ])
    ).toEqual(["falcon"]);
    // "not in Colorado or Idaho" excludes both.
    expect(
      ids([
        { field: "state", op: "ne", value: "CO" },
        { field: "state", op: "ne", value: "ID" },
      ])
    ).toEqual(["lone"]);
    // "dental or vet, not in Colorado".
    expect(
      ids([
        { field: "industry", op: "eq", value: "Dental" },
        { field: "industry", op: "eq", value: "Veterinary" },
        { field: "state", op: "ne", value: "CO" },
      ])
    ).toEqual(["lone"]);
  });

  it('"dental, not in Colorado" with no such company → "No companies match that."', () => {
    const filters = parseRosterFilters(
      [
        { field: "industry", op: "eq", value: "Dental" },
        { field: "state", op: "ne", value: "CO" },
      ],
      undefined
    );
    expect(answerAllCompanies(decision({ filters, criteriaCount: 2 }), ROSTER)).toEqual({ intro: NO_FILTER_MATCHES_REPLY, items: [] });
  });

  it("the partial count line still names the fields of negative conditions", () => {
    expect(
      partialMatchCountIntro(1, [
        { field: "industry", op: "contains", value: "Dental" },
        { field: "state", op: "ne", value: "CO" },
      ])
    ).toBe("1 company matches the filters I could apply (industry and state).");
  });
});

describe("narrowing the previous list (2026-11-08)", () => {
  const OUTSIDE_IDS = ["outdoor", "aspen"];
  const narrowing = (overrides: Partial<RouterDecision>): RouterDecision => decision({ narrowsPrevious: true, ...overrides });
  const ids = (answer: { items: Array<{ companyId: string }> }): string[] => answer.items.map((item) => item.companyId);

  it("the new conditions run over the previous list only; the count line counts them", () => {
    const answer = answerAllCompanies(narrowing({ filters: [{ field: "online_booking", op: "eq", value: true }] }), ROSTER, OUTSIDE_IDS);
    expect(ids(answer)).toEqual(["aspen", "outdoor"]);
    expect(answer.intro).toBe("2 companies match.");
    // Not narrowing: the whole roster (Maple has online booking too).
    expect(ids(answerAllCompanies(decision({ filters: [{ field: "online_booking", op: "eq", value: true }] }), ROSTER, OUTSIDE_IDS))).toEqual([
      "aspen",
      "maple",
      "outdoor",
    ]);
  });

  it("a negative condition narrows too; a sort works on top; a partial question keeps its line and note", () => {
    const notVet = { field: "industry", op: "not_contains", value: "Veterinary" } as const;
    expect(ids(answerAllCompanies(narrowing({ filters: [notVet] }), ROSTER, OUTSIDE_IDS))).toEqual(["outdoor"]);
    const sorted = answerAllCompanies(
      narrowing({ filters: [{ field: "locations", op: "gte", value: 1 }], sort: { field: "locations", direction: "desc" } }),
      ROSTER,
      ["summit", "maple", "falcon"]
    );
    expect(ids(sorted)).toEqual(["summit", "maple", "falcon"]);
    const partial = answerAllCompanies(narrowing({ filters: [notVet], unfiltered: true }), ROSTER, OUTSIDE_IDS);
    expect(partial.intro).toBe("1 company matches the filters I could apply (industry).");
    expect(partial.note).toBeDefined();
  });

  it("no previous list, or no narrowing → as today; a narrowing question with no condition gets the list again", () => {
    const greaterThan2 = { field: "locations", op: "gt", value: 2 } as const;
    expect(ids(answerAllCompanies(narrowing({ filters: [greaterThan2] }), ROSTER, []))).toEqual(["maple", "summit"]);
    expect(ids(answerAllCompanies(narrowing({ filters: [greaterThan2] }), ROSTER, ["gone"]))).toEqual(["maple", "summit"]);
    // "How many of these?" right after a list: that list (not the roster total).
    const again = answerAllCompanies(narrowing({ filters: null, criteriaCount: 0 }), ROSTER, OUTSIDE_IDS);
    expect(again.intro).toBe("2 companies match.");
    expect(answerAllCompanies(decision({ filters: null, criteriaCount: 0 }), ROSTER, OUTSIDE_IDS).intro).toBe(
      `There are ${ROSTER.length} companies in the Data Room.`
    );
  });
});
