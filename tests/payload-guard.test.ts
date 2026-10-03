/**
 * payload-guard.test.ts
 * Public prospect-directory payloads must never leak answer-key fields.
 * Migrated from lib/tempo-prospect-directory.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  assertNoHiddenFieldsInPublicPayload,
  HIDDEN_PROSPECT_DIRECTORY_FIELD_NAMES,
  PUBLIC_PROSPECT_COMPANY_KEYS,
  toPublicProspectCompany,
  type ProspectDirectoryCompanyRow,
} from "@/lib/tempo-prospect-directory";

/** Forbidden keys from the task + existing hidden-field allowlist. */
const FORBIDDEN_TOP_LEVEL = [
  "research_facts",
  "researchFacts",
  "class",
  "subtype",
  "fit_rank",
  "fitRank",
  "trigger_quality",
  "triggerQuality",
  "keyed_trigger",
  "keyedTrigger",
  "best_contact",
  "bestContact",
  "why",
  "hidden_claim",
  "hiddenClaim",
  "entry_type",
  "entryType",
  "isTarget",
  "is_correct_contact",
  "stronger_axis",
  "weaker_axis",
] as const;

const FORBIDDEN_CONTACT = [
  "is_correct_contact",
  "stronger_axis",
  "weaker_axis",
  "isCorrectContact",
  "strongerAxis",
  "weakerAxis",
] as const;

const sampleRow: ProspectDirectoryCompanyRow = {
  id: "test-id",
  name: "Summit Dental Group",
  industry: "Dental",
  sizeLabel: "8 locations",
  signalHint: "Opened 8th location three months ago",
  hiddenClaim: "should-not-leak",
  isTarget: true,
  vertical: "dental",
  locations: 8,
  metro: "Front Range, CO",
  inTerritory: true,
  sizeNote: "8 locations across the Front Range",
  onlineBooking: false,
  blurb: "Multi-location dental group.",
  publicSignals: ["Opened 8th location three months ago"],
  researchFacts: ["Hidden research fact"],
  class: "strong_fit",
  subtype: null,
  fitRank: 1,
  triggerQuality: "strong",
  keyedTrigger: "8th location + front-desk hiring",
  bestContact: "Dana Reyes",
  why: "Answer key",
  entryType: "target",
  contacts: [
    {
      name: "Dana Reyes",
      title: "Director of Operations",
      department: "Operations",
    },
  ],
};

describe("toPublicProspectCompany", () => {
  it("strips every answer-key field from the returned object's own keys", () => {
    const publicPayload = toPublicProspectCompany(sampleRow);
    const keys = Object.keys(publicPayload);

    for (const forbidden of FORBIDDEN_TOP_LEVEL) {
      expect(keys, `leaked ${forbidden}`).not.toContain(forbidden);
      expect(
        Object.prototype.hasOwnProperty.call(publicPayload, forbidden),
        `hasOwnProperty ${forbidden}`
      ).toBe(false);
    }

    for (const contact of publicPayload.contacts) {
      const contactKeys = Object.keys(contact);
      for (const forbidden of FORBIDDEN_CONTACT) {
        expect(contactKeys, `contact leaked ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("passes assertNoHiddenFieldsInPublicPayload and only emits allowlisted keys", () => {
    const publicPayload = toPublicProspectCompany(sampleRow);
    expect(() => assertNoHiddenFieldsInPublicPayload(publicPayload)).not.toThrow();

    for (const hidden of HIDDEN_PROSPECT_DIRECTORY_FIELD_NAMES) {
      expect(Object.prototype.hasOwnProperty.call(publicPayload, hidden)).toBe(false);
    }

    for (const key of Object.keys(publicPayload)) {
      expect(PUBLIC_PROSPECT_COMPANY_KEYS as readonly string[]).toContain(key);
    }
  });
});
