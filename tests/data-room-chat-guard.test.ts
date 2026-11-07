/**
 * data-room-chat-guard.test.ts
 * The Data Room chat safety checks (lib/data-room-chat-guard.ts) and their order in
 * POST /api/student/data-room-chat, against a fake database and mocked OpenAI (no
 * network, no live database): the 500-character cap; the 300-total limit (no
 * per-minute limit), skipped in tester mode, failing open; counting; moderation
 * (self-harm, other flags, clean, errors); English (the non-Latin heuristic and the
 * router's english:false); a normal question reaching the router unchanged; and
 * fixed replies with no opening sentence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/data-room-chat/route";
import { ALL_MODE_REPLY } from "@/lib/data-room-chat-filter";
import {
  checkUsageLimits,
  DATA_ROOM_CHAT_MAX_CHARS,
  GUARD_REPLIES,
  guardReply,
  isMostlyNonLatin,
  isTooLong,
  moderateMessage,
  recordUsage,
  USAGE_TABLE,
} from "@/lib/data-room-chat-guard";
import { buildRouterMessages, parseRouterEnglish, ROUTER_SYSTEM_PROMPT } from "@/lib/data-room-chat-router";

// ── Fakes ───

type Op = { table: string; calls: Array<[string, unknown[]]> };

const fake = vi.hoisted(() => ({
  ops: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  /** Rows in data_room_chat_usage before the test; rows the test inserts are added on top. */
  usageTotal: 0,
  usageError: null as unknown,
  router: vi.fn(),
  other: vi.fn(),
  moderate: vi.fn(),
}));

const ROSTER = [
  {
    id: "co-1",
    company_name: "Falcon Market",
    industry: "Retail",
    vertical: "retail",
    locations: 1,
    metro: "Austin, TX",
    in_territory: false,
    size_note: null,
    online_booking: true,
    blurb: "A neighbourhood market.",
    public_signals: [],
  },
];

function answer(op: Op): { data: unknown; error: unknown; count?: number | null } {
  const called = (name: string): unknown[] | undefined => op.calls.find(([method]) => method === name)?.[1];
  if (op.table === "attempts") {
    return { data: { id: "attempt-1", simulation_id: "sim-1" }, error: null };
  }
  if (op.table === "data_room_chat_usage") {
    if (called("insert")) {
      return { data: null, error: null };
    }
    if (fake.usageError) {
      return { data: null, error: fake.usageError, count: null };
    }
    const inserted = fake.ops.filter(
      (other) => other.table === "data_room_chat_usage" && other.calls.some(([name]) => name === "insert")
    ).length;
    return { data: null, error: null, count: fake.usageTotal + inserted };
  }
  if (op.table === "crm_prospect_directory" && (called("select")?.[0] as string) === "research_facts") {
    return { data: { research_facts: [] }, error: null };
  }
  if (op.table === "crm_prospect_directory") {
    return { data: ROSTER, error: null };
  }
  return { data: [], error: null };
}

function fakeClient(): { from: (table: string) => object } {
  return {
    from(table: string) {
      const op: Op = { table, calls: [] };
      fake.ops.push(op);
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
                Promise.resolve(answer(op)).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              op.calls.push([String(prop), args]);
              return builder;
            };
          },
        }
      );
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => fakeClient() }));

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

vi.mock("openai", async () => {
  const { ROUTER_SYSTEM_PROMPT: routerPrompt } = await import("@/lib/data-room-chat-router");
  return {
    default: class {
      chat = {
        completions: {
          create: (args: { messages: Array<{ content: string }> }): unknown =>
            args.messages[0]?.content === routerPrompt ? fake.router(args) : fake.other(args),
        },
      };
      moderations = { create: fake.moderate };
    },
  };
});

// ── Helpers ───

const reply = (body: unknown): { choices: Array<{ message: { content: string } }> } => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
});

const CLEAN = { results: [{ flagged: false, categories: { "self-harm": false, harassment: false } }] };

async function ask(newMessage: string, scope: unknown = { mode: "all" }): Promise<Record<string, unknown>> {
  const res = await POST(
    new Request("http://x/api/student/data-room-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-1", scope, newMessage }),
    })
  );
  return (await res.json()) as Record<string, unknown>;
}

/** The pipeline's own fixed All-companies reply (an overview question in All mode). */
const ALL_MODE = { intro: ALL_MODE_REPLY, items: [] };

const usageOps = (): Op[] => fake.ops.filter((op) => op.table === USAGE_TABLE);
const inserts = (): Op[] => usageOps().filter((op) => op.calls.some(([name]) => name === "insert"));

beforeEach(() => {
  fake.ops = [];
  fake.usageTotal = 0;
  fake.usageError = null;
  fake.router.mockReset().mockResolvedValue(reply({ intent: "overview", topic: null, attribute: null, confidence: "high" }));
  fake.other.mockReset().mockResolvedValue(reply({ opening: "Here is what's on record." }));
  fake.moderate.mockReset().mockResolvedValue(CLEAN);
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.TEMPO_TEST_BYPASS_GATES;
});

afterEach(() => {
  delete process.env.TEMPO_TEST_BYPASS_GATES;
});

// ── Unit checks ───

describe("guard helpers", () => {
  it("500 characters pass, 501 are refused", () => {
    expect(isTooLong("a".repeat(DATA_ROOM_CHAT_MAX_CHARS))).toBe(false);
    expect(isTooLong("a".repeat(DATA_ROOM_CHAT_MAX_CHARS + 1))).toBe(true);
  });

  it("non-Latin heuristic: more than 30% of the letters in a non-Latin script", () => {
    expect(isMostlyNonLatin("What are their risks?")).toBe(false);
    expect(isMostlyNonLatin("¿Cuáles son sus riesgos?")).toBe(false);
    expect(isMostlyNonLatin("他们的风险是什么")).toBe(true);
    expect(isMostlyNonLatin("Какие у них риски?")).toBe(true);
    expect(isMostlyNonLatin("What about the 风险")).toBe(false);
    expect(isMostlyNonLatin("123 ?!")).toBe(false);
  });

  it("the router's english field: false only when said with high confidence", () => {
    expect(parseRouterEnglish(JSON.stringify({ english: false, confidence: "high" }))).toBe(false);
    expect(parseRouterEnglish(JSON.stringify({ english: false, confidence: "low" }))).toBe(true);
    expect(parseRouterEnglish(JSON.stringify({ english: "false", confidence: "high" }))).toBe(true);
    expect(parseRouterEnglish(JSON.stringify({ intent: "overview", confidence: "high" }))).toBe(true);
    expect(parseRouterEnglish("not json")).toBe(true);
    expect(ROUTER_SYSTEM_PROMPT).toContain('"english": boolean');
    expect(ROUTER_SYSTEM_PROMPT).toContain(
      "english: true when the question is written in English, typos and short questions included; false otherwise."
    );
  });

  it("limit: 300 in total, one count query with no time window; a failed or throwing count allows", async () => {
    const client = fakeClient() as never;
    fake.usageTotal = 300;
    expect(await checkUsageLimits(client, "attempt-1")).toBe("totalLimit");
    fake.usageTotal = 299;
    expect(await checkUsageLimits(client, "attempt-1")).toBeNull();
    expect(usageOps()).toHaveLength(2);
    expect(usageOps().some((op) => op.calls.some(([name]) => name === "gte"))).toBe(false);
    fake.usageError = { code: "PGRST205", message: "Could not find the table" };
    expect(await checkUsageLimits(client, "attempt-1")).toBeNull();
    const throwing = { from: () => ({ select: () => { throw new Error("boom"); } }) } as never;
    expect(await checkUsageLimits(throwing, "attempt-1")).toBeNull();
  });

  it("recordUsage writes one row; a failure is swallowed", async () => {
    await recordUsage(fakeClient() as never, "attempt-1", "student-1", Date.UTC(2026, 10, 6));
    expect(inserts()[0]?.calls.find(([name]) => name === "insert")?.[1]?.[0]).toEqual({
      attempt_id: "attempt-1",
      student_id: "student-1",
      created_at: "2026-11-06T00:00:00.000Z",
    });
    await expect(recordUsage({ from: () => { throw new Error("down"); } } as never, "a", "s")).resolves.toBeUndefined();
  });

  it("moderation: self-harm, other flags, clean, errors", async () => {
    const client = { moderations: { create: fake.moderate } } as never;
    fake.moderate.mockResolvedValueOnce({ results: [{ flagged: true, categories: { "self-harm/intent": true, violence: false } }] });
    expect(await moderateMessage(client, "x")).toBe("selfHarm");
    fake.moderate.mockResolvedValueOnce({ results: [{ flagged: true, categories: { harassment: true, "self-harm": false } }] });
    expect(await moderateMessage(client, "x")).toBe("flagged");
    fake.moderate.mockResolvedValueOnce(CLEAN);
    expect(await moderateMessage(client, "x")).toBeNull();
    fake.moderate.mockRejectedValueOnce(new Error("rate limited"));
    expect(await moderateMessage(client, "x")).toBeNull();
    expect(fake.moderate).toHaveBeenLastCalledWith({ model: "omni-moderation-latest", input: "x" });
  });

  it("fixed replies are the text alone, in the usual fixed-reply shape", () => {
    for (const key of Object.keys(GUARD_REPLIES) as Array<keyof typeof GUARD_REPLIES>) {
      expect(guardReply(key)).toEqual({ intro: GUARD_REPLIES[key], items: [] });
    }
  });
});

// ── The route, in order ───

describe("route: checks before the pipeline", () => {
  it("over 500 characters: refused with no model call and not counted; exactly 500 goes on", async () => {
    expect(await ask("a".repeat(501))).toEqual(guardReply("tooLong"));
    expect(fake.moderate).not.toHaveBeenCalled();
    expect(fake.router).not.toHaveBeenCalled();
    expect(usageOps()).toHaveLength(0);

    await ask("a".repeat(500));
    expect(fake.router).toHaveBeenCalledTimes(1);
  });

  it("the 300-total limit refuses without counting; tester mode skips it", async () => {
    fake.usageTotal = 300;
    expect(await ask("What are their risks?")).toEqual(guardReply("totalLimit"));
    expect(inserts()).toHaveLength(0);
    expect(fake.router).not.toHaveBeenCalled();

    process.env.TEMPO_TEST_BYPASS_GATES = "true";
    fake.ops = [];
    expect(await ask("Tell me about them")).toEqual(ALL_MODE);
    // No limit query in tester mode, but the question is still counted.
    expect(usageOps().some((op) => op.calls.some(([name]) => name === "select"))).toBe(false);
    expect(inserts()).toHaveLength(1);
  });

  it("25 questions in a minute are all allowed (no per-minute limit), and each is counted", async () => {
    for (let i = 0; i < 25; i += 1) {
      expect(await ask("Tell me about them"), `question ${i + 1}`).toEqual(ALL_MODE);
    }
    expect(fake.router).toHaveBeenCalledTimes(25);
    expect(inserts()).toHaveLength(25);
  });

  it("a failed count query lets the message through, and it is counted", async () => {
    fake.usageError = { code: "PGRST205", message: "Could not find the table 'public.data_room_chat_usage'" };
    expect(await ask("Tell me about them")).toEqual(ALL_MODE);
    expect(fake.router).toHaveBeenCalledTimes(1);
    expect(inserts()).toHaveLength(1);
  });

  it("moderation: self-harm and other flags get their replies; clean and errors carry on", async () => {
    fake.moderate.mockResolvedValueOnce({ results: [{ flagged: true, categories: { "self-harm": true } }] });
    expect(await ask("I want to hurt myself")).toEqual(guardReply("selfHarm"));
    fake.moderate.mockResolvedValueOnce({ results: [{ flagged: true, categories: { harassment: true } }] });
    expect(await ask("abusive text")).toEqual(guardReply("flagged"));
    expect(fake.router).not.toHaveBeenCalled();
    // Both flagged questions were counted (counting comes before moderation).
    expect(inserts()).toHaveLength(2);

    expect(await ask("Tell me about them")).toEqual(ALL_MODE);
    fake.moderate.mockRejectedValueOnce(new Error("moderation down"));
    expect(await ask("Tell me about them")).toEqual(ALL_MODE);
    expect(fake.router).toHaveBeenCalledTimes(2);
    expect(fake.moderate).toHaveBeenCalledWith({ model: "omni-moderation-latest", input: "Tell me about them" });
  });

  it("mostly non-Latin: refused without calling the router", async () => {
    expect(await ask("他们的风险是什么")).toEqual(guardReply("notEnglish"));
    expect(fake.router).not.toHaveBeenCalled();
  });

  it("the router's english:false (high confidence) is refused on both paths; low confidence goes on", async () => {
    fake.router.mockResolvedValue(reply({ intent: "overview", topic: null, attribute: null, english: false, confidence: "high" }));
    expect(await ask("Was sind die Risiken?")).toEqual(guardReply("notEnglish"));
    expect(await ask("Was sind die Risiken?", { mode: "companies", companyIds: ["co-1"] })).toEqual(guardReply("notEnglish"));
    expect(fake.other).not.toHaveBeenCalled();

    fake.router.mockResolvedValue(reply({ intent: "overview", topic: null, attribute: null, english: false, confidence: "low" }));
    expect(await ask("Tell me about them")).toEqual(ALL_MODE);
  });

  it("a normal question reaches the router unchanged", async () => {
    await ask("Which ones have online booking?");
    expect(fake.router).toHaveBeenCalledTimes(1);
    expect(fake.router.mock.calls[0]?.[0]).toMatchObject({
      // 2026-11-07: gpt-6-luna (the config's model settings; gpt-4o shuts down 2027-01-14).
      model: "gpt-6-luna",
      // 2026-11-08: All companies also lists the roster's industry names (this roster: Retail).
      messages: buildRouterMessages({
        question: "Which ones have online booking?",
        recentQuestions: [],
        scopeKind: "all",
        industries: ["Retail"],
      }),
    });
  });

  it("fixed replies never get an opening sentence", async () => {
    fake.moderate.mockResolvedValueOnce({ results: [{ flagged: true, categories: { harassment: true } }] });
    for (const message of ["a".repeat(501), "abusive text", "他们的风险是什么"]) {
      const body = await ask(message);
      expect(body.items).toEqual([]);
      expect(Object.values(GUARD_REPLIES)).toContain(body.intro);
    }
    expect(fake.other).not.toHaveBeenCalled();
  });
});
