/**
 * data-room-chat-scope.test.ts
 * Data Room assistant scope helpers: generic words derived from the roster,
 * type-to-pick suggestions, company detection, and scope priority on send.
 * Fixture roster uses names from the directory generator's real name pools.
 */

import { describe, expect, it } from "vitest";
import {
  buildGenericWords,
  buildScopeIndex,
  detectCompanies,
  insertPickedName,
  previewScope,
  resolveSendScope,
  scopesEqual,
  SCOPE_NONE_MESSAGE,
  SCOPE_TOO_MANY_MESSAGE,
  suggestCompanies,
  textContainsCompanyName,
  wordFragmentBeforeCaret,
  type ScopeCompany,
} from "@/lib/data-room-chat-scope";

const ROSTER: ScopeCompany[] = [
  { id: "summit-dental", name: "Summit Dental Group", industry: "Dental" },
  { id: "summit-outdoor", name: "Summit Outdoor Gear", industry: "Retail" },
  { id: "cedar", name: "Cedar Grove Family Dentistry", industry: "Dental" },
  { id: "maple", name: "Maple Family Dentistry", industry: "Dental" },
  { id: "harbor", name: "Harbor Regional Family Dentistry", industry: "Dental" },
  { id: "ironwood", name: "Ironwood Dental Group", industry: "Dental" },
  { id: "falcon", name: "Falcon Market", industry: "Retail" },
  { id: "mesa", name: "Mesa Ridge Chiropractic Center", industry: "Chiropractic" },
  { id: "juniper-eye", name: "Juniper Eye Care", industry: "Optometry" },
  { id: "juniper-vision", name: "Juniper Ridge Vision Group", industry: "Optometry" },
  { id: "pinecrest", name: "Pinecrest Urgent Care", industry: "Urgent Care" },
  { id: "evergreen", name: "Evergreen Animal Hospital", industry: "Veterinary" },
  { id: "bison", name: "Bison Auto Works", industry: "Auto Repair" },
  { id: "oasis", name: "Oasis Supply Co.", industry: "Retail" },
  { id: "ridgeline", name: "Ridgeline Rehab Partners", industry: "Physical Therapy" },
];

const index = buildScopeIndex(ROSTER);
const names = (companies: ScopeCompany[]): string[] => companies.map((c) => c.name);

describe("generic words (derived from the roster)", () => {
  const generic = buildGenericWords(ROSTER);

  it("includes words used in 3+ names, industry words, and stop words", () => {
    for (const word of ["family", "dentistry", "group", "dental", "care", "urgent", "retail", "co", "the"]) {
      expect(generic.has(word), word).toBe(true);
    }
  });

  it("keeps distinctive words non-generic", () => {
    for (const word of ["summit", "falcon", "market", "juniper", "evergreen", "oasis"]) {
      expect(generic.has(word), word).toBe(false);
    }
  });
});

describe("type-to-pick suggestions", () => {
  it('"sum" suggests both Summit companies', () => {
    expect(names(suggestCompanies(index, "sum"))).toEqual([
      "Summit Dental Group",
      "Summit Outdoor Gear",
    ]);
  });

  it('"den" and "care" suggest nothing (generic words)', () => {
    expect(suggestCompanies(index, "den")).toEqual([]);
    expect(suggestCompanies(index, "care")).toEqual([]);
  });

  it("matches the start of any non-generic word, first-word matches first", () => {
    expect(names(suggestCompanies(index, "mar"))).toEqual(["Falcon Market"]);
    expect(names(suggestCompanies(index, "Fal"))).toEqual(["Falcon Market"]);
    expect(names(suggestCompanies(index, "rid"))).toEqual([
      "Ridgeline Rehab Partners",
      "Juniper Ridge Vision Group",
      "Mesa Ridge Chiropractic Center",
    ]);
  });

  it("needs at least 3 letters and shows at most 5", () => {
    expect(suggestCompanies(index, "su")).toEqual([]);
    const many = buildScopeIndex(
      Array.from({ length: 8 }, (_, i) => ({ id: `z${i}`, name: `Zephyr${i} Studio`, industry: "Fitness Studio" }))
    );
    expect(suggestCompanies(many, "zep")).toHaveLength(5);
  });

  it("finds the word being typed and replaces it with the picked name", () => {
    const text = "what about sum";
    const fragment = wordFragmentBeforeCaret(text, text.length);
    expect(fragment).toEqual({ fragment: "sum", start: 11 });
    expect(insertPickedName(text, 11, text.length, "Summit Dental Group")).toEqual({
      text: "what about Summit Dental Group ",
      caret: 31,
    });
    expect(insertPickedName("is sum hiring?", 3, 6, "Summit Outdoor Gear")).toEqual({
      text: "is Summit Outdoor Gear hiring?",
      caret: 22,
    });
  });
});

describe("company detection", () => {
  it("detects a full name in any case", () => {
    expect(detectCompanies(index, "Tell me about falcon market please").companyIds).toEqual(["falcon"]);
  });

  it("detects an identifying first word that matches exactly one company", () => {
    expect(detectCompanies(index, "what about Falcon?").companyIds).toEqual(["falcon"]);
    expect(detectCompanies(index, "Is Evergreen hiring?").companyIds).toEqual(["evergreen"]);
  });

  it("ignores ordinary words that are not first words", () => {
    expect(detectCompanies(index, "what market are they in, any vision for the center?")).toEqual({
      companyIds: [],
      ambiguous: null,
    });
  });

  it("asks when a first word matches 2+ companies", () => {
    const result = detectCompanies(index, "is summit hiring?");
    expect(result.companyIds).toEqual([]);
    expect(result.ambiguous?.word).toBe("summit");
    expect(names(result.ambiguous?.options ?? [])).toEqual(["Summit Dental Group", "Summit Outdoor Gear"]);
  });

  it("a full name resolves its own first word (no question)", () => {
    expect(detectCompanies(index, "Compare Summit Dental Group and Oasis Supply Co.")).toEqual({
      companyIds: ["summit-dental", "oasis"],
      ambiguous: null,
    });
  });

  it("checks whether a picked name is still in the text", () => {
    expect(textContainsCompanyName(index, "what about Summit Dental Group?", "summit-dental")).toBe(true);
    expect(textContainsCompanyName(index, "what about Summit?", "summit-dental")).toBe(false);
  });
});

describe("scope on send (priority 1–4)", () => {
  const base = { index, text: "what are their risks?", allCompanies: false, pickedIds: [], openCompanyId: "maple" };

  it("1. All companies wins over everything", () => {
    expect(resolveSendScope({ ...base, allCompanies: true, text: "Falcon Market?" })).toEqual({
      kind: "send",
      scope: { mode: "all" },
    });
  });

  it("2. picked + detected companies win over the open company", () => {
    expect(
      resolveSendScope({ ...base, text: "and Evergreen?", pickedIds: ["falcon"] })
    ).toEqual({ kind: "send", scope: { mode: "companies", companyIds: ["falcon", "evergreen"] } });
  });

  it("2. an ambiguous word asks instead of sending; picking an option resolves it", () => {
    const asked = resolveSendScope({ ...base, text: "is Summit hiring?" });
    expect(asked.kind).toBe("ask");
    expect(resolveSendScope({ ...base, text: "is Summit hiring?", pickedIds: ["summit-outdoor"] })).toEqual({
      kind: "send",
      scope: { mode: "companies", companyIds: ["summit-outdoor"] },
    });
  });

  it("3. falls back to the open company", () => {
    expect(resolveSendScope(base)).toEqual({
      kind: "send",
      scope: { mode: "companies", companyIds: ["maple"] },
    });
  });

  it("4. nothing in scope is an error", () => {
    expect(resolveSendScope({ ...base, openCompanyId: null })).toEqual({
      kind: "error",
      message: SCOPE_NONE_MESSAGE,
    });
  });

  it("allows at most 3 companies per question", () => {
    expect(
      resolveSendScope({ ...base, text: "Falcon, Evergreen, Oasis Supply Co. and Bison?" })
    ).toEqual({ kind: "error", message: SCOPE_TOO_MANY_MESSAGE });
    expect(
      resolveSendScope({ ...base, text: "Falcon, Evergreen and Bison?" })
    ).toEqual({
      kind: "send",
      scope: { mode: "companies", companyIds: ["falcon", "evergreen", "bison"] },
    });
  });

  it("live preview follows the same priority without blocking", () => {
    expect(previewScope({ ...base, allCompanies: true })).toEqual({ kind: "all" });
    expect(previewScope({ ...base, text: "Falcon?" })).toEqual({ kind: "companies", companies: [ROSTER[6]] });
    expect(previewScope(base)).toEqual({ kind: "companies", companies: [ROSTER[3]] });
    expect(previewScope({ ...base, openCompanyId: null })).toEqual({ kind: "none" });
  });

  it("compares scopes as sets", () => {
    expect(scopesEqual({ mode: "companies", companyIds: ["a", "b"] }, { mode: "companies", companyIds: ["b", "a"] })).toBe(true);
    expect(scopesEqual({ mode: "companies", companyIds: ["a"] }, { mode: "companies", companyIds: ["a", "b"] })).toBe(false);
    expect(scopesEqual({ mode: "all" }, { mode: "all" })).toBe(true);
    expect(scopesEqual({ mode: "all" }, { mode: "companies", companyIds: ["a"] })).toBe(false);
  });
});
