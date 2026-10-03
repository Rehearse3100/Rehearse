/**
 * guardrails.test.ts
 * Proves structural-correlation and template-density validators still throw.
 */

import { describe, expect, it } from "vitest";
import {
  validateNoStructuralClassCorrelation,
  validateNoTemplateDensity,
} from "../scripts/generate-prospect-directory";

type FakeRecord = {
  label: string;
  class: string;
  factCount: number;
  facts: string[];
};

const structuralConfig = {
  getClass: (record: FakeRecord) => record.class,
  properties: [
    { name: "research_facts length", getValue: (record: FakeRecord) => record.factCount },
  ],
};

const templateConfig = {
  getRecordLabel: (record: FakeRecord) => record.label,
  fields: [
    {
      name: "text facts",
      getStrings: (record: FakeRecord) => record.facts,
      maxPerRecord: 2,
      maxCorpusShare: 1, // isolate per-record checks in these unit cases
    },
  ],
};

describe("validateNoStructuralClassCorrelation", () => {
  it("throws when a value is exclusive to one class", () => {
    const records: FakeRecord[] = [
      { label: "A", class: "trap", factCount: 4, facts: [] },
      { label: "B", class: "trap", factCount: 4, facts: [] },
      { label: "C", class: "pass", factCount: 5, facts: [] },
      { label: "D", class: "pass", factCount: 5, facts: [] },
      { label: "E", class: "near_miss", factCount: 5, facts: [] },
      { label: "F", class: "strong_fit", factCount: 5, facts: [] },
    ];
    expect(() => validateNoStructuralClassCorrelation(records, structuralConfig)).toThrow(
      /Structural leak/
    );
  });

  it("throws when a class never takes a value that others take (excluded value)", () => {
    // All classes use 4 and 5 except trap, which never has 3 while others do.
    const records: FakeRecord[] = [
      { label: "A", class: "trap", factCount: 4, facts: [] },
      { label: "B", class: "trap", factCount: 5, facts: [] },
      { label: "C", class: "pass", factCount: 3, facts: [] },
      { label: "D", class: "pass", factCount: 4, facts: [] },
      { label: "E", class: "pass", factCount: 5, facts: [] },
      { label: "F", class: "near_miss", factCount: 3, facts: [] },
      { label: "G", class: "near_miss", factCount: 4, facts: [] },
      { label: "H", class: "near_miss", factCount: 5, facts: [] },
      { label: "I", class: "strong_fit", factCount: 3, facts: [] },
      { label: "J", class: "strong_fit", factCount: 4, facts: [] },
      { label: "K", class: "strong_fit", factCount: 5, facts: [] },
    ];
    expect(() => validateNoStructuralClassCorrelation(records, structuralConfig)).toThrow(
      /never takes/
    );
  });

  it("passes on a balanced set", () => {
    const records: FakeRecord[] = [];
    for (const companyClass of ["strong_fit", "near_miss", "trap", "pass"]) {
      for (const factCount of [4, 5, 6, 7]) {
        records.push({
          label: `${companyClass}-${factCount}`,
          class: companyClass,
          factCount,
          facts: [],
        });
      }
    }
    expect(() =>
      validateNoStructuralClassCorrelation(records, structuralConfig)
    ).not.toThrow();
  });
});

describe("validateNoTemplateDensity", () => {
  it("throws when a record has 3+ strings sharing one skeleton", () => {
    const shared =
      "Careers page lists hygienist openings at two locations across the Front Range today";
    const records: FakeRecord[] = [
      {
        label: "Dense Co",
        class: "pass",
        factCount: 3,
        facts: [
          shared,
          "Careers page lists hygienist openings at three clinics across the Front Range today",
          "Careers page lists hygienist openings at four offices across the Front Range today",
        ],
      },
    ];
    expect(() => validateNoTemplateDensity(records, templateConfig)).toThrow(
      /Template density/
    );
  });

  it("throws on the odd-one-out case (3+ shared skeleton + one distinct)", () => {
    // maxPerRecord must be >= 3 so the density check does not fire first;
    // odd-one-out triggers when count >= 3 share a skeleton and exactly one is distinct.
    const oddOneOutConfig = {
      ...templateConfig,
      fields: [
        {
          name: "text facts",
          getStrings: (record: FakeRecord) => record.facts,
          maxPerRecord: 3,
          maxCorpusShare: 1,
        },
      ],
    };
    const records: FakeRecord[] = [
      {
        label: "Odd Co",
        class: "pass",
        factCount: 4,
        facts: [
          "Careers page lists hygienist openings at two locations across the Front Range today",
          "Careers page lists hygienist openings at three clinics across the Front Range today",
          "Careers page lists hygienist openings at four offices across the Front Range today",
          "Patient forum threads discuss parking at the downtown location only",
        ],
      },
    ];
    expect(() => validateNoTemplateDensity(records, oddOneOutConfig)).toThrow(
      /odd-one-out/i
    );
  });

  it("passes on varied strings", () => {
    const records: FakeRecord[] = [
      {
        label: "Varied Co",
        class: "pass",
        factCount: 4,
        facts: [
          "Careers page lists hygienist openings at two locations.",
          "Google reviews praise friendly staff with occasional wait-time mentions.",
          "Local newsletter profiled the practice school outreach program.",
          "Website highlights same-day emergency appointment availability.",
        ],
      },
    ];
    expect(() => validateNoTemplateDensity(records, templateConfig)).not.toThrow();
  });
});
