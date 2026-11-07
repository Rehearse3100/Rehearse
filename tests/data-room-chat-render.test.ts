/**
 * data-room-chat-render.test.ts
 * Extractive answers (pure): fact ids and display sentences built from stored
 * values, the findings and public facts the policy allows, the answer path per
 * router decision (compare is an overview), the renderers (overview, attribute,
 * selected facts, nothing-findable, the exact-detail intro), the opening sentence
 * (its call's input: question, topic and shown answer only, names as Company 1…; its
 * prompt; every drop rule, including claim words the facts don't state and the drop
 * reason; where it shows), the follow-up's "nothing new" line, and the selection
 * call's messages (allowed findings and public facts), prompt (only facts that answer)
 * and reply parsing (only given ids survive, in order; exact_answer).
 */

import { describe, expect, it } from "vitest";
import { ALL_MODE_REPLY, NO_FILTER_MATCHES_REPLY } from "@/lib/data-room-chat-filter";
import { OFF_TOPIC_REPLY } from "@/lib/data-room-chat-policy";
import {
  allowedFindings,
  allowedPublicFacts,
  answerPathFor,
  attributeLines,
  buildCompanyFacts,
  buildOpeningMessages,
  buildSelectionMessages,
  checkOpening,
  EXACT_DETAIL_MISSING_INTRO,
  FOLLOW_UP_NOTHING_NEW_INTRO,
  hasFacts,
  isNoFactAnswersReply,
  needsOpening,
  NOTHING_FINDABLE_REPLY,
  OPENING_SYSTEM_PROMPT,
  openingRejection,
  overviewLines,
  parseOpening,
  parseSelection,
  publicFacts,
  RELATED_FINDINGS_INTRO,
  renderAnswer,
  SELECTION_SYSTEM_PROMPT,
  toSelectableFacts,
  withExactDetailIntro,
  withNothingNewIntro,
  withOpening,
  withRelatedFindingsIntro,
  type CompanyFactSource,
} from "@/lib/data-room-chat-render";
import { buildScopeIndex, type ScopedAnswer } from "@/lib/data-room-chat-scope";
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

describe("the opening sentence (written from the finished answer)", () => {
  const index = buildScopeIndex([
    { id: "summit-dental", name: "Summit Dental Group", industry: "Dental" },
    { id: "summit-outdoor", name: "Summit Outdoor Gear", industry: "Retail" },
    { id: "falcon", name: "Falcon Market", industry: "Retail" },
    { id: "maple", name: "Maple Family Dentistry", industry: "Dental" },
    { id: "cedar", name: "Cedar Grove Family Dentistry", industry: "Dental" },
    { id: "harbor", name: "Harbor Family Dentistry", industry: "Dental" },
  ]);
  const ANSWER: ScopedAnswer = {
    intro: "",
    items: [
      {
        companyId: "summit-dental",
        companyName: "Summit Dental Group",
        text: "Dental · 8 locations · Front Range, CO\nSummit Dental Group runs eight clinics. Summit is growing fast.",
      },
      { companyId: "falcon", companyName: "Falcon Market", text: "Retail · 1 location · Denver, CO\nNo online booking." },
    ],
  };
  const check = (opening: string, question = "Compare them", answer: ScopedAnswer = ANSWER): string | null =>
    checkOpening(opening, question, answer, index);

  it("the call sees only the question and the answer text, companies as Company 1, Company 2… in answer order", () => {
    expect(buildOpeningMessages("How does Falcon Market compare with Summit Dental Group?", ANSWER, index)).toEqual([
      { role: "system", content: OPENING_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Question: How does Company 2 compare with Company 1?",
          "",
          "Answer:",
          "Company 1",
          "Dental · 8 locations · Front Range, CO",
          "Company 1 runs eight clinics. Company 1 is growing fast.",
          "",
          "Company 2",
          "Retail · 1 location · Denver, CO",
          "No online booking.",
        ].join("\n"),
      },
    ]);
  });

  it("an intro line comes first; other companies become 'another company'; a first word two shown companies share, 'a company'", () => {
    const list: ScopedAnswer = {
      intro: "2 companies match.",
      items: [
        { companyId: "summit-dental", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
        { companyId: "summit-outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 2 locations · Boise, ID" },
      ],
    };
    const content = buildOpeningMessages("Is Summit in Colorado, unlike Falcon Market or maple?", list, index)[1]?.content ?? "";
    expect(content).toBe(
      [
        "Question: Is a company in Colorado, unlike another company or another company?",
        "",
        "Answer:",
        "2 companies match.",
        "",
        "Company 1",
        "Dental · 8 locations · Front Range, CO",
        "",
        "Company 2",
        "Retail · 2 locations · Boise, ID",
      ].join("\n")
    );
    for (const name of ["summit", "falcon", "maple", "outdoor"]) {
      expect(content.toLowerCase(), name).not.toContain(name);
    }
    const exact: ScopedAnswer = {
      intro: EXACT_DETAIL_MISSING_INTRO,
      items: [{ companyId: "summit-dental", companyName: "Summit Dental Group", text: BUDGET.text }],
    };
    expect(buildOpeningMessages("What's their revenue?", exact, index)[1]?.content).toBe(
      `Question: What's their revenue?\n\nAnswer:\n${EXACT_DETAIL_MISSING_INTRO}\n\nCompany 1\n${BUDGET.text}`
    );
  });

  it("the prompt: one short sentence that may summarise the answer; no new facts, judgments or names; the call is the student's", () => {
    for (const line of [
      '{"opening": string}',
      // 2026-11-06: the example is neutral (no ICP industry or territory state).
      '- opening: ONE short, friendly sentence (at most 30 words) that introduces the answer. It may summarise what the answer shows (for example "Four fitness studios in Texas offer online booking.").',
      "- Never add a fact, number or detail that isn't in the answer.",
      '- For a list, use the total from the "N companies match" line, never the number of companies shown.',
      '- When the answer is about one company, call it "this company", never "one company" or "the company below".',
      '- Never judge, rank or recommend a company. Never write "better than", "the best", "recommend", "go with", "I\'d pick", "strong fit" or "good fit".',
      '- Never name a company, and never refer to one as "Company 1", "Company 2" and so on.',
      '- If the student asks which company is better, which one to pick, or whether one is a good prospect, say that call is theirs and the facts below can help (for example "Which one to pursue is your call; the facts below can help you compare.").',
    ]) {
      expect(OPENING_SYSTEM_PROMPT, line).toContain(line);
    }
  });

  it("reads {\"opening\": string}, trimmed; anything else is empty", () => {
    expect(parseOpening(JSON.stringify({ opening: "  Here's what's on record.  " }))).toBe("Here's what's on record.");
    for (const raw of ["not json", "", null, undefined, JSON.stringify(["x"]), JSON.stringify({ opening: 7 }), JSON.stringify({})]) {
      expect(parseOpening(raw), String(raw)).toBe("");
    }
  });

  it("keeps one short sentence, including a summary of what the answer shows", () => {
    expect(check("  Here's what's on record for both companies.  ")).toBe("Here's what's on record for both companies.");
    expect(check("Four dental companies in Colorado offer online booking.")).toBe(
      "Four dental companies in Colorado offer online booking."
    );
    expect(check("Which one to pursue is your call; the facts below can help you compare.")).toBe(
      "Which one to pursue is your call; the facts below can help you compare."
    );
  });

  it("drops it when empty, over 200 characters, or more than one sentence", () => {
    expect(check("")).toBeNull();
    expect(check(`Here's what's on record about ${"their software ".repeat(14)}.`)).toBeNull();
    expect(check("Good question! Here's what's on record.")).toBeNull();
    expect(check("Here's what's on record. Take a look.")).toBeNull();
    expect(check("Here's what's on record\nabout their software.")).toBeNull();
  });

  it("drops a ref, a Company 1-style placeholder, a full roster name, or a distinctive name word — unless the student used that word", () => {
    expect(check("Here's what's on record about C1.")).toBeNull();
    expect(check("Here's what's on record about [C2]'s software.")).toBeNull();
    expect(check("Company 1 runs eight clinics.")).toBeNull();
    expect(check("Here's how company 2 compares.")).toBeNull();
    expect(check("Here's what's on record about Falcon Market.")).toBeNull();
    expect(check("Here's what's on record about maple family dentistry.")).toBeNull();
    expect(check("Here's what's on record about Summit's software.")).toBeNull();
    expect(check("Here's what's on record about the market.")).toBeNull();
    expect(check("Here's what's on record about the market.", "What market are they in?")).toBe(
      "Here's what's on record about the market."
    );
    // Generic words (shared by 3+ names, or industry words) are fine.
    expect(check("Here's what's on record about this dental family practice.")).toBe(
      "Here's what's on record about this dental family practice."
    );
  });

  it("drops a number that is in neither the answer nor the question", () => {
    expect(check("Both have 8 locations or 1 location on record.")).toBe("Both have 8 locations or 1 location on record.");
    expect(check("Here are the 3 contacts on record.")).toBeNull();
    expect(check("Here are the 3 contacts on record.", "Who are the 3 contacts?")).toBe("Here are the 3 contacts on record.");
    const list: ScopedAnswer = { intro: "27 companies match.", items: ANSWER.items };
    expect(check("27 companies match your question.", "Which ones?", list)).toBe("27 companies match your question.");
    expect(check("28 companies match your question.", "Which ones?", list)).toBeNull();
  });

  it("drops anything that judges a company", () => {
    for (const judging of [
      "This one is better than the others.",
      "Here's the best prospect.",
      "I recommend looking at their software.",
      "We'd recommend starting here.",
      "You should go with this one.",
      "I'd pick this one.",
      "I’d pick this one.",
      "This looks like a strong fit.",
      "Both could be a good fit.",
    ]) {
      expect(check(judging), judging).toBeNull();
    }
  });

  it("shows above the facts; never on an answer with its own first line (a count line, the exact-detail line, the nothing-hidden line)", () => {
    const facts = { intro: "", items: [{ companyId: "a", companyName: "A", text: "In territory." }] };
    expect(needsOpening(facts)).toBe(true);
    expect(withOpening(facts, "Here's what's on record.")).toEqual({ ...facts, intro: "Here's what's on record." });
    const list = { intro: "2 companies match.", items: facts.items };
    const exact = { intro: EXACT_DETAIL_MISSING_INTRO, items: [{ companyId: "a", companyName: "A", text: BUDGET.text }] };
    const meta = { intro: "I can't share hidden or internal information. Here's what's public:", items: facts.items };
    for (const answer of [list, exact, meta]) {
      expect(needsOpening(answer), answer.intro).toBe(false);
      expect(withOpening(answer, "Here's who matches."), answer.intro).toEqual(answer);
    }
    expect(withOpening(facts, null)).toEqual(facts);
  });

  it("never on an answer with no facts: the nothing-findable reply or a fixed reply", () => {
    const opening = "Here's what's on record.";
    for (const answer of [
      { intro: NOTHING_FINDABLE_REPLY, items: [] },
      { intro: "", items: [{ companyId: "a", companyName: "A", text: NOTHING_FINDABLE_REPLY }] },
      { intro: OFF_TOPIC_REPLY, items: [] },
      { intro: ALL_MODE_REPLY, items: [] },
      { intro: NO_FILTER_MATCHES_REPLY, items: [] },
    ]) {
      expect(hasFacts(answer), answer.intro).toBe(false);
      expect(withOpening(answer, opening), answer.intro).toEqual(answer);
    }
    expect(hasFacts(ANSWER)).toBe(true);
  });
});

describe("the opening only restates what the facts shown say", () => {
  const index = buildScopeIndex([
    { id: "summit-dental", name: "Summit Dental Group", industry: "Dental" },
    { id: "falcon", name: "Falcon Market", industry: "Retail" },
    { id: "maple", name: "Maple Family Dentistry", industry: "Dental" },
    { id: "cedar", name: "Cedar Grove Family Dentistry", industry: "Dental" },
    { id: "northview", name: "Northview Family Dentistry", industry: "Dental" },
    { id: "canyon", name: "Canyon Aesthetics", industry: "Med Spa" },
  ]);
  const shown = (companyId: string, companyName: string, ...lines: string[]): ScopedAnswer => ({
    intro: "",
    items: [{ companyId, companyName, text: lines.join("\n") }],
  });
  // The real failures (2026-11): Canyon Aesthetics, "What changed recently?", and
  // Northview Family Dentistry, "Any risks?".
  const CANYON_CHANGES = shown(
    "canyon",
    "Canyon Aesthetics",
    "Website FAQ notes online intake forms for first-time clients.",
    "The website FAQ explains how medical directors oversee injectable services."
  );
  const NORTHVIEW_RISKS = shown(
    "northview",
    "Northview Family Dentistry",
    "Patient forum threads praise the refreshed portal branding.",
    "Website highlights same-day emergency appointment availability.",
    "Operations team standardized on SlotEasy eighteen months ago with a multi-year agreement."
  );

  it("Canyon: an opening that adds an action the facts don't state ('updated', 'recently') is dropped; a restatement is kept", () => {
    const question = "What changed recently?";
    expect(checkOpening("This company updated its online intake forms.", question, CANYON_CHANGES, index)).toBeNull();
    expect(openingRejection("This company updated its online intake forms.", question, CANYON_CHANGES, index)).toBe(
      "claim not in the facts"
    );
    // "recently" is in the question, not in the facts: still dropped.
    expect(checkOpening("This company recently added online intake forms.", question, CANYON_CHANGES, index)).toBeNull();
    expect(
      checkOpening("This company's website FAQ notes online intake forms for first-time clients.", question, CANYON_CHANGES, index)
    ).toBe("This company's website FAQ notes online intake forms for first-time clients.");
  });

  it("Northview: a concern described as a positive ('positive feedback') is dropped; leading with the concern is kept", () => {
    const question = "Any risks?";
    const positive =
      "This company has received positive feedback for its portal branding and offers same-day emergency appointments.";
    expect(checkOpening(positive, question, NORTHVIEW_RISKS, index)).toBeNull();
    expect(openingRejection(positive, question, NORTHVIEW_RISKS, index)).toBe("claim not in the facts");
    const concern = "This company's operations team standardized on SlotEasy eighteen months ago under a multi-year agreement.";
    expect(checkOpening(concern, question, NORTHVIEW_RISKS, index)).toBe(concern);
  });

  it("a claim word is fine when the facts use the same stem (any form); a look-alike word doesn't count", () => {
    const answer = shown(
      "canyon",
      "Canyon Aesthetics",
      "Reviews praise consultative staff.",
      "Recently refreshed patient portal branding",
      "Local paper noted steady growth at both studios.",
      "Expanded hygiene team hiring at two locations",
      "Local newsletter profiled the owner."
    );
    for (const opening of [
      "Reviewers praised this company's consultative staff.",
      "This company recently refreshed its patient portal branding.",
      "This company is growing steadily at both studios.",
      "This company is expanding its hygiene team.",
    ]) {
      expect(checkOpening(opening, "Any updates?", answer, index), opening).toBe(opening);
    }
    // "newsletter" is not "new"; "launched", "strong", "ideal", "perfect", "best", "introduced" aren't in the facts.
    for (const opening of [
      "This company has a new owner.",
      "This company launched a portal.",
      "This company has strong reviews.",
      "This company looks ideal.",
      "This company's portal is perfect.",
      "This company is best known for its staff.",
      "This company introduced a portal.",
    ]) {
      expect(openingRejection(opening, "Any updates?", answer, index), opening).toBe("claim not in the facts");
    }
  });

  it("a company-name word the facts shown use is fine (it names no company); a name's first word never is", () => {
    const answer = shown("summit-dental", "Summit Dental Group", "Opened a booth at the farmers market downtown.");
    expect(checkOpening("This company opened a booth at the farmers market downtown.", "Any events?", answer, index)).toBe(
      "This company opened a booth at the farmers market downtown."
    );
    // Not in the facts: still dropped (the word is part of Falcon Market's name).
    const other = shown("summit-dental", "Summit Dental Group", "Opened a booth downtown.");
    expect(openingRejection("This company opened a booth at the market.", "Any events?", other, index)).toBe(
      "company-name word"
    );
    const named = shown("summit-dental", "Summit Dental Group", "Summit is growing fast.");
    expect(openingRejection("Summit is growing fast.", "Any news?", named, index)).toBe("company-name word");
  });

  it("a number the facts spell out may be written as digits; any other number is still dropped", () => {
    const answer = shown(
      "maple",
      "Maple Family Dentistry",
      "Careers page lists hygienist openings at two locations.",
      "Lease filing shows a fourth office under construction."
    );
    expect(checkOpening("This company is hiring hygienists at 2 locations.", "Are they hiring?", answer, index)).toBe(
      "This company is hiring hygienists at 2 locations."
    );
    expect(checkOpening("A 4th office is under construction.", "Are they hiring?", answer, index)).toBe(
      "A 4th office is under construction."
    );
    expect(openingRejection("This company is hiring at 3 locations.", "Are they hiring?", answer, index)).toBe(
      "number not shown"
    );
    expect(
      checkOpening("This company standardized on SlotEasy 18 months ago.", "Any risks?", NORTHVIEW_RISKS, index)
    ).toBe("This company standardized on SlotEasy 18 months ago.");
  });

  it("says which check dropped a sentence; null when it passes", () => {
    const question = "Any risks?";
    expect(openingRejection("", question, NORTHVIEW_RISKS, index)).toBe("empty");
    expect(openingRejection(`${"Here's what's on record. ".repeat(10)}`, question, NORTHVIEW_RISKS, index)).toBe("too long");
    expect(openingRejection("Here's what's on record. Take a look.", question, NORTHVIEW_RISKS, index)).toBe(
      "more than one sentence"
    );
    expect(openingRejection("Here's what's on record for Company 1.", question, NORTHVIEW_RISKS, index)).toBe(
      "ref or placeholder"
    );
    expect(openingRejection("It looks like a good fit.", question, NORTHVIEW_RISKS, index)).toBe("judgment");
    expect(openingRejection("Here's what's on record for Falcon Market.", question, NORTHVIEW_RISKS, index)).toBe(
      "company name"
    );
    expect(openingRejection("Here's what's on record for your question.", question, NORTHVIEW_RISKS, index)).toBeNull();
  });

  it("the call is told the question's topic; the prompt says to restate the facts and lead with a concern", () => {
    expect(buildOpeningMessages("Any risks?", NORTHVIEW_RISKS, index, "risks")[1]?.content).toBe(
      ["Question: Any risks?", "Topic: risks", "", "Answer:", "Company 1", ...NORTHVIEW_RISKS.items[0]!.text.split("\n")].join(
        "\n"
      )
    );
    expect(buildOpeningMessages("Any risks?", NORTHVIEW_RISKS, index, null)[1]?.content.startsWith("Question: Any risks?\n\nAnswer:")).toBe(
      true
    );
    for (const line of [
      '- Only say what the facts shown say, in their own words where you can. Never add an action, change, timing or judgment the facts don\'t state (for example "updated", "launched", "recently", "new", "positive" or "strong").',
      '- Lead with the fact that most directly answers the question. When the "Topic:" line says risks, fit or budget, lead with a concern if the answer shows one (an existing contract or vendor, a freeze, a mandate, or something not being what it seems). Never describe a concern as a positive.',
    ]) {
      expect(OPENING_SYSTEM_PROMPT, line).toContain(line);
    }
  });
});

describe("a follow-up that brings back nothing new", () => {
  const answer: ScopedAnswer = {
    intro: "",
    items: [{ companyId: "canyon", companyName: "Canyon Aesthetics", text: "Job listing: Spa Attendant" }],
  };
  const shownBefore = new Map([["canyon", new Set(["Job listing: Spa Attendant"])]]);

  it("the same lines again: the fixed first line (so no opening)", () => {
    const again = withNothingNewIntro(answer, shownBefore);
    expect(again).toEqual({ ...answer, intro: FOLLOW_UP_NOTHING_NEW_INTRO });
    expect(FOLLOW_UP_NOTHING_NEW_INTRO).toBe("That's everything publicly findable on this.");
    expect(needsOpening(again)).toBe(false);
  });

  it("a new line, another company's lines, or no facts: unchanged", () => {
    const more = { ...answer, items: [{ ...answer.items[0]!, text: "Job listing: Spa Attendant\nCareers page lists a guest coordinator role" }] };
    expect(withNothingNewIntro(more, shownBefore)).toEqual(more);
    expect(withNothingNewIntro(answer, new Map([["maple", new Set(["Job listing: Spa Attendant"])]]))).toEqual(answer);
    expect(withNothingNewIntro(answer, new Map())).toEqual(answer);
    const nothing = { intro: "", items: [{ ...answer.items[0]!, text: NOTHING_FINDABLE_REPLY }] };
    expect(withNothingNewIntro(nothing, new Map([["canyon", new Set([NOTHING_FINDABLE_REPLY])]]))).toEqual(nothing);
  });
});

describe("findings that don't directly answer (part 3)", () => {
  const findings: ScopedAnswer = {
    intro: "",
    items: [{ companyId: "canyon", companyName: "Canyon Aesthetics", text: "Website FAQ notes online intake forms for first-time clients." }],
  };

  it("the selection's 'no fact answers' reply is exactly {fact_ids: [], exact_answer: false}; anything else is not", () => {
    expect(isNoFactAnswersReply(JSON.stringify({ fact_ids: [], exact_answer: false }))).toBe(true);
    for (const raw of [
      JSON.stringify({ fact_ids: [], exact_answer: true }),
      JSON.stringify({ fact_ids: [] }),
      JSON.stringify({ fact_ids: [], exact_answer: "false" }),
      JSON.stringify({ fact_ids: ["C1:h:0"], exact_answer: false }),
      JSON.stringify({ fact_ids: ["C9:p:invented"], exact_answer: false }),
      JSON.stringify({ exact_answer: false }),
      JSON.stringify([]),
      "not json",
      "",
      null,
      undefined,
    ]) {
      expect(isNoFactAnswersReply(raw), String(raw)).toBe(false);
    }
  });

  it("the honest first line goes above the same facts (nothing removed or reordered), so no opening", () => {
    const related = withRelatedFindingsIntro(findings);
    expect(related).toEqual({ ...findings, intro: RELATED_FINDINGS_INTRO });
    expect(RELATED_FINDINGS_INTRO).toBe("Nothing specific on that is publicly findable. Related findings:");
    expect(needsOpening(related)).toBe(false);
  });

  it("an answer with no facts keeps the nothing-findable reply", () => {
    for (const answer of [
      { intro: NOTHING_FINDABLE_REPLY, items: [] },
      { intro: "", items: [{ companyId: "a", companyName: "A", text: NOTHING_FINDABLE_REPLY }] },
    ]) {
      expect(withRelatedFindingsIntro(answer)).toEqual(answer);
    }
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

  it("an exact thing that isn't stated: exact_answer false and only genuinely related facts, never loosely related ones", () => {
    expect(SELECTION_SYSTEM_PROMPT).toContain(
      "- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and choose only facts genuinely related to it (about the same subject); if none are, return no facts rather than loosely related ones."
    );
  });

  it("only facts that actually answer the question; a fact about a different subject never does, and none is fine", () => {
    expect(SELECTION_SYSTEM_PROMPT).toContain(
      "- Choose a fact only if it actually answers the question. A fact about a different subject never answers it, even when it is the only fact listed for a company; returning no facts is fine."
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
