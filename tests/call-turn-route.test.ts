/**
 * call-turn-route.test.ts
 * POST /api/student/call-turn (app/api/student/call-turn/route.ts): signed-in students
 * only, on their own Tempo attempt, and only for the stage the attempt is on (not one
 * already completed; the local test bypass skips that check); the body is the call brain's
 * turn plus attemptId; the response is { reply, endCall?: true, label? }; no error carries
 * OpenAI's or Supabase's text. Sign-in, the database and OpenAI are mocked (as in
 * tests/chat-tts-score-routes.test.ts); nothing leaves the machine.
 */

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/call-turn/route";
import { CHAT_MAX_MESSAGE_CHARS, TEMPO_SIMULATION_ID } from "@/lib/constants";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  queries: [] as Array<{ table: string; eqs: Array<[string, unknown]> }>,
  attempt: null as Record<string, unknown> | null,
  attemptError: null as Record<string, unknown> | null,
  stageScore: null as Record<string, unknown> | null,
  stageScoreError: null as Record<string, unknown> | null,
  isLookupThrowing: false,
  label: "normal" as string | Error,
  reply: "Sure, go ahead." as string | Error,
}));

vi.mock("@/lib/api-auth", () => ({ requireStudentApi: state.auth }));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: state.create } };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => {
    if (state.isLookupThrowing) {
      throw new Error("secret internal detail");
    }
    return {
      from(table: string) {
        const query = { table, eqs: [] as Array<[string, unknown]> };
        state.queries.push(query);
        const builder = {
          select: () => builder,
          eq(column: string, value: unknown) {
            query.eqs.push([column, value]);
            return builder;
          },
          maybeSingle: async () =>
            table === "attempts"
              ? { data: state.attempt, error: state.attemptError }
              : table === "stage_scores"
                ? { data: state.stageScore, error: state.stageScoreError }
                : { data: null, error: null },
        };
        return builder;
      },
    };
  },
}));

type SentBody = { model: string; messages: Array<{ role: string; content: string }> };

/** The label call is the one whose system prompt is the label prompt. */
const isLabelCall = (body: SentBody): boolean => body.messages[0]?.content.startsWith("You label the latest message from a student") ?? false;

function request(body: unknown): Request {
  return new Request("http://x/api/student/call-turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A turn on the student's attempt (Dana, the student's message, early in the call), with changes. */
async function callTurn(changes: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    request({ attemptId: "attempt-1", persona: "tempo_discovery", messages: [], newMessage: "Hi Dana.", callSeconds: 30, silenceSeconds: 0, ...changes })
  );
}

const signedOut = (): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  state.auth.mockReset();
  state.auth.mockResolvedValue({ ok: true, session: { studentId: "student-1" } });
  state.queries = [];
  // On Discovery, Dana's stage.
  state.attempt = { id: "attempt-1", simulation_id: TEMPO_SIMULATION_ID, status: "in_progress", current_stage: "discovery" };
  state.attemptError = null;
  state.stageScore = null;
  state.stageScoreError = null;
  state.isLookupThrowing = false;
  state.label = "normal";
  state.reply = "Sure, go ahead.";
  state.create.mockReset();
  state.create.mockImplementation(async (body: SentBody) => {
    const answer = isLabelCall(body) ? state.label : state.reply;
    if (answer instanceof Error) {
      throw answer;
    }
    return { choices: [{ message: { content: answer } }] };
  });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  // The local test bypass is off, as in production.
  vi.stubEnv("TEMPO_TEST_BYPASS_GATES", "");
});

/** The two queries a turn on a live stage makes: the attempt, then that stage's saved score. */
const STAGE_QUERIES = (stage: string): Array<{ table: string; eqs: Array<[string, unknown]> }> => [
  { table: "attempts", eqs: [["id", "attempt-1"], ["student_id", "student-1"]] },
  { table: "stage_scores", eqs: [["attempt_id", "attempt-1"], ["stage", stage]] },
];

describe("POST /api/student/call-turn", () => {
  it("401 without a signed-in student, before reading anything", async () => {
    state.auth.mockResolvedValueOnce(signedOut());
    const res = await callTurn();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(state.queries).toEqual([]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("a generic 500 when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await callTurn();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not generate a reply." });
    expect(state.queries).toEqual([]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each<[string, unknown, string]>([
    ["a body that isn't JSON", "not json", "The body must be JSON."],
    ["a JSON array", [], "The body must be a JSON object."],
    ["an unknown persona", { attemptId: "attempt-1", persona: "dana", newMessage: "Hi" }, "Unknown persona."],
    ["a persona the call brain doesn't run", { attemptId: "attempt-1", persona: "tempo_negotiation_a", newMessage: "Hi" }, "Unknown persona."],
    ["no newMessage on a student turn", { attemptId: "attempt-1", persona: "tempo_discovery" }, "newMessage is required."],
    [
      "a message over the cap",
      { attemptId: "attempt-1", persona: "tempo_discovery", newMessage: "x".repeat(CHAT_MAX_MESSAGE_CHARS + 1) },
      `Messages can be at most ${CHAT_MAX_MESSAGE_CHARS} characters.`,
    ],
    ["no attemptId", { persona: "tempo_discovery", newMessage: "Hi" }, "attemptId is required."],
    ["a blank attemptId", { attemptId: "   ", persona: "tempo_discovery", newMessage: "Hi" }, "attemptId is required."],
    ["an attemptId that isn't text", { attemptId: 7, persona: "tempo_discovery", newMessage: "Hi" }, "attemptId is required."],
  ])("400 for %s", async (_name, body, error) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(state.queries).toEqual([]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("404 for an attempt that isn't the student's", async () => {
    state.attempt = null;
    const res = await callTurn({ attemptId: " someone-elses " });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Attempt not found." });
    expect(state.queries).toEqual([{ table: "attempts", eqs: [["id", "someone-elses"], ["student_id", "student-1"]] }]);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("404 for the student's own attempt on another simulation", async () => {
    state.attempt = { id: "attempt-1", simulation_id: "00000000-0000-0000-0000-000000000001" };
    const res = await callTurn();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Attempt not found." });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("success: the reply, endCall and endReason when the turn's note ends the call, and the label", async () => {
    state.label = "goodbye";
    state.reply = "Thanks for your time, goodbye. [END_CALL]";
    const ending = await callTurn({ newMessage: "That's all from me, bye!" });
    expect(ending.status).toBe(200);
    expect(await ending.json()).toEqual({ reply: "Thanks for your time, goodbye.", endCall: true, endReason: "goodbye", label: "goodbye" });
    expect(state.queries).toEqual(STAGE_QUERIES("discovery"));
    for (const [body] of state.create.mock.calls as Array<[SentBody]>) {
      expect(body.model).toBe("gpt-6-luna");
    }

    // A call that carries on: no endCall or endReason key at all.
    state.label = "normal";
    state.reply = "We run eight practices.";
    const ongoing = await callTurn();
    expect(await ongoing.json()).toEqual({ reply: "We run eight practices.", label: "normal" });

    // No student text (the start): no label call and no label key.
    state.create.mockClear();
    const start = await callTurn({ newMessage: undefined, start: true, callSeconds: 0 });
    expect(await start.json()).toEqual({ reply: "We run eight practices." });
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ["Dr. Kim while the attempt is on Discovery", { persona: "tempo_objections" }, {}],
    ["Dana once the attempt has moved on to Presentation", {}, { current_stage: "presentation" }],
    ["Dana while the attempt is still on Prospecting", {}, { current_stage: "prospecting" }],
    ["Dr. Kim on a completed attempt", { persona: "tempo_objections" }, { status: "completed", current_stage: "results" }],
  ])("403 for %s: no model call, a generic message", async (_name, changes, attempt) => {
    state.attempt = { ...state.attempt, ...attempt };
    const res = await callTurn(changes);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This call is not open on your attempt." });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("403 for a stage already completed (its score is saved), even with current_stage still on it", async () => {
    state.stageScore = { id: "score-1" };
    const res = await callTurn();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This call is not open on your attempt." });
    expect(state.queries).toEqual(STAGE_QUERIES("discovery"));
    expect(state.create).not.toHaveBeenCalled();
  });

  it("Dr. Kim on Objection Handling: the turn runs, and the score check is for that stage", async () => {
    state.attempt = { ...state.attempt, current_stage: "objections" };
    const res = await callTurn({ persona: "tempo_objections" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "Sure, go ahead.", label: "normal" });
    expect(state.queries).toEqual(STAGE_QUERIES("objections"));
  });

  it("the stage score lookup fails: a generic 500, logged on the server, no model call", async () => {
    state.stageScoreError = { message: "secret internal detail", code: "XX000" };
    const res = await callTurn();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Could not generate a reply." });
    expect(text).not.toContain("secret");
    expect(console.error).toHaveBeenCalledWith("[call-turn] stage score lookup failed:", state.stageScoreError);
    expect(state.create).not.toHaveBeenCalled();
  });

  it("the local test bypass on (?teststage= jumps): any stage's call runs, with no stage check", async () => {
    vi.stubEnv("TEMPO_TEST_BYPASS_GATES", "true");
    state.attempt = { ...state.attempt, current_stage: "presentation" };
    const res = await callTurn({ persona: "tempo_objections" });
    expect(res.status).toBe(200);
    expect(state.queries).toEqual([{ table: "attempts", eqs: [["id", "attempt-1"], ["student_id", "student-1"]] }]);
  });

  it("from the backstop on: an empty reply, endCall and endReason \"backstop\", with no model call", async () => {
    const res = await callTurn({ callSeconds: 1080 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "", endCall: true, endReason: "backstop" });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("never returns OpenAI's or Supabase's error text", async () => {
    // OpenAI fails: the brain's fallback line, nothing of the error.
    state.label = new Error("secret internal detail");
    state.reply = new Error("secret internal detail");
    const modelDown = await callTurn();
    expect(modelDown.status).toBe(200);
    const modelBody = await modelDown.text();
    expect(JSON.parse(modelBody)).toEqual({ reply: "Sorry, could you say that again?", label: "normal" });
    expect(modelBody).not.toContain("secret");

    // The attempt lookup reports an error: a plain 404.
    state.attemptError = { message: "secret internal detail", code: "XX000" };
    const lookupError = await callTurn();
    expect(lookupError.status).toBe(404);
    expect(await lookupError.text()).not.toContain("secret");

    // Something throws: a generic 500.
    state.attemptError = null;
    state.isLookupThrowing = true;
    const thrown = await callTurn();
    expect(thrown.status).toBe(500);
    const thrownBody = await thrown.text();
    expect(JSON.parse(thrownBody)).toEqual({ error: "Could not generate a reply." });
    expect(thrownBody).not.toContain("secret");
  });
});
