/**
 * call-notes-route.test.ts
 * POST /api/student/call-notes against a fake database client and a mocked OpenAI
 * client (no network, no live database): auth and attempt ownership, stored notes
 * returned without a model call, the one gpt-4o call that sees only the
 * transcript, reply-shape validation, the conditional save, and nothing saved
 * when the transcript is missing or the call fails.
 */

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/call-notes/route";
import { requireStudentApi } from "@/lib/api-auth";
import {
  CALL_NOTES_SYSTEM_PROMPT,
  parseCallNotes,
  parseCallNotesBody,
  parseCallNotesReply,
} from "@/lib/tempo-call-notes";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";

// ── Fakes ───

type Query = {
  table: string;
  op: "select" | "update";
  columns?: string;
  values?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  isNull: string[];
};

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  respond: (() => ({ data: null, error: null })) as (query: Query) => { data: unknown; error: unknown },
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: state.create } };
  },
}));

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const query: Query = { table, op: "select", eqs: [], isNull: [] };
      state.queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        update(values: Record<string, unknown>) {
          query.op = "update";
          query.values = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eqs.push([column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          if (value === null) {
            query.isNull.push(column);
          }
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(state.respond(query));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(state.respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

// ── Fixtures ───

const TEMPO_ATTEMPT = {
  id: "attempt-1",
  class_id: DEFAULT_CLASS_ID,
  simulation_id: TEMPO_SIMULATION_ID,
  simulations: { title: "Tempo" },
};

const DISCOVERY_TRANSCRIPT = JSON.stringify({
  callDurationSeconds: 600,
  transcript: "unused text",
  transcriptEntries: [
    { role: "dana", content: "We book everything by phone across eight offices.", timestamp: "00:10" },
    { role: "student", content: "I'll send over a rollout plan by Friday.", timestamp: "09:50" },
  ],
  preCallPrep: { openQuestions: ["SECRET PREP QUESTION"], anticipatedProbe: "", anticipatedConfirm: "" },
});

const NOTES = {
  summary: "Dana walked through phone booking across eight offices. The student offered a rollout plan.",
  told_you: ["They book everything by phone across eight offices."],
  concerns: [],
  committed: ["Send a rollout plan by Friday."],
};

type Fixture = {
  attempt?: unknown;
  row?: unknown;
  savedRows?: unknown[];
  current?: unknown;
};

/** Answers each query the way the database would for this fixture. */
function useFixture(fixture: Fixture): void {
  state.respond = (query) => {
    if (query.table === "attempts") {
      return { data: fixture.attempt ?? null, error: null };
    }
    if (query.op === "update") {
      return { data: fixture.savedRows ?? [{ call_notes: query.values?.call_notes }], error: null };
    }
    if (query.columns === "call_notes") {
      return { data: fixture.current ?? null, error: null };
    }
    return { data: fixture.row ?? null, error: null };
  };
}

function modelReply(content: unknown): { choices: Array<{ message: { content: string } }> } {
  return { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] };
}

function request(body: unknown): Request {
  return new Request("http://x/api/student/call-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(body: unknown = { attemptId: "attempt-1", stage: "discovery" }): Promise<{ status: number; json: unknown }> {
  const res = await POST(request(body));
  return { status: res.status, json: await res.json() };
}

const updates = (): Query[] => state.queries.filter((query) => query.op === "update");

beforeEach(() => {
  state.queries = [];
  state.create.mockReset();
  state.create.mockResolvedValue(modelReply(NOTES));
  useFixture({ attempt: TEMPO_ATTEMPT, row: { id: "row-1", transcript: DISCOVERY_TRANSCRIPT, call_notes: null } });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

// ── Route ───

describe("access", () => {
  it("returns the auth response when the student isn't signed in, touching nothing", async () => {
    vi.mocked(requireStudentApi).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await call()).status).toBe(401);
    expect(state.queries).toEqual([]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("rejects a bad body: no attempt id, an unknown stage, or not JSON", async () => {
    for (const body of [{ stage: "discovery" }, { attemptId: "attempt-1", stage: "presentation" }, "not json"]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(state.queries).toEqual([]);
  });

  it("the attempt must be the student's own Tempo attempt", async () => {
    useFixture({ attempt: null });
    expect(await call()).toEqual({ status: 404, json: { error: "Not found." } });
    const attemptQuery = state.queries.find((query) => query.table === "attempts");
    expect(attemptQuery?.eqs).toEqual([
      ["id", "attempt-1"],
      ["student_id", "student-1"],
    ]);

    useFixture({ attempt: { ...TEMPO_ATTEMPT, class_id: "another-class" } });
    expect((await call()).status).toBe(404);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("the call must be saved: no stage_scores row → 404", async () => {
    useFixture({ attempt: TEMPO_ATTEMPT, row: null });
    expect(await call({ attemptId: "attempt-1", stage: "objections" })).toEqual({
      status: 404,
      json: { error: "Call not found." },
    });
    const rowQuery = state.queries.find((query) => query.table === "stage_scores");
    expect(rowQuery?.eqs).toEqual([
      ["attempt_id", "attempt-1"],
      ["stage", "objections"],
    ]);
  });
});

describe("notes", () => {
  it("stored notes come back as they are, with no model call and no save", async () => {
    useFixture({ attempt: TEMPO_ATTEMPT, row: { id: "row-1", transcript: DISCOVERY_TRANSCRIPT, call_notes: NOTES } });
    expect(await call()).toEqual({ status: 200, json: { notes: NOTES } });
    expect(state.create).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
  });

  it("otherwise one gpt-4o call with only the transcript, saved where call_notes is null", async () => {
    expect(await call()).toEqual({ status: 200, json: { notes: NOTES } });
    expect(state.create).toHaveBeenCalledTimes(1);
    const args = state.create.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(args).toMatchObject({ model: "gpt-4o", temperature: 0.2, response_format: { type: "json_object" } });
    expect(args.messages).toEqual([
      { role: "system", content: CALL_NOTES_SYSTEM_PROMPT },
      {
        role: "user",
        content: "Dana Reyes: We book everything by phone across eight offices.\nStudent: I'll send over a rollout plan by Friday.",
      },
    ]);
    expect(JSON.stringify(args.messages)).not.toContain("SECRET PREP QUESTION");
    expect(updates()).toEqual([
      expect.objectContaining({
        table: "stage_scores",
        values: { call_notes: NOTES },
        eqs: [["id", "row-1"]],
        isNull: ["call_notes"],
      }),
    ]);
  });

  it("if another request saved first, its stored notes are returned", async () => {
    const other = { ...NOTES, summary: "Saved first by another request." };
    useFixture({
      attempt: TEMPO_ATTEMPT,
      row: { id: "row-1", transcript: DISCOVERY_TRANSCRIPT, call_notes: null },
      savedRows: [],
      current: { call_notes: other },
    });
    expect(await call()).toEqual({ status: 200, json: { notes: other } });
  });

  it("an invalid reply, a failed call, or no transcript: an error and nothing saved", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.create
      .mockResolvedValueOnce(modelReply({ summary: "Only a summary." }))
      .mockResolvedValueOnce(modelReply("not json"))
      .mockRejectedValueOnce(new Error("model down"));
    for (let i = 0; i < 3; i += 1) {
      expect(await call(), String(i)).toEqual({ status: 502, json: { error: "Couldn't write call notes." } });
    }

    useFixture({
      attempt: TEMPO_ATTEMPT,
      row: {
        id: "row-1",
        transcript: JSON.stringify({ callDurationSeconds: 0, transcript: "[TEST] Skipped discovery call", transcriptEntries: [] }),
        call_notes: null,
      },
    });
    expect((await call()).status).toBe(422);
    errorSpy.mockRestore();

    expect(state.create).toHaveBeenCalledTimes(3);
    expect(updates()).toEqual([]);
  });
});

// ── Shape ───

describe("notes shape", () => {
  it("trims, drops empty items and keeps at most 3 per group", () => {
    expect(
      parseCallNotes({
        summary: "  Two sentences.  ",
        told_you: [" a ", "", "b", "c", "d"],
        concerns: [],
        committed: ["  x  "],
      })
    ).toEqual({ summary: "Two sentences.", told_you: ["a", "b", "c"], concerns: [], committed: ["x"] });
  });

  it("rejects a missing or empty summary, a missing group or a non-string item", () => {
    for (const raw of [
      null,
      [],
      "notes",
      { ...NOTES, summary: "  " },
      { ...NOTES, summary: 7 },
      { summary: "S.", told_you: [], concerns: [] },
      { ...NOTES, concerns: "none" },
      { ...NOTES, committed: ["ok", 3] },
    ]) {
      expect(parseCallNotes(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(parseCallNotesReply("{ broken")).toBeNull();
    expect(parseCallNotesReply(JSON.stringify(NOTES))).toEqual(NOTES);
  });

  it("the body: an attempt id and the discovery or objections stage", () => {
    expect(parseCallNotesBody({ attemptId: " a1 ", stage: "objections" })).toEqual({ attemptId: "a1", stage: "objections" });
    for (const raw of [null, {}, { attemptId: "", stage: "discovery" }, { attemptId: "a1", stage: "negotiation" }]) {
      expect(parseCallNotesBody(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("the prompt: only plain facts from the transcript, no grading, advice or scoring", () => {
    for (const line of [
      '{"summary": string, "told_you": string[], "concerns": string[], "committed": string[]}',
      "- summary: two sentences on what the call covered.",
      "- Use only plain facts stated in the transcript. Never add anything that isn't in it.",
      "- No grading, no advice and no scoring: never say what the student did well or badly, or what they should do.",
    ]) {
      expect(CALL_NOTES_SYSTEM_PROMPT, line).toContain(line);
    }
  });
});
