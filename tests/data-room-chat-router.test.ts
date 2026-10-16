/**
 * data-room-chat-router.test.ts
 * Data Room question router (pure): the classifier sees only the redacted question,
 * the last 3 redacted questions and the scope kind; its reply fails closed to
 * "overview" on anything invalid, unknown, low-confidence, or specific_research
 * without a topic.
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
      "filter (set it only when the scope is all companies and the intent is filter_list; otherwise null)",
      'field "state": op "eq", value the two-letter state code',
      "criteria_count: how many separate conditions the question asks to filter by",
      'Questions phrased as "how many…", "which are…" or "list the…" with ONE condition are filter_list; read them charitably',
      '"how many are located dental?" is filter_list with {"field": "industry", "op": "contains", "value": "dental"}',
    ]) {
      expect(ROUTER_SYSTEM_PROMPT, text).toContain(text);
    }
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
    ).toEqual({ intent: "specific_research", topic: "risks", attribute: null, filter: null, criteriaCount: null });
    expect(
      parseRouterReply(reply({ intent: "attribute_lookup", topic: null, attribute: "locations", confidence: "high" }))
    ).toEqual({ intent: "attribute_lookup", topic: null, attribute: "locations", filter: null, criteriaCount: null });
  });

  it("reads one whitelisted filter and the criteria count; anything else becomes null, the decision stays", () => {
    const filterReply = (filter: unknown, criteriaCount: unknown): unknown =>
      parseRouterReply(
        reply({ intent: "filter_list", topic: null, attribute: null, filter, criteria_count: criteriaCount, confidence: "high" })
      );
    expect(filterReply({ field: "online_booking", op: "eq", value: true }, 1)).toEqual({
      intent: "filter_list",
      topic: null,
      attribute: null,
      filter: { field: "online_booking", op: "eq", value: true },
      criteriaCount: 1,
    });
    expect(filterReply({ field: "software", op: "eq", value: "Zentrix" }, 1)).toMatchObject({
      intent: "filter_list",
      filter: null,
      criteriaCount: 1,
    });
    expect(filterReply({ field: "state", op: "eq", value: "CO" }, 1.5)).toMatchObject({ criteriaCount: null });
    expect(filterReply(null, -1)).toMatchObject({ filter: null, criteriaCount: null });
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
    ]) {
      expect(parseRouterReply(raw), String(raw)).toEqual(OVERVIEW_DECISION);
    }
  });
});
