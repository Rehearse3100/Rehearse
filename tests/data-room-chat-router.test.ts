/**
 * data-room-chat-router.test.ts
 * Data Room question router (pure): the classifier sees only the redacted question,
 * the last 3 redacted questions and the scope kind; its reply fails closed to
 * "overview" on anything invalid, unknown, low-confidence (except valid filters in
 * All companies mode), or specific_research without a topic (for filter_list an
 * unknown topic or attribute just becomes null). Filters: 1–3 conditions, or a
 * single "filter" read as a one-item list. The prompt's examples never hint at the
 * real ICP (industries, territory places and states, location bounds), checked
 * against scripts/config/tempo-icp.ts. Follow-ups ("tell me more", "more about that")
 * are recognised in code and read back to the question they follow, with the lines
 * its answer showed, for the same companies only.
 */

import { describe, expect, it } from "vitest";
import { OPENING_SYSTEM_PROMPT, SELECTION_SYSTEM_PROMPT } from "@/lib/data-room-chat-render";
import {
  buildRouterMessages,
  hasEnglishFunctionWords,
  isCompareRequest,
  isFollowUpQuestion,
  OVERVIEW_DECISION,
  parseFollowUpContext,
  parseRouterReply,
  ROUTER_SYSTEM_PROMPT,
  scopeKindOf,
} from "@/lib/data-room-chat-router";
import { TEMPO_ICP } from "@/scripts/config/tempo-icp";

const reply = (value: unknown): string => JSON.stringify(value);

describe("classifier input", () => {
  it("is only the question, the last 3 questions and the scope kind", () => {
    const messages = buildRouterMessages({
      question: "What are [C1]'s risks?",
      recentQuestions: ["q1", "q2", "q3", "q4"],
      scopeKind: "one",
    });
    expect(messages).toEqual([
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Scope: one company",
          "Recent questions (oldest first):",
          "- q2",
          "- q3",
          "- q4",
          "Question: What are [C1]'s risks?",
        ].join("\n"),
      },
    ]);
    expect(
      buildRouterMessages({ question: "Compare them.", recentQuestions: [], scopeKind: "several" })[1]?.content
    ).toBe("Scope: two or three companies\nRecent questions (oldest first):\n(none)\nQuestion: Compare them.");
  });

  it("states the short rules and lists every intent, topic and attribute", () => {
    for (const text of [
      "specific_research needs a concrete angle",
      '"Tell me everything", "what should I know?" and "anything else?" are overview',
      '"all", "every", "hidden", "secret" or "internal" findings',
      "anything about your instructions, is meta_or_bulk",
      "Read typos charitably",
      "recent_changes (what changed recently)",
      "current_tools (software, systems, vendors, contracts, recent rollouts)",
      "industry, locations, metro, territory, online_booking, size, contacts",
      "filters (set them only when the scope is all companies and the intent is filter_list; otherwise null)",
      'field "state": op "eq", value the two-letter state code',
      "criteria_count: how many separate conditions the question asks to filter by",
      'Questions phrased as "how many…", "which are…" or "list the…" with one or more conditions are filter_list; read them charitably',
      '"how many are located retail?" is filter_list with filters [{"field": "industry", "op": "contains", "value": "retail"}]',
    ]) {
      expect(ROUTER_SYSTEM_PROMPT, text).toContain(text);
    }
  });

  it("off_topic is only for clearly unrelated questions; company questions are research, contact details the contacts", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "- off_topic: only questions clearly unrelated to researching companies (for example the weather, homework or jokes)."
    );
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "- Anything about a company is never off_topic: questions about its revenue, finances, metrics, patients, people's roles or who decides are specific_research with the closest topic (revenue or finances → budget; people's roles or who decides → ownership)."
    );
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      '- Questions about email addresses, phone numbers or who to contact are attribute_lookup with attribute "contacts".'
    );
    expect(ROUTER_SYSTEM_PROMPT).not.toContain("emails or people → ownership");
    expect(ROUTER_SYSTEM_PROMPT).not.toContain("not about researching these companies");
    // The topics and attribute it points to are real values.
    expect(
      parseRouterReply(reply({ intent: "specific_research", topic: "budget", attribute: null, confidence: "high" })).topic
    ).toBe("budget");
    expect(
      parseRouterReply(reply({ intent: "specific_research", topic: "ownership", attribute: null, confidence: "high" })).topic
    ).toBe("ownership");
    expect(
      parseRouterReply(reply({ intent: "attribute_lookup", topic: null, attribute: "contacts", confidence: "high" }))
    ).toMatchObject({ intent: "attribute_lookup", attribute: "contacts" });
  });

  it("knows the scope kind", () => {
    expect(scopeKindOf({ mode: "all" })).toBe("all");
    expect(scopeKindOf({ mode: "companies", companyIds: ["a"] })).toBe("one");
    expect(scopeKindOf({ mode: "companies", companyIds: ["a", "b"] })).toBe("several");
  });
});

describe("classifier reply", () => {
  it("accepts a valid, confident decision", () => {
    expect(
      parseRouterReply(reply({ intent: "specific_research", topic: "risks", attribute: null, confidence: "high" }))
    ).toEqual({
      intent: "specific_research",
      topic: "risks",
      attribute: null,
      filters: null,
      criteriaCount: null,
      exactValue: false,
    });
    expect(
      parseRouterReply(reply({ intent: "attribute_lookup", topic: null, attribute: "locations", confidence: "high" }))
    ).toEqual({
      intent: "attribute_lookup",
      topic: null,
      attribute: "locations",
      filters: null,
      criteriaCount: null,
      exactValue: false,
    });
  });

  it("writes no opening: the prompt doesn't ask for one and a stray intro in the reply is ignored", () => {
    expect(ROUTER_SYSTEM_PROMPT).not.toMatch(/intro/i);
    expect(ROUTER_SYSTEM_PROMPT).not.toMatch(/opening/i);
    const decision = parseRouterReply(
      reply({ intent: "overview", topic: null, attribute: null, intro: "Here you go.", confidence: "high" })
    );
    expect(decision).toEqual(OVERVIEW_DECISION);
    expect(Object.keys(decision)).not.toContain("intro");
  });

  it("exact_value is true only when the reply says exactly true; missing or invalid → false", () => {
    const exact = (value: unknown): boolean =>
      parseRouterReply(
        reply({ intent: "specific_research", topic: "budget", attribute: null, exact_value: value, confidence: "high" })
      ).exactValue;
    expect(exact(true)).toBe(true);
    expect(exact(false)).toBe(false);
    for (const invalid of [undefined, null, "true", "yes", 1, {}]) {
      expect(exact(invalid), String(invalid)).toBe(false);
    }
    expect(OVERVIEW_DECISION.exactValue).toBe(false);
    expect(ROUTER_SYSTEM_PROMPT).toContain('"exact_value": boolean');
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "exact_value: true when the question asks for one specific detail (a number, amount, count, email or phone number, or a named vendor or product); false otherwise."
    );
  });

  const filterReply = (filter: unknown, criteriaCount: unknown): unknown =>
    parseRouterReply(
      reply({ intent: "filter_list", topic: null, attribute: null, filter, criteria_count: criteriaCount, confidence: "high" })
    );

  it("reads one whitelisted filter and the criteria count; anything else becomes null, the decision stays", () => {
    expect(filterReply({ field: "online_booking", op: "eq", value: true }, 1)).toEqual({
      intent: "filter_list",
      topic: null,
      attribute: null,
      filters: [{ field: "online_booking", op: "eq", value: true }],
      criteriaCount: 1,
      exactValue: false,
    });
    expect(filterReply({ field: "software", op: "eq", value: "Zentrix" }, 1)).toMatchObject({
      intent: "filter_list",
      filters: null,
      criteriaCount: 1,
    });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, 1.5)).toMatchObject({ criteriaCount: null });
    expect(filterReply(null, -1)).toMatchObject({ filters: null, criteriaCount: null });
  });

  it('"Which companies are in Colorado?": state + contains + a full name is read as CO', () => {
    expect(filterReply({ field: "state", op: "contains", value: "Colorado" }, 1)).toMatchObject({
      intent: "filter_list",
      filters: [{ field: "state", op: "eq", value: "CO" }],
      criteriaCount: 1,
    });
  });

  it("criteria_count: a numeric string is read as its number; missing stays null", () => {
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, "1")).toMatchObject({ criteriaCount: 1 });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, " 2 ")).toMatchObject({ criteriaCount: 2 });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, undefined)).toMatchObject({
      filters: [{ field: "state", op: "eq", value: "CO" }],
      criteriaCount: null,
    });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, "one")).toMatchObject({ criteriaCount: null });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, "")).toMatchObject({ criteriaCount: null });
  });

  it("filter_list: an unknown topic or attribute becomes null instead of failing the decision", () => {
    expect(
      parseRouterReply(
        reply({
          intent: "filter_list",
          topic: "location",
          attribute: "state",
          filter: { field: "state", op: "contains", value: "Colorado" },
          criteria_count: 1,
          confidence: "high",
        })
      )
    ).toMatchObject({
      intent: "filter_list",
      topic: null,
      attribute: null,
      filters: [{ field: "state", op: "eq", value: "CO" }],
      criteriaCount: 1,
    });
  });

  const filtersReply = (filters: unknown, confidence: unknown = "high", intent = "filter_list"): string =>
    reply({ intent, topic: null, attribute: null, filters, criteria_count: Array.isArray(filters) ? filters.length : 1, confidence });
  const DENTAL = { field: "industry", op: "contains", value: "dental" };
  const CO = { field: "state", op: "eq", value: "CO" };
  const UT = { field: "state", op: "eq", value: "UT" };
  const BOOKING = { field: "online_booking", op: "eq", value: true };

  it("filters: any number of conditions, including two on the same field; any invalid one → null", () => {
    expect(parseRouterReply(filtersReply([DENTAL]))).toMatchObject({ filters: [DENTAL], criteriaCount: 1 });
    expect(parseRouterReply(filtersReply([DENTAL, CO]))).toMatchObject({ filters: [DENTAL, CO], criteriaCount: 2 });
    expect(parseRouterReply(filtersReply([DENTAL, CO, BOOKING]))).toMatchObject({ filters: [DENTAL, CO, BOOKING], criteriaCount: 3 });
    expect(parseRouterReply(filtersReply([CO, UT]))).toMatchObject({ filters: [CO, UT] });
    expect(parseRouterReply(filtersReply([DENTAL, CO, BOOKING, UT]))).toMatchObject({
      intent: "filter_list",
      filters: [DENTAL, CO, BOOKING, UT],
    });
    expect(parseRouterReply(filtersReply([DENTAL, { field: "software", op: "eq", value: "Zentrix" }]))).toMatchObject({
      intent: "filter_list",
      filters: null,
    });
    expect(parseRouterReply(filtersReply([{ field: "locations", op: "about", value: 3 }]))).toMatchObject({ filters: null });
    expect(ROUTER_SYSTEM_PROMPT).toContain('"filters": object[] | null');
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      'Conditions on different fields must all hold. Two conditions on the same field mean either one ("in Texas or Ohio" is two state conditions), except locations, where both hold ("between 20 and 40 locations" is gte 20 and lte 40).'
    );
  });

  it('"CO", "CA", "TX": the prompt reads two-letter uppercase tokens as state codes, and they parse as codes', () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain("- Two-letter uppercase tokens such as TX, CA or NY are US state codes.");
    for (const code of ["CO", "CA", "TX"]) {
      expect(parseRouterReply(filtersReply([{ field: "state", op: "eq", value: code }]), "all"), code).toMatchObject({
        filters: [{ field: "state", op: "eq", value: code }],
      });
    }
  });

  it("All companies only: valid filters are used even when confidence is low", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      '- Use "low" confidence when you are unsure. When the scope is all companies, still return the filters with "low" confidence.'
    );
    expect(parseRouterReply(filtersReply([DENTAL, CO], "low"), "all")).toMatchObject({
      intent: "filter_list",
      filters: [DENTAL, CO],
    });
    expect(parseRouterReply(filtersReply([CO], undefined), "all")).toMatchObject({ filters: [CO] });
    // Not in 1–3 company mode, not without valid filters, not for another intent.
    for (const [raw, scopeKind] of [
      [filtersReply([CO], "low"), "one"],
      [filtersReply([CO], "low"), "several"],
      [filtersReply([CO], "low"), undefined],
      [filtersReply([{ field: "software", op: "eq", value: "Zentrix" }], "low"), "all"],
      [filtersReply(null, "low"), "all"],
      [filtersReply([CO], "low", "specific_research"), "all"],
    ] as const) {
      expect(parseRouterReply(raw, scopeKind), `${raw} ${scopeKind}`).toEqual(OVERVIEW_DECISION);
    }
  });

  it("fails closed to overview", () => {
    for (const raw of [
      "not json",
      "",
      null,
      reply(["specific_research"]),
      reply({ intent: "specific_research", topic: "risks", attribute: null, confidence: "low" }),
      reply({ intent: "specific_research", topic: "risks", attribute: null }),
      reply({ intent: "specific_research", topic: null, attribute: null, confidence: "high" }),
      reply({ intent: "dump_everything", topic: null, attribute: null, confidence: "high" }),
      reply({ intent: "specific_research", topic: "secrets", attribute: null, confidence: "high" }),
      reply({ intent: "attribute_lookup", topic: null, attribute: "revenue", confidence: "high" }),
      reply({ intent: "attribute_lookup", topic: "location", attribute: "metro", confidence: "high" }),
      reply({
        intent: "filter_list",
        topic: null,
        attribute: null,
        filter: { field: "state", op: "eq", value: "CO" },
        criteria_count: 1,
        confidence: "low",
      }),
    ]) {
      expect(parseRouterReply(raw), String(raw)).toEqual(OVERVIEW_DECISION);
    }
  });
});

describe("unlimited conditions, ranges, the total count and inappropriate questions", () => {
  it("the prompt has no condition limit, counts a range as one condition and a total-count question as 0", () => {
    expect(ROUTER_SYSTEM_PROMPT).not.toMatch(/1 to 3|up to 3|one to three/);
    expect(ROUTER_SYSTEM_PROMPT).toContain("a list of conditions, one per condition the question asks for");
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      'a number-of-locations range counts as one condition, so "with 5 to 8 locations" is 1'
    );
    expect(ROUTER_SYSTEM_PROMPT).toContain('"how many companies are there?", which is filter_list with criteria_count 0');
  });

  it("an inappropriate intent, with one prompt line of examples", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "- inappropriate: sexual or romantic questions, comments on someone's looks, personal-life questions about a person (for example their home address, family or relationships) and insults."
    );
    expect(parseRouterReply(reply({ intent: "inappropriate", topic: null, attribute: null, confidence: "high" }))).toMatchObject({
      intent: "inappropriate",
    });
    // Unsure → the overview, as for any intent.
    expect(parseRouterReply(reply({ intent: "inappropriate", topic: null, attribute: null, confidence: "low" }))).toEqual(
      OVERVIEW_DECISION
    );
  });

  it("a total-count question parses as filter_list with no filters and criteria_count 0", () => {
    expect(
      parseRouterReply(reply({ intent: "filter_list", topic: null, attribute: null, filters: null, criteria_count: 0, confidence: "high" }), "all")
    ).toMatchObject({ intent: "filter_list", filters: null, criteriaCount: 0 });
  });
});

describe("prompt examples stay neutral", () => {
  /** Full names of the territory's state codes. */
  const STATE_NAMES: Record<string, string> = {
    CO: "Colorado",
    UT: "Utah",
    ID: "Idaho",
    NM: "New Mexico",
    WY: "Wyoming",
    MT: "Montana",
  };
  const metros = TEMPO_ICP.territoryMetros.map((metro) => {
    const [city = "", code = ""] = metro.split(",").map((part) => part.trim());
    return { city, code };
  });
  const codes = Array.from(new Set(metros.map((metro) => metro.code)));

  /** Whole word or phrase, any case: "CO" never matches "company". */
  const wholeWord = (term: string): RegExp =>
    new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i");
  /** A state code as written in prose: uppercase, whole word ("ID" is Idaho; "id" is an ordinary word). */
  const stateCode = (code: string): RegExp => new RegExp(`(^|[^A-Za-z0-9])${code}($|[^A-Za-z0-9])`);

  // 2026-11-06: every Data Room chat prompt, not only the router's.
  const PROMPTS: Record<string, string> = {
    router: ROUTER_SYSTEM_PROMPT,
    selection: SELECTION_SYSTEM_PROMPT,
    opening: OPENING_SYSTEM_PROMPT,
  };

  it("no prompt names an ICP industry (the config's list, plus vet and PT)", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      for (const term of [...TEMPO_ICP.verticals, "vet", "PT"]) {
        expect(prompt, `${name}: ${term}`).not.toMatch(wholeWord(term));
      }
    }
  });

  it("no prompt names a territory city, state or state code", () => {
    expect(codes.every((code) => STATE_NAMES[code]), "every territory state has a name to check").toBe(true);
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      for (const term of [...metros.map((metro) => metro.city), ...codes.map((code) => STATE_NAMES[code] ?? code)]) {
        expect(prompt, `${name}: ${term}`).not.toMatch(wholeWord(term));
      }
      for (const code of codes) {
        expect(prompt, `${name}: ${code}`).not.toMatch(stateCode(code));
      }
    }
    // The router's prompt never had a state code in any case.
    for (const code of codes) {
      expect(ROUTER_SYSTEM_PROMPT, code).not.toMatch(wholeWord(code));
    }
  });

  it("no prompt uses an ICP location bound in an example range", () => {
    const { minLocations: min, maxLocations: max } = TEMPO_ICP;
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      expect(prompt, name).not.toMatch(new RegExp(`\\b${min}\\s*(?:and|to|-|–)\\s*\\d+\\b`));
      expect(prompt, name).not.toMatch(new RegExp(`\\b\\d+\\s*(?:and|to|-|–)\\s*${max}\\b`));
      expect(prompt, name).not.toMatch(new RegExp(`\\bgte ${min}\\b|\\blte ${max}\\b`));
    }
  });

  it("the opening prompt's example is neutral (it used to name a dental group in Colorado)", () => {
    expect(OPENING_SYSTEM_PROMPT).toContain('(for example "Four fitness studios in Texas offer online booking.")');
    expect(OPENING_SYSTEM_PROMPT).not.toContain("dental");
  });

  it("keeps the neutral examples, each with the same field and op as before", () => {
    for (const text of [
      '"which are in Texas?"',
      '(for example "TX")',
      '"in Texas or Ohio" is two state conditions',
      '"between 20 and 40 locations" is gte 20 and lte 40',
      '"fitness studios in Phoenix" is 2',
      "such as TX, CA or NY are US state codes",
    ]) {
      expect(ROUTER_SYSTEM_PROMPT, text).toContain(text);
    }
  });
});

describe("follow-ups", () => {
  const CANYON = { mode: "companies" as const, companyIds: ["canyon"] };
  const OTHER = { mode: "companies" as const, companyIds: ["maple"] };
  const hiring = [
    { role: "user", content: "Are they hiring?", scope: CANYON },
    { role: "assistant", intro: "", items: [{ companyId: "canyon", text: "Job listing: Spa Attendant" }], scope: CANYON },
  ];

  it("recognises a whole-message request for more on the last answer", () => {
    for (const text of [
      "tell me more about that",
      "Tell me more.",
      "tell me a bit more",
      "Can you tell me more about it?",
      "ok, tell me more please",
      "more about that",
      "More on this?",
      "more details",
      "anything else on that?",
      "Anything more about those?",
      "what else about that",
      "Could you elaborate?",
      "elaborate on that",
      "go on",
      "expand on that",
    ]) {
      expect(isFollowUpQuestion(text), text).toBe(true);
    }
  });

  it("a message with its own subject, about the companies themselves, or a plain 'anything else?' is not one", () => {
    for (const text of [
      "tell me more about their budget",
      "tell me more about them",
      "Tell me about them",
      "anything else?",
      "What else should I know?",
      "Are they hiring?",
      "more locations than Summit?",
      "",
    ]) {
      expect(isFollowUpQuestion(text), text).toBe(false);
    }
  });

  it("Canyon: the follow-up is about the earlier question, with the lines its answer showed", () => {
    const context = parseFollowUpContext(
      [{ role: "user", content: "What's their industry?", scope: OTHER }, ...hiring],
      CANYON
    );
    expect(context).toEqual({
      question: "Are they hiring?",
      earlierQuestions: ["What's their industry?"],
      shownLines: new Map([["canyon", new Set(["Job listing: Spa Attendant"])]]),
    });
  });

  it("walks back over earlier follow-ups to the question they follow; the latest answer's lines count", () => {
    const context = parseFollowUpContext(
      [
        ...hiring,
        { role: "user", content: "tell me more", scope: CANYON },
        {
          role: "assistant",
          intro: "",
          items: [{ companyId: "canyon", text: "Job listing: Spa Attendant\nCareers page lists a guest coordinator role" }],
          scope: CANYON,
        },
      ],
      CANYON
    );
    expect(context?.question).toBe("Are they hiring?");
    expect(context?.earlierQuestions).toEqual([]);
    expect(context?.shownLines.get("canyon")).toEqual(
      new Set(["Job listing: Spa Attendant", "Careers page lists a guest coordinator role"])
    );
  });

  it("no context: other companies, no scope on the question, All companies, no earlier question, or no history", () => {
    expect(parseFollowUpContext(hiring, OTHER)).toBeNull();
    expect(parseFollowUpContext([{ role: "user", content: "Are they hiring?" }], CANYON)).toBeNull();
    expect(parseFollowUpContext(hiring, { mode: "all" })).toBeNull();
    expect(parseFollowUpContext([{ role: "user", content: "tell me more", scope: CANYON }], CANYON)).toBeNull();
    expect(parseFollowUpContext([], CANYON)).toBeNull();
    expect(parseFollowUpContext("not a list", CANYON)).toBeNull();
    // A follow-up chain that crosses into other companies stops there.
    expect(
      parseFollowUpContext([...hiring, { role: "user", content: "tell me more", scope: OTHER }], CANYON)
    ).toBeNull();
  });

  it("an earlier question with no answer (a failed request) still counts; its lines are empty", () => {
    expect(parseFollowUpContext([{ role: "user", content: "Are they hiring?", scope: CANYON }], CANYON)).toEqual({
      question: "Are they hiring?",
      earlierQuestions: [],
      shownLines: new Map(),
    });
  });
});

describe("English, read from the words (typos aren't another language)", () => {
  it("two different common English function words make it English", () => {
    for (const text of [
      "comoare the 3 only for locations",
      "which ones have online boookinh?",
      "waht is the budegt for them?",
      "tell me about them",
    ]) {
      expect(hasEnglishFunctionWords(text), text).toBe(true);
    }
  });

  it("one, none, or another language is not enough", () => {
    for (const text of ["¿Qué software usan?", "me gustaría saber más", "budget", "locations?", "", "Quel logiciel utilisent-ils ?"]) {
      expect(hasEnglishFunctionWords(text), text).toBe(false);
    }
  });
});

describe("compare, read from the words", () => {
  it("'compare', a one-letter typo of it, 'comparison', 'vs' / 'versus' and 'side by side'", () => {
    for (const text of [
      "just compare the signals for the 3",
      "comoare the 3 only for locations",
      "compre them",
      "comapre these",
      "How do they compare?",
      "a comparison of the two",
      "Summit vs Falcon",
      "show them side by side",
      "side-by-side please",
    ]) {
      expect(isCompareRequest(text), text).toBe(true);
    }
  });

  it("other questions are not ('company', 'compete', 'companies' are other words)", () => {
    for (const text of ["What are their risks?", "company size?", "who do they compete with?", "which companies have online booking?", "tell me about them"]) {
      expect(isCompareRequest(text), text).toBe(false);
    }
  });
});

describe("sort (list questions)", () => {
  it("one prompt line, with neutral examples", () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      'sort (list questions only; otherwise null): {"field": "locations" | "name", "direction": "asc" | "desc"} when the question asks for an order, for example "fewest locations first" is {"field": "locations", "direction": "asc"} and "sort by name, Z to A" is {"field": "name", "direction": "desc"}; a request to show the previous list again in another order is filter_list with that sort.'
    );
    expect(ROUTER_SYSTEM_PROMPT).toContain('"sort": object | null');
  });

  it("a valid sort is kept; anything else is left out (A–Z); it never changes the rest of the decision", () => {
    const base = { intent: "filter_list", topic: null, attribute: null, filters: [{ field: "state", op: "eq", value: "TX" }], criteria_count: 1, confidence: "high" };
    expect(parseRouterReply(reply({ ...base, sort: { field: "locations", direction: "asc" } }), "all").sort).toEqual({
      field: "locations",
      direction: "asc",
    });
    expect(parseRouterReply(reply({ ...base, sort: { field: "name", direction: "descending" } }), "all").sort).toEqual({
      field: "name",
      direction: "desc",
    });
    expect(parseRouterReply(reply({ ...base, sort: { field: "locations" } }), "all").sort).toEqual({ field: "locations", direction: "asc" });
    for (const sort of [null, { field: "fit", direction: "desc" }, { field: "locations", direction: "sideways" }, "locations", []]) {
      const decision = parseRouterReply(reply({ ...base, sort }), "all");
      expect(decision, JSON.stringify(sort)).not.toHaveProperty("sort");
      expect(decision.filters).toEqual([{ field: "state", op: "eq", value: "TX" }]);
    }
  });

  it("All companies: a filter_list with only a sort is used even at low confidence (a re-sort request)", () => {
    const decision = parseRouterReply(
      reply({ intent: "filter_list", topic: null, attribute: null, filters: null, criteria_count: 0, sort: { field: "locations", direction: "desc" }, confidence: "low" }),
      "all"
    );
    expect(decision).toMatchObject({ intent: "filter_list", filters: null, sort: { field: "locations", direction: "desc" } });
  });
});
