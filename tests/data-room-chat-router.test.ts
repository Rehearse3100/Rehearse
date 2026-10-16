/**
 * data-room-chat-router.test.ts
 * Data Room question router (pure): the classifier sees only the redacted question,
 * the last 3 redacted questions and the scope kind; its reply fails closed to
 * "overview" on anything invalid, unknown, low-confidence (except valid filters in
 * All companies mode), or specific_research without a topic (for filter_list an
 * unknown topic or attribute just becomes null). Filters: 1–3 conditions, or a
 * single "filter" read as a one-item list.
 */

import { describe, expect, it } from "vitest";
import {
  buildRouterMessages,
  OVERVIEW_DECISION,
  parseRouterReply,
  ROUTER_SYSTEM_PROMPT,
  scopeKindOf,
} from "@/lib/data-room-chat-router";

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
      'Questions phrased as "how many…", "which are…" or "list the…" with one to three conditions are filter_list; read them charitably',
      '"how many are located dental?" is filter_list with filters [{"field": "industry", "op": "contains", "value": "dental"}]',
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

  it("filters: 1–3 conditions, including two on the same field; more than 3 or any invalid one → null", () => {
    expect(parseRouterReply(filtersReply([DENTAL]))).toMatchObject({ filters: [DENTAL], criteriaCount: 1 });
    expect(parseRouterReply(filtersReply([DENTAL, CO]))).toMatchObject({ filters: [DENTAL, CO], criteriaCount: 2 });
    expect(parseRouterReply(filtersReply([DENTAL, CO, BOOKING]))).toMatchObject({ filters: [DENTAL, CO, BOOKING], criteriaCount: 3 });
    expect(parseRouterReply(filtersReply([CO, UT]))).toMatchObject({ filters: [CO, UT] });
    expect(parseRouterReply(filtersReply([DENTAL, CO, BOOKING, UT]))).toMatchObject({ intent: "filter_list", filters: null });
    expect(parseRouterReply(filtersReply([DENTAL, { field: "software", op: "eq", value: "Zentrix" }]))).toMatchObject({
      intent: "filter_list",
      filters: null,
    });
    expect(parseRouterReply(filtersReply([{ field: "locations", op: "about", value: 3 }]))).toMatchObject({ filters: null });
    expect(ROUTER_SYSTEM_PROMPT).toContain('"filters": object[] | null');
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      'Conditions on different fields must all hold. Two conditions on the same field mean either one ("in Colorado or Utah" is two state conditions), except locations, where both hold ("between 3 and 8 locations" is gte 3 and lte 8).'
    );
  });

  it('"CO", "CA", "TX": the prompt reads two-letter uppercase tokens as state codes, and they parse as codes', () => {
    expect(ROUTER_SYSTEM_PROMPT).toContain("- Two-letter uppercase tokens such as CO, CA or TX are US state codes.");
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
