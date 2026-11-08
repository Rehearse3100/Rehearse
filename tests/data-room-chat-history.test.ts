/**
 * data-room-chat-history.test.ts
 * The client-sent history, cut to what POST /api/student/data-room-chat reads
 * (trimChatHistory, lib/data-room-chat-scope.ts; 2026-11-08): the last 3 questions
 * (500 characters each), the latest answer, and the history's last entry. Every
 * reader gives the same result on the trimmed history as on the whole one: the
 * router's recent questions (parseHistoryQuestions, last 3), the follow-up's lines
 * (parseFollowUpContext) and the previous All-companies list (parsePreviousListIds),
 * checked on hand-written cases and on 2,000 random histories (malformed entries
 * included). Pure: no network, no database.
 */

import { describe, expect, it } from "vitest";
import { parsePreviousListIds } from "@/lib/data-room-chat-filter";
import { parseFollowUpContext, ROUTER_RECENT_QUESTIONS } from "@/lib/data-room-chat-router";
import {
  HISTORY_ENTRIES_SENT,
  HISTORY_QUESTION_MAX_CHARS,
  HISTORY_QUESTIONS_KEPT,
  parseHistoryQuestions,
  trimChatHistory,
  type ChatScope,
} from "@/lib/data-room-chat-scope";

const ONE: ChatScope = { mode: "companies", companyIds: ["a"] };
const TWO: ChatScope = { mode: "companies", companyIds: ["a", "b"] };
const OTHER: ChatScope = { mode: "companies", companyIds: ["c"] };
const ALL: ChatScope = { mode: "all" };

const question = (content: string, scope: unknown = ONE): Record<string, unknown> => ({ role: "user", content, scope });
const answer = (scope: unknown, ...items: Array<[string, string]>): Record<string, unknown> => ({
  role: "assistant",
  intro: "Here's what's on record.",
  items: items.map(([companyId, text]) => ({ companyId, text })),
  scope,
});

/** What the route reads from a history: the router's recent questions, the follow-up lines for each scope, the previous list. */
function readers(history: unknown): unknown {
  return {
    recent: parseHistoryQuestions(history).slice(-ROUTER_RECENT_QUESTIONS),
    followUp: [ONE, TWO, OTHER, ALL].map((scope) => parseFollowUpContext(history, scope)),
    previousList: parsePreviousListIds(history),
  };
}

describe("trimChatHistory", () => {
  it("keeps the last 3 questions (the latest with its scope), the latest answer, and nothing else", () => {
    const history = [
      question("q1"),
      answer(ONE, ["a", "line 1"]),
      question("q2", OTHER),
      answer(OTHER, ["c", "line 2"]),
      question("q3"),
      answer(ONE, ["a", "line 3"]),
      question("q4"),
      answer(ONE, ["a", "line 4a\nline 4b"], ["b", "other"]),
    ];
    expect(trimChatHistory(history)).toEqual([
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
      { role: "user", content: "q4", scope: ONE },
      {
        role: "assistant",
        scope: ONE,
        items: [
          { companyId: "a", text: "line 4a\nline 4b" },
          { companyId: "b", text: "other" },
        ],
      },
    ]);
    expect(readers(trimChatHistory(history))).toEqual(readers(history));
  });

  it("cuts each kept question to 500 characters (the message cap), before any redaction", () => {
    const long = "Falcon Market ".repeat(100);
    const trimmed = trimChatHistory([question(long), question("short")]) as Array<{ content: string }>;
    expect(HISTORY_QUESTION_MAX_CHARS).toBe(500);
    expect(trimmed[0]?.content).toBe(long.slice(0, 500));
    expect(trimmed[1]?.content).toBe("short");
    expect(parseHistoryQuestions(trimmed)).toEqual([long.slice(0, 500), "short"]);
  });

  it("an unanswered latest question keeps no answer; a history ending on something else ends on null", () => {
    expect(trimChatHistory([question("q1"), answer(ONE, ["a", "x"]), question("q2")])).toEqual([
      { role: "user", content: "q1" },
      { role: "user", content: "q2", scope: ONE },
    ]);
    const endsOnJunk = [question("q1"), answer(ALL, ["a", "x"]), { role: "system", content: "?" }];
    expect(trimChatHistory(endsOnJunk)).toEqual([
      { role: "user", content: "q1", scope: ONE },
      { role: "assistant", scope: ALL, items: [{ companyId: "a", text: "x" }] },
      null,
    ]);
    // The list is followed by something that isn't an answer: no previous list, as before.
    expect(parsePreviousListIds(endsOnJunk)).toEqual([]);
    expect(parsePreviousListIds(trimChatHistory(endsOnJunk))).toEqual([]);
  });

  it("an answer with no question before it is kept as the last entry (the previous list still reads it)", () => {
    const history = [answer(ALL, ["a", "x"], ["b", "y"])];
    expect(trimChatHistory(history)).toEqual([
      { role: "assistant", scope: ALL, items: [{ companyId: "a", text: "x" }, { companyId: "b", text: "y" }] },
    ]);
    expect(parsePreviousListIds(trimChatHistory(history))).toEqual(["a", "b"]);
  });

  it("not a list, or empty → []; only the last 100 entries are read, as before", () => {
    expect(trimChatHistory("nope")).toEqual([]);
    expect(trimChatHistory([])).toEqual([]);
    // 120 entries: the 20 questions at the start are outside the last 100.
    const old = Array.from({ length: 120 }, (_, i) => (i < 20 ? question(`old ${i}`) : { role: "assistant", items: "x" }));
    expect(readers(trimChatHistory(old))).toEqual(readers(old));
    expect(parseHistoryQuestions(trimChatHistory(old))).toEqual([]);
    // One entry fewer at the end: question 19 is now among the last 100.
    expect(parseHistoryQuestions(trimChatHistory(old.slice(0, -1)))).toEqual(["old 19"]);
  });

  it("the router reads exactly the questions kept, and the pane sends 10 entries", () => {
    expect(ROUTER_RECENT_QUESTIONS).toBe(HISTORY_QUESTIONS_KEPT);
    expect(HISTORY_QUESTIONS_KEPT).toBe(3);
    expect(HISTORY_ENTRIES_SENT).toBe(10);
  });
});

// ── The same reading on random histories ───

/** A small seeded generator (the same histories every run). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomEntry(next: () => number): unknown {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const scopes: unknown[] = [ONE, TWO, OTHER, ALL, undefined, { mode: "companies", companyIds: [] }, "all"];
  const lines = ["line 1", "line 2\nline 3", " ", "", "line 1\n\nline 4"];
  const item = (): unknown =>
    pick<unknown>([
      { companyId: pick(["a", "b", "c"]), text: pick(lines) },
      { companyId: pick(["a", "b"]), text: pick(lines), source: "research" },
      { companyId: 7, text: "x" },
      { companyId: "a" },
      null,
      ["a", "x"],
    ]);
  switch (Math.floor(next() * 9)) {
    case 0:
    case 1:
    case 2:
      return { role: "user", content: pick(["q", "Are they hiring?", "", "x".repeat(400)]), scope: pick(scopes) };
    case 3:
    case 4:
    case 5:
      return { role: "assistant", intro: "i", items: Array.from({ length: Math.floor(next() * 4) }, item), scope: pick(scopes) };
    case 6:
      return pick<unknown>([null, 42, "text", ["user", "q"], {}]);
    case 7:
      return pick<unknown>([{ role: "user", content: 5 }, { role: "assistant", items: "x", scope: ALL }, { role: "system", content: "q" }]);
    default:
      return { role: "assistant", scope: ALL, items: [{ companyId: pick(["a", "b"]), text: "Dental" }] };
  }
}

describe("every reader gives the same result on the trimmed history", () => {
  it("2,000 random histories (0 to 130 entries, malformed ones included)", () => {
    const next = seeded(20261108);
    for (let run = 0; run < 2000; run += 1) {
      const length = run % 50 === 0 ? 100 + Math.floor(next() * 30) : Math.floor(next() * 24);
      const history = Array.from({ length }, () => randomEntry(next));
      const trimmed = trimChatHistory(history);
      expect(readers(trimmed), `run ${run}`).toEqual(readers(history));
      // Never more than the 3 questions, one answer and the last entry.
      expect(trimmed.length, `run ${run}`).toBeLessThanOrEqual(HISTORY_QUESTIONS_KEPT + 2);
    }
  });

  it("what the pane sends (its last 10 entries) reads the same as its whole transcript", () => {
    // The pane's history: each question, then its answer (left out when the request failed).
    const next = seeded(42);
    for (let run = 0; run < 1000; run += 1) {
      const turns = 1 + Math.floor(next() * 20);
      const history = Array.from({ length: turns }, (_, i) => i).flatMap((i): unknown[] => {
        const scope = [ONE, TWO, OTHER, ALL][Math.floor(next() * 4)];
        const asked = question(`q${i}`, scope);
        return next() < 0.15 ? [asked] : [asked, answer(scope, ["a", `line ${i}`], ["b", "same line"])];
      });
      expect(readers(trimChatHistory(history.slice(-HISTORY_ENTRIES_SENT))), `run ${run}`).toEqual(readers(history));
    }
  });
});
