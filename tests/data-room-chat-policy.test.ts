/**
 * data-room-chat-policy.test.ts
 * Data Room fact policy (pure), table-tested over every intent × scope kind × topic:
 * findings only for specific_research about exactly one company, only when their
 * topics answer the question's topic, at most 4 in stored order; off_topic gets the
 * fixed reply and no facts; everything else gets public facts only.
 */

import { describe, expect, it } from "vitest";
import { allowedFacts, MAX_SHARED_FINDINGS, OFF_TOPIC_REPLY } from "@/lib/data-room-chat-policy";
import { ROUTER_INTENTS } from "@/lib/data-room-chat-router";
import type { ChatScope } from "@/lib/data-room-chat-scope";
import {
  FACT_TOPICS,
  QUESTION_TOPIC_FACT_TOPICS,
  QUESTION_TOPICS,
  type ResearchFinding,
} from "@/lib/tempo-research-topics";

// One finding per fact topic, in stored order, plus an untagged (older data) finding.
const FINDINGS: ResearchFinding[] = [
  ...FACT_TOPICS.map((topic) => ({ text: `${topic} finding`, topics: [topic] })),
  { text: "untagged finding", topics: [] },
];

const SCOPES: Record<"one" | "several" | "all", { scope: ChatScope; ids: string[] }> = {
  one: { scope: { mode: "companies", companyIds: ["a"] }, ids: ["a"] },
  several: { scope: { mode: "companies", companyIds: ["a", "b"] }, ids: ["a", "b"] },
  all: { scope: { mode: "all" }, ids: ["a", "b", "c"] },
};

describe("allowedFacts table (intent × scope kind × topic)", () => {
  for (const intent of ROUTER_INTENTS) {
    for (const [kind, { scope, ids }] of Object.entries(SCOPES)) {
      for (const topic of [...QUESTION_TOPICS, null]) {
        it(`${intent} · ${kind} · ${topic ?? "no topic"}`, () => {
          const result = allowedFacts({
            intent,
            topic,
            scope,
            companies: ids.map((id) => ({ id, findings: FINDINGS })),
          });

          if (intent === "off_topic") {
            expect(result.reply).toBe(OFF_TOPIC_REPLY);
            for (const id of ids) {
              expect(result.companies[id]).toEqual({ public: false, hidden: [] });
            }
            return;
          }

          expect(result.reply).toBeNull();
          const sharesFindings = intent === "specific_research" && kind === "one" && topic !== null;
          for (const id of ids) {
            const allowance = result.companies[id];
            expect(allowance?.public).toBe(true);
            if (!sharesFindings || topic === null) {
              expect(allowance?.hidden).toEqual([]);
              continue;
            }
            const answering = new Set<string>(QUESTION_TOPIC_FACT_TOPICS[topic]);
            const expected = FINDINGS.filter((f) => f.topics.some((t) => answering.has(t))).slice(
              0,
              MAX_SHARED_FINDINGS
            );
            expect(allowance?.hidden).toEqual(expected);
            expect(allowance?.hidden.length).toBeGreaterThan(0);
          }
        });
      }
    }
  }
});

describe("allowedFacts details", () => {
  const one: ChatScope = { mode: "companies", companyIds: ["a"] };

  it("risks shares at most 4 matching findings, in stored order", () => {
    const result = allowedFacts({
      intent: "specific_research",
      topic: "risks",
      scope: one,
      companies: [{ id: "a", findings: FINDINGS }],
    });
    expect(result.companies.a?.hidden.map((f) => f.text)).toEqual([
      "current_tools finding",
      "budget finding",
      "staffing finding",
      "operations finding",
    ]);
  });

  it("a specific topic shares only findings tagged with it; untagged findings are never shared", () => {
    const result = allowedFacts({
      intent: "specific_research",
      topic: "amenities",
      scope: one,
      companies: [{ id: "a", findings: FINDINGS }],
    });
    expect(result.companies.a?.hidden.map((f) => f.text)).toEqual(["amenities finding"]);
  });

  it("meta_or_bulk is answered as an overview: public facts, no findings", () => {
    expect(
      allowedFacts({
        intent: "meta_or_bulk",
        topic: "risks",
        scope: one,
        companies: [{ id: "a", findings: FINDINGS }],
      })
    ).toEqual({ reply: null, companies: { a: { public: true, hidden: [] } } });
  });
});
