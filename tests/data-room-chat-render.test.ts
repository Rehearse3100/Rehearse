/**
 * data-room-chat-render.test.ts
 * Extractive answers (pure): fact ids and display sentences built from stored
 * values, the findings and public facts the policy allows, the answer path per
 * router decision (compare is an overview), the renderers (overview, attribute,
 * selected facts, nothing-findable, the exact-detail intro), and the selection
 * call's messages (allowed findings and public facts) and reply parsing (only given
 * ids survive, in order; exact_answer).
 */

import { describe, expect, it } from "vitest";
import {
  allowedFindings,
  allowedPublicFacts,
  answerPathFor,
  attributeLines,
  buildCompanyFacts,
  buildSelectionMessages,
  EXACT_DETAIL_MISSING_INTRO,
  NOTHING_FINDABLE_REPLY,
  overviewLines,
  parseSelection,
  publicFacts,
  renderAnswer,
  SELECTION_SYSTEM_PROMPT,
  toSelectableFacts,
  withExactDetailIntro,
  type CompanyFactSource,
} from "@/lib/data-room-chat-render";
import type { ResearchFinding } from "@/lib/data-room-research-topics";

const TOOLS: ResearchFinding = { text: "Signed a multi-year agreement with a scheduling vendor last year.", topics: ["current_tools"] };
const BUDGET: ResearchFinding = { text: "Finance memo cites a freeze on discretionary software spend.", topics: ["budget"] };

const SUMMIT: CompanyFactSource = {
  id: "summit",
  industry: "Dental",
  vertical: "dental group",
  locations: 8,
  metro: "Front Range, CO",
  inTerritory: true,
  sizeNote: "Mid-size regional group",
  onlineBooking: false,
  blurb: "Summit Dental Group runs eight clinics.",
  publicSignals: ["Opened 8th location three months ago", "  ", "Hiring two hygienists"],
  contacts: [
    { name: "Pat Lee", title: "Owner", department: "" },
    { name: "Dana Reyes", title: "Director of Operations", department: "Operations" },
  ],
  findings: [TOOLS, BUDGET],
};

const SPARSE: CompanyFactSource = {
  id: "sparse",
  industry: "Retail",
  vertical: null,
  locations: 1,
  metro: null,
  inTerritory: null,
  sizeNote: null,
  onlineBooking: null,
  blurb: null,
  publicSignals: [],
  contacts: [],
  findings: [],
};

const summit = buildCompanyFacts(SUMMIT);
const sparse = buildCompanyFacts(SPARSE);

describe("facts", () => {
  it("one fact per stored attribute, signal and finding, with stable ids and display sentences", () => {
    expect(publicFacts(summit).map((f) => [f.id, f.display])).toEqual([
      ["summit:p:industry", "Industry: Dental Group."],
      ["summit:p:locations", "8 locations across Front Range, CO."],
      ["summit:p:metro", "Metro area: Front Range, CO."],
      ["summit:p:territory", "In territory."],
      ["summit:p:online_booking", "No online booking."],
      ["summit:p:size", "Mid-size regional group."],
      ["summit:p:blurb", "Summit Dental Group runs eight clinics."],
      ["summit:p:contacts", "Contacts: Dana Reyes, Director of Operations (Operations); Pat Lee, Owner."],
      ["summit:s:0", "Opened 8th location three months ago"],
      ["summit:s:2", "Hiring two hygienists"],
    ]);
    expect(summit.hidden.map((f) => [f.id, f.display])).toEqual([
      ["summit:h:0", TOOLS.text],
      ["summit:h:1", BUDGET.text],
    ]);
    expect(summit.headline).toBe("Dental Group · 8 locations · Front Range, CO");
  });

  it("missing values get no fact; the industry falls back to the industry column", () => {
    expect(publicFacts(sparse).map((f) => [f.id, f.display])).toEqual([
      ["sparse:p:industry", "Industry: Retail."],
      ["sparse:p:locations", "1 location."],
    ]);
    expect(sparse.headline).toBe("Retail · 1 location");
    expect(buildCompanyFacts({ ...SPARSE, metro: "Denver, CO" }).attributes.locations?.display).toBe(
      "1 location in Denver, CO."
    );
  });

  it("allowed findings: only the ones the policy allows, in stored order", () => {
    expect(allowedFindings(summit, { public: true, hidden: [BUDGET, TOOLS] }).map((f) => f.id)).toEqual([
      "summit:h:0",
      "summit:h:1",
    ]);
    expect(allowedFindings(summit, { public: true, hidden: [BUDGET] }).map((f) => f.id)).toEqual(["summit:h:1"]);
    expect(allowedFindings(summit, { public: true, hidden: [] })).toEqual([]);
    expect(allowedFindings(summit, undefined)).toEqual([]);
  });

  it("allowed public facts: every public fact (never a finding) when the policy allows them", () => {
    expect(allowedPublicFacts(summit, { public: true, hidden: [BUDGET] })).toEqual(publicFacts(summit));
    expect(allowedPublicFacts(summit, { public: true, hidden: [BUDGET] }).some((f) => f.kind === "h")).toBe(false);
    expect(allowedPublicFacts(summit, { public: false, hidden: [] })).toEqual([]);
    expect(allowedPublicFacts(summit, undefined)).toEqual([]);
  });
});

describe("answer paths", () => {
  it("maps each router decision to its path", () => {
    const path = (intent: string, attribute: string | null = null): unknown =>
      answerPathFor({ intent, topic: null, attribute } as Parameters<typeof answerPathFor>[0]);
    expect(path("overview")).toEqual({ kind: "overview" });
    expect(path("meta_or_bulk")).toEqual({ kind: "overview" });
    expect(path("attribute_lookup", "locations")).toEqual({ kind: "attribute", attribute: "locations" });
    expect(path("attribute_lookup")).toEqual({ kind: "overview" });
    expect(path("specific_research")).toEqual({ kind: "select" });
    expect(path("filter_list")).toEqual({ kind: "select" });
    expect(path("compare")).toEqual({ kind: "overview" });
  });
});

describe("rendering", () => {
  it("overview: headline, territory, online booking, blurb, signals in a fixed order", () => {
    expect(overviewLines(summit)).toEqual([
      "Dental Group · 8 locations · Front Range, CO",
      "In territory.",
      "No online booking.",
      "Summit Dental Group runs eight clinics.",
      "Opened 8th location three months ago",
      "Hiring two hygienists",
    ]);
    expect(overviewLines(sparse)).toEqual(["Retail · 1 location"]);
  });

  it("attribute: that attribute's sentence, or nothing when it has no value", () => {
    expect(attributeLines(summit, "online_booking")).toEqual(["No online booking."]);
    expect(attributeLines(sparse, "contacts")).toEqual([]);
  });

  it("renders one block per company (header from the given name) with one line per fact", () => {
    const blocks = [
      { companyId: "summit", companyName: "Summit Dental Group", lines: ["In territory.", "No online booking."] },
      { companyId: "sparse", companyName: "Sparse Shop", lines: [] },
    ];
    expect(renderAnswer(blocks, true)).toEqual({
      intro: "",
      items: [
        { companyId: "summit", companyName: "Summit Dental Group", text: "In territory.\nNo online booking." },
        { companyId: "sparse", companyName: "Sparse Shop", text: NOTHING_FINDABLE_REPLY },
      ],
    });
    expect(renderAnswer(blocks, false)).toEqual({
      intro: "",
      items: [{ companyId: "summit", companyName: "Summit Dental Group", text: "In territory.\nNo online booking." }],
    });
    expect(renderAnswer([{ ...blocks[1]! }], false)).toEqual({ intro: NOTHING_FINDABLE_REPLY, items: [] });
    expect(NOTHING_FINDABLE_REPLY).toBe("Nothing about that is publicly findable for this company.");
  });

  it("the exact-detail intro goes above facts, never above a nothing-findable answer", () => {
    const facts = { intro: "", items: [{ companyId: "summit", companyName: "Summit Dental Group", text: BUDGET.text }] };
    expect(withExactDetailIntro(facts)).toEqual({ ...facts, intro: EXACT_DETAIL_MISSING_INTRO });
    expect(EXACT_DETAIL_MISSING_INTRO).toBe("That exact detail isn't publicly findable. Related facts:");
    const nothingItem = {
      intro: "",
      items: [{ companyId: "summit", companyName: "Summit Dental Group", text: NOTHING_FINDABLE_REPLY }],
    };
    expect(withExactDetailIntro(nothingItem)).toEqual(nothingItem);
    expect(withExactDetailIntro({ intro: NOTHING_FINDABLE_REPLY, items: [] })).toEqual({
      intro: NOTHING_FINDABLE_REPLY,
      items: [],
    });
  });
});

describe("selection call", () => {
  const facts = toSelectableFacts(
    [...allowedFindings(summit, { public: true, hidden: [BUDGET] }), ...allowedPublicFacts(summit, { public: true, hidden: [BUDGET] })],
    "C1",
    (text) => text.replace("Summit Dental Group", "the company")
  );

  it("sends the question, the allowed findings and the public facts as 'id: fact' lines with ref-based ids and redacted text", () => {
    const messages = buildSelectionMessages("What's [C1]'s annual revenue?", facts);
    expect(messages[0]).toEqual({ role: "system", content: SELECTION_SYSTEM_PROMPT });
    const lines = messages[1]?.content.split("\n") ?? [];
    expect(lines.slice(0, 3)).toEqual(["Question: What's [C1]'s annual revenue?", "Facts:", `C1:h:1: ${BUDGET.text}`]);
    expect(lines).toContain("C1:p:industry: Industry: Dental Group.");
    expect(lines).toContain("C1:p:blurb: the company runs eight clinics.");
    expect(messages[1]?.content).not.toContain(TOOLS.text);
    expect(messages[1]?.content).not.toContain("summit:");
    expect(SELECTION_SYSTEM_PROMPT).toContain('{"fact_ids": string[], "exact_answer": boolean}');
    expect(SELECTION_SYSTEM_PROMPT).toContain(
      "- exact_answer: true only if a listed fact states exactly what was asked (for example the number, amount or count, the email address or phone number, or the named vendor or product); false otherwise."
    );
  });

  it("asks for no loosely related facts (and exact_answer false) when the exact thing asked for isn't stated", () => {
    expect(SELECTION_SYSTEM_PROMPT).toContain(
      "- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and return no facts rather than loosely related ones."
    );
  });

  it("keeps only ids it was given, in the model's order; foreign, invented and repeated ids are dropped", () => {
    const raw = JSON.stringify({
      fact_ids: ["C1:h:1", "C1:p:blurb", "C1:h:0", "C2:p:industry", "C1:p:revenue", "summit:p:metro", "C1:p:locations", "C1:p:blurb", 4],
      exact_answer: true,
    });
    expect(parseSelection(raw, facts)).toEqual({
      facts: [facts[0]?.fact, facts.find((f) => f.promptId === "C1:p:blurb")?.fact, facts.find((f) => f.promptId === "C1:p:locations")?.fact],
      exactAnswer: true,
    });
  });

  it("exact_answer is true only when exactly true; invalid JSON or a wrong shape select nothing", () => {
    expect(parseSelection(JSON.stringify({ fact_ids: ["C1:p:metro"] }), facts).exactAnswer).toBe(false);
    expect(parseSelection(JSON.stringify({ fact_ids: ["C1:p:metro"], exact_answer: "yes" }), facts).exactAnswer).toBe(false);
    expect(parseSelection(JSON.stringify({ fact_ids: [], exact_answer: false }), facts)).toEqual({ facts: [], exactAnswer: false });
    expect(parseSelection("not json", facts)).toEqual({ facts: [], exactAnswer: false });
    expect(parseSelection(JSON.stringify({ fact_ids: "C1:p:metro", exact_answer: true }), facts)).toEqual({
      facts: [],
      exactAnswer: false,
    });
    expect(parseSelection(null, facts)).toEqual({ facts: [], exactAnswer: false });
  });
});
