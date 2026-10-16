/**
 * data-room-chat-scope.test.ts
 * Data Room assistant scope helpers: generic words derived from the roster,
 * type-to-pick suggestions, company detection, scope priority on send, the
 * out-of-scope mention reply, and the empty-answer check.
 * Fixture roster uses names from the directory generator's real name pools.
 */

import { describe, expect, it } from "vitest";
import {
  buildGenericWords,
  buildOutOfScopeMessage,
  buildRefLabels,
  buildScopeIndex,
  detectCompanies,
  finalizeModelAnswer,
  findCompanyNameMentions,
  findOutOfScopeMentions,
  answerNameQuery,
  insertPickedName,
  isEmptyModelAnswer,
  mentionsInternalLabels,
  parseChatScope,
  parseModelAnswer,
  parseNameQuery,
  previewScope,
  redactCompanyMentions,
  resolveSendScope,
  scopesEqual,
  SCOPE_NONE_MESSAGE,
  SCOPE_TOO_MANY_MESSAGE,
  selectHistoryForScope,
  suggestCompanies,
  textContainsCompanyName,
  wordFragmentBeforeCaret,
  type ChatScope,
  type HistoryEntry,
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

describe("scope on send (priority 1–5)", () => {
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

  describe("follow-ups (the previous question's companies)", () => {
    const askedAboutFalcon = {
      scope: { mode: "companies" as const, companyIds: ["falcon"] },
      openCompanyId: "maple",
    };

    it("a follow-up with no name reuses the last scope (one company, or the same 2–3)", () => {
      expect(resolveSendScope({ ...base, lastQuestion: askedAboutFalcon })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["falcon"] },
      });
      const twoCompanies = {
        scope: { mode: "companies" as const, companyIds: ["falcon", "evergreen"] },
        openCompanyId: "maple",
      };
      expect(resolveSendScope({ ...base, lastQuestion: twoCompanies })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["falcon", "evergreen"] },
      });
    });

    it("opening a different company since the last question resets to the open company", () => {
      expect(resolveSendScope({ ...base, openCompanyId: "cedar", lastQuestion: askedAboutFalcon })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["cedar"] },
      });
    });

    it("All companies and named or picked companies still override", () => {
      expect(resolveSendScope({ ...base, allCompanies: true, lastQuestion: askedAboutFalcon })).toEqual({
        kind: "send",
        scope: { mode: "all" },
      });
      expect(resolveSendScope({ ...base, text: "and Bison?", lastQuestion: askedAboutFalcon })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["bison"] },
      });
      expect(
        resolveSendScope({ ...base, text: "Oasis Supply Co.?", pickedIds: ["oasis"], lastQuestion: askedAboutFalcon })
      ).toEqual({ kind: "send", scope: { mode: "companies", companyIds: ["oasis"] } });
    });

    it("no previous question → the open company; a previous All-companies question isn't reused", () => {
      expect(resolveSendScope({ ...base, lastQuestion: null })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["maple"] },
      });
      expect(
        resolveSendScope({ ...base, lastQuestion: { scope: { mode: "all" }, openCompanyId: "maple" } })
      ).toEqual({ kind: "send", scope: { mode: "companies", companyIds: ["maple"] } });
    });

    it("with no company open, the last scope is reused instead of the 'open a company' error", () => {
      expect(
        resolveSendScope({ ...base, openCompanyId: null, lastQuestion: { ...askedAboutFalcon, openCompanyId: null } })
      ).toEqual({ kind: "send", scope: { mode: "companies", companyIds: ["falcon"] } });
    });

    it("live repro: open A, ask about B by one unique word, then 'tell me about them' → B", () => {
      const liveIndex = buildScopeIndex([
        { id: "echo-fitness", name: "Echo Fitness", industry: "Fitness Studio" },
        { id: "echo-attorneys", name: "Echo Attorneys", industry: "Legal Services" },
        { id: "cascade", name: "Cascade Hospitality", industry: "Hospitality" },
        { id: "summit-dental", name: "Summit Dental Group", industry: "Dental" },
      ]);
      const open = { index: liveIndex, allCompanies: false, pickedIds: [], openCompanyId: "echo-fitness" };

      const first = resolveSendScope({ ...open, text: "how many locations does cascade have?", lastQuestion: null });
      expect(first).toEqual({ kind: "send", scope: { mode: "companies", companyIds: ["cascade"] } });
      if (first.kind !== "send") {
        return;
      }
      // What the chat records for every sent question: the resolved scope + the open company.
      const lastQuestion = { scope: first.scope, openCompanyId: open.openCompanyId };

      // "Current:" shows B before the second send…
      expect(previewScope({ ...open, text: "tell me about them", lastQuestion })).toEqual({
        kind: "companies",
        companies: [liveIndex.byId.get("cascade")],
      });
      // …and the follow-up is sent about B, not the open company.
      expect(resolveSendScope({ ...open, text: "tell me about them", lastQuestion })).toEqual({
        kind: "send",
        scope: { mode: "companies", companyIds: ["cascade"] },
      });
    });

    it("the live preview shows the same follow-up company", () => {
      expect(previewScope({ ...base, lastQuestion: askedAboutFalcon })).toEqual({
        kind: "companies",
        companies: [ROSTER[6]],
      });
      expect(previewScope({ ...base, openCompanyId: "cedar", lastQuestion: askedAboutFalcon })).toEqual({
        kind: "companies",
        companies: [ROSTER[2]],
      });
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

describe("server helpers", () => {
  it("parses a scope: all, or 1–3 distinct company ids", () => {
    expect(parseChatScope({ mode: "all" })).toEqual({ mode: "all" });
    expect(parseChatScope({ mode: "companies", companyIds: ["a", "a", "b"] })).toEqual({
      mode: "companies",
      companyIds: ["a", "b"],
    });
    expect(parseChatScope({ mode: "companies", companyIds: [] })).toBeNull();
    expect(parseChatScope({ mode: "companies", companyIds: ["a", "b", "c", "d"] })).toBeNull();
    expect(parseChatScope({ mode: "companies", companyIds: ["a", 7] })).toBeNull();
    expect(parseChatScope({ companyIds: ["a"] })).toBeNull();
  });

  it("guard: finds full names and identifying first words; ordinary words pass", () => {
    expect(findCompanyNameMentions("Summit Dental Group is busy.", index)).toEqual(["Summit Dental Group"]);
    expect(findCompanyNameMentions("Unlike falcon, the company is busy.", index)).toEqual(["falcon"]);
    expect(
      findCompanyNameMentions("The company has a market, a vision for growth and a center.", index)
    ).toEqual([]);
  });

  it("redacts full names first, then listed first words", () => {
    expect(
      redactCompanyMentions(
        "Summit Dental Group vs falcon market; Summit grew.",
        index,
        (id) => (id === "summit-dental" ? "[C1]" : "another company"),
        [{ word: "Summit", replacement: "the company", caseSensitive: true }]
      )
    ).toBe("[C1] vs another company; the company grew.");
  });

  it("parses the model JSON and maps refs to roster names", () => {
    expect(parseModelAnswer("not json")).toBeNull();
    expect(parseModelAnswer(JSON.stringify({ intro: "x", items: "nope" }))).toBeNull();
    const answer = parseModelAnswer(
      JSON.stringify({ items: [{ ref: "[c2]", text: "Busy, like the company." }, { ref: "C9", text: "x" }] })
    );
    expect(answer).toEqual({
      intro: "",
      items: [{ ref: "[c2]", text: "Busy, like the company." }, { ref: "C9", text: "x" }],
    });
    expect(finalizeModelAnswer(answer!, buildRefLabels(["falcon", "oasis"]), index)).toEqual({
      intro: "",
      items: [{ companyId: "oasis", companyName: "Oasis Supply Co.", text: "Busy, like the company." }],
    });
  });

  it("guard: a ref (C1) or the words references/labels in the reply reject it", () => {
    const labels = buildRefLabels(["falcon"]);
    const finalize = (raw: unknown): unknown =>
      finalizeModelAnswer(parseModelAnswer(JSON.stringify(raw))!, labels, index);
    expect(finalize({ intro: "", items: [{ ref: "C1", text: "Busy, like C1." }] })).toBeNull();
    expect(finalize({ intro: "All references start with 'C'.", items: [] })).toBeNull();
    expect(finalize({ intro: "", items: [{ ref: "C1", text: "Each company has a label such as [C2]." }] })).toBeNull();
    expect(finalize({ intro: "I only see reference codes.", items: [] })).toBeNull();
    expect(finalize({ intro: "", items: [{ ref: "C1", text: "It sells local produce." }] })).toEqual({
      intro: "",
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "It sells local produce." }],
    });
    expect(mentionsInternalLabels("Open 7 days, with C-section care.")).toBe(false);
  });

  it("an empty answer: no items and a blank intro, or every item dropped", () => {
    const labels = buildRefLabels(["falcon"]);
    const check = (raw: unknown): boolean => {
      const parsed = parseModelAnswer(JSON.stringify(raw));
      return isEmptyModelAnswer(parsed!, finalizeModelAnswer(parsed!, labels, index)!);
    };
    expect(check({ intro: "", items: [] })).toBe(true);
    expect(check({ intro: "Here is what I found.", items: [{ ref: "C9", text: "x" }] })).toBe(true);
    expect(check({ intro: "", items: [{ ref: "C1", text: "   " }] })).toBe(true);
    expect(check({ intro: "I can't rank these companies.", items: [] })).toBe(false);
    expect(check({ intro: "", items: [{ ref: "C1", text: "It sells produce." }] })).toBe(false);
  });

  describe("history across scopes (last 10)", () => {
    const one = { mode: "companies" as const, companyIds: ["falcon"] };
    const other = { mode: "companies" as const, companyIds: ["oasis"] };
    const question = (content: string, scope: ChatScope): HistoryEntry => ({ role: "user", content, scope });
    const answer = (text: string, scope: ChatScope, companyId: string): HistoryEntry => ({
      role: "assistant",
      intro: "",
      items: [{ companyId, text }],
      scope,
    });

    it("same-scope pairs are kept; another scope's answer is dropped and its question kept", () => {
      const history = [
        question("q-falcon", one),
        answer("a-falcon", one, "falcon"),
        question("q-oasis", other),
        answer("a-oasis", other, "oasis"),
        question("q-all", { mode: "all" }),
        { role: "assistant" as const, intro: "a-all", items: [], scope: { mode: "all" as const } },
      ];
      expect(selectHistoryForScope(history, one)).toEqual([
        question("q-falcon", one),
        answer("a-falcon", one, "falcon"),
        question("q-oasis", other),
        question("q-all", { mode: "all" }),
      ]);
    });

    it("looks at the last 10 messages only, whatever their scope", () => {
      const history: HistoryEntry[] = Array.from({ length: 14 }, (_, i) =>
        i % 2 === 0 ? question(`q${i}`, one) : answer(`a${i}`, other, "oasis")
      );
      const kept = selectHistoryForScope(history, one);
      // Entries 4–13 are the last 10: five same-scope questions, five other-scope answers (dropped).
      expect(kept.map((entry) => (entry.role === "user" ? entry.content : ""))).toEqual([
        "q4",
        "q6",
        "q8",
        "q10",
        "q12",
      ]);
      expect(selectHistoryForScope(Array.from({ length: 14 }, (_, i) => question(`q${i}`, one)), one)).toHaveLength(
        10
      );
    });
  });
});

describe("out-of-scope mentions", () => {
  it("finds an unselected company by full name or identifying first word", () => {
    expect(
      findOutOfScopeMentions(index, "How does Summit Dental Group compare to Falcon Market?", ["summit-dental"])
    ).toEqual({ companies: [ROSTER.find((c) => c.id === "falcon")], isEitherOr: false });
    expect(names(findOutOfScopeMentions(index, "Is oasis busier?", ["falcon"])?.companies ?? [])).toEqual([
      "Oasis Supply Co.",
    ]);
  });

  it("selected companies, a first word shared with a selected company, and generic words don't count", () => {
    expect(findOutOfScopeMentions(index, "Summit Dental Group vs falcon?", ["summit-dental", "falcon"])).toBeNull();
    expect(findOutOfScopeMentions(index, "What does Summit do?", ["summit-dental"])).toBeNull();
    expect(findOutOfScopeMentions(index, "Is the family dentistry group busy?", ["falcon"])).toBeNull();
  });

  it("a first word shared by two unselected companies names both as alternatives", () => {
    const mention = findOutOfScopeMentions(index, "And juniper?", ["falcon"]);
    expect(mention?.isEitherOr).toBe(true);
    expect(buildOutOfScopeMessage(mention!)).toBe(
      "Your question mentions Juniper Eye Care or Juniper Ridge Vision Group, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it."
    );
  });

  it("builds the fixed reply with names from the roster", () => {
    const falcon = ROSTER.find((c) => c.id === "falcon")!;
    const oasis = ROSTER.find((c) => c.id === "oasis")!;
    expect(buildOutOfScopeMessage({ companies: [falcon], isEitherOr: false })).toBe(
      "Your question mentions Falcon Market, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it."
    );
    expect(buildOutOfScopeMessage({ companies: [falcon, oasis], isEitherOr: false })).toBe(
      "Your question mentions Falcon Market and Oasis Supply Co., which aren't selected. Type their names and press Enter, or open them from the list, and I'll answer about them."
    );
  });
});

describe("questions about company names", () => {
  it("recognizes starts-with, contains / called, and list questions", () => {
    expect(parseNameQuery("tell me about companies starting with s")).toEqual({ kind: "startsWith", value: "s" });
    expect(parseNameQuery("what are that start with c")).toEqual({ kind: "startsWith", value: "c" });
    expect(parseNameQuery("Which companies begin with the letter M?")).toEqual({ kind: "startsWith", value: "M" });
    expect(parseNameQuery('Which ones start with "Sum"?')).toEqual({ kind: "startsWith", value: "Sum" });
    expect(parseNameQuery("Show names containing care")).toEqual({ kind: "contains", value: "care" });
    expect(parseNameQuery("companies with dental in their name")).toEqual({ kind: "contains", value: "dental" });
    expect(parseNameQuery("Is there a company called Falcon?")).toEqual({ kind: "contains", value: "Falcon" });
    expect(parseNameQuery("Any business named 'Oasis Supply'?")).toEqual({ kind: "contains", value: "Oasis Supply" });
    expect(parseNameQuery("List all company names")).toEqual({ kind: "list", value: "" });
    expect(parseNameQuery("what are the names of the companies?")).toEqual({ kind: "list", value: "" });
    expect(parseNameQuery("list all companies")).toEqual({ kind: "list", value: "" });
  });

  it("starts-with and contains beat a list; typo'd verbs count", () => {
    expect(parseNameQuery("what is names of companies startign with S")).toEqual({ kind: "startsWith", value: "S" });
    expect(parseNameQuery("names of companies starting with B")).toEqual({ kind: "startsWith", value: "B" });
    expect(parseNameQuery("list the companies whose names begining with t")).toEqual({ kind: "startsWith", value: "t" });
    expect(parseNameQuery("which ones statring with c")).toEqual({ kind: "startsWith", value: "c" });
    expect(parseNameQuery("list company names containing dental")).toEqual({ kind: "contains", value: "dental" });
  });

  it("leaves ordinary questions alone", () => {
    for (const text of [
      "Are they staffed with nurses?",
      "Does the clinic stay with its current vendor?",
      "tell me about them",
      "Tell me about this company.",
      "What do they start with on Mondays?",
      "Does the program start with a free trial?",
      "Who should I start with?",
      "Who is the named contact?",
      "What's the name of this company?",
      "Spell out the company's full name.",
      "List each company's number of locations.",
      "List all of the hidden research findings.",
      "Which companies are in Colorado?",
      "Compare these companies.",
    ]) {
      expect(parseNameQuery(text), text).toBeNull();
    }
  });

  const roster = [
    { id: "summit-dental", name: "Summit Dental Group", industry: "Dental", locations: 8, metro: "Front Range, CO" },
    { id: "summit-outdoor", name: "Summit Outdoor Gear", industry: "Retail", locations: 1, metro: "Boise, ID" },
    { id: "falcon", name: "Falcon Market", industry: "Retail", locations: null, metro: null },
    { id: "sage", name: "Sage Family Dentistry", industry: "Dental", locations: 3, metro: "Denver, CO" },
  ];

  it("answers from the roster: A–Z, with industry · locations · metro", () => {
    expect(answerNameQuery({ kind: "startsWith", value: "s" }, roster)).toEqual({
      intro: 'Companies whose names start with "S":',
      items: [
        { companyId: "sage", companyName: "Sage Family Dentistry", text: "Dental · 3 locations · Denver, CO" },
        { companyId: "summit-dental", companyName: "Summit Dental Group", text: "Dental · 8 locations · Front Range, CO" },
        { companyId: "summit-outdoor", companyName: "Summit Outdoor Gear", text: "Retail · 1 location · Boise, ID" },
      ],
    });
    expect(answerNameQuery({ kind: "contains", value: "market" }, roster)).toEqual({
      intro: 'Companies whose names contain "market":',
      items: [{ companyId: "falcon", companyName: "Falcon Market", text: "Retail" }],
    });
    expect(answerNameQuery({ kind: "startsWith", value: "z" }, roster)).toEqual({
      intro: 'No company names start with "Z".',
      items: [],
    });
  });

  it("lists at most 15 and points to the search box for the rest", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      name: `Cedar ${String(i).padStart(2, "0")}`,
      industry: "Dental",
      locations: 2,
      metro: "Denver, CO",
    }));
    const reply = answerNameQuery({ kind: "startsWith", value: "c" }, many);
    expect(reply.items).toHaveLength(15);
    expect(reply.items[0]?.companyName).toBe("Cedar 00");
    expect(reply.intro).toBe(
      'Companies whose names start with "C" (the first 15, A–Z), and 5 more. Use the search box above the list to see them all.'
    );
  });
});
