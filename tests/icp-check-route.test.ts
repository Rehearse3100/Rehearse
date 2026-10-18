/**
 * icp-check-route.test.ts
 * /api/student/icp-check against a fake database and a mocked OpenAI client (no
 * network, no live database): step A then step B with the right models and
 * settings, the saved record shape, a note naming a directory company or the real
 * range falling back to the code-built note, step A failing as "ungraded" without
 * blocking, a graded ICP never re-graded, responses that never carry the score,
 * band or criteria, GET and PATCH, and an incomplete ICP refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "@/app/api/student/icp-check/route";
import { TEMPO_ICP_NOTE_COPY } from "@/lib/tempo-icp-criteria";

// ── Fakes ───

type Query = {
  table: string;
  op: "select" | "update";
  values?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
};

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  stageData: {} as Record<string, unknown>,
  companyNames: [] as string[],
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

vi.mock("@/lib/revalidate-student-progress", () => ({
  revalidateStudentAttemptSurfaces: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const query: Query = { table, op: "select", eqs: [] };
      state.queries.push(query);
      const result = (): { data: unknown; error: null } => {
        if (table === "attempts" && query.op === "update") {
          state.stageData = (query.values?.stage_data ?? {}) as Record<string, unknown>;
          return { data: null, error: null };
        }
        if (table === "attempts") {
          return {
            data: { id: "attempt-1", student_id: "student-1", stage_data: state.stageData, class_id: "class-1", simulation_id: "sim-1" },
            error: null,
          };
        }
        return { data: state.companyNames.map((company_name) => ({ company_name })), error: null };
      };
      const builder = {
        select() {
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
        single() {
          return Promise.resolve(result());
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

// ── Fixtures ───

const FIELDS = {
  icpTargetVerticals: "Multi-location dental and veterinary groups",
  icpDecisionMakerRole: "Director of Operations who owns scheduling",
  icpSizeMinLocations: "3",
  icpSizeMaxLocations: "10",
  icpOperationalSignals: "Still books by phone; recently opened a new location",
  icpDisqualifier1: "Locked into a scheduling vendor contract",
  icpDisqualifier2: "Corporate vendor mandate",
  icpDisqualifier3: "",
};

const GRADE_REPLY = JSON.stringify({
  industry: { verdict: "met", evidence: "Multi-location dental and veterinary groups", gap: "" },
  decision_maker: { verdict: "met", evidence: "Director of Operations", gap: "" },
  signals: { verdict: "met", evidence: "Still books by phone", gap: "" },
  // Not in the student's text: downgraded to partial.
  disqualifiers: { verdict: "met", evidence: "spending freeze", gap: "Add a second hard walk-away rule." },
});

const words = (count: number): string => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
const GOOD_NOTE = `You wrote "Director of Operations who owns scheduling", which is exactly who to call. ${words(70)} What would make you walk away?`;

const reply = (content: string): { choices: Array<{ message: { content: string } }> } => ({ choices: [{ message: { content } }] });

const post = (body: unknown): Promise<Response> =>
  POST(new Request("http://localhost/api/student/icp-check", { method: "POST", body: JSON.stringify(body) }));

const savedIcp = (): Record<string, unknown> => state.stageData.icp as Record<string, unknown>;

beforeEach(() => {
  state.queries = [];
  state.stageData = { currentStepId: "icp", otherKey: "kept" };
  state.companyNames = ["Summit Dental Group", "Peak Vision Partners"];
  state.create.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
});

describe("POST: grade once, then the note", () => {
  it("step A (gpt-4o, temperature 0, strict JSON schema) then step B (gpt-4o, 0.4); saves the full record", async () => {
    state.create.mockResolvedValueOnce(reply(GRADE_REPLY)).mockResolvedValueOnce(reply(GOOD_NOTE));
    const res = await post({ attemptId: "attempt-1", icpText: "ignored", fields: FIELDS });
    expect(res.status).toBe(200);

    const [gradeCall, noteCall] = state.create.mock.calls.map((call) => call[0]);
    expect(gradeCall).toMatchObject({ model: "gpt-4o", temperature: 0, response_format: { type: "json_schema" } });
    expect(gradeCall.response_format.json_schema.strict).toBe(true);
    expect(noteCall).toMatchObject({ model: "gpt-4o", temperature: 0.4 });
    expect(noteCall.response_format).toBeUndefined();

    const icp = savedIcp();
    expect(Object.keys(icp).sort()).toEqual(
      ["band", "criteria", "feedbackSeen", "fields", "gradedAt", "note", "rubricVersion", "score", "status"].sort()
    );
    expect(icp).toMatchObject({
      rubricVersion: "tempo-icp-v1",
      fields: FIELDS,
      status: "graded",
      note: GOOD_NOTE,
      feedbackSeen: false,
      // 20 + 15 + 15 (3–10 is met) + 25 + 12.5 (disqualifiers downgraded) = 87.5
      score: 87.5,
      band: "strong",
    });
    expect((icp.criteria as Array<{ id: string; verdict: string }>).map((c) => [c.id, c.verdict])).toEqual([
      ["industry", "met"],
      ["decision_maker", "met"],
      ["size", "met"],
      ["signals", "met"],
      ["disqualifiers", "partial"],
    ]);
    expect(state.stageData.otherKey).toBe("kept");
  });

  it("the response carries only the note and its state: no score, band or criteria", async () => {
    state.create.mockResolvedValueOnce(reply(GRADE_REPLY)).mockResolvedValueOnce(reply(GOOD_NOTE));
    const body = (await (await post({ attemptId: "attempt-1", fields: FIELDS })).json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "graded", note: GOOD_NOTE, feedbackSeen: false });
    expect(JSON.stringify(body)).not.toMatch(/score|band|criteria|87\.5/);
  });

  it.each([
    ["a directory company name", `${GOOD_NOTE} Look at accounts like Summit Dental Group.`],
    ["the real range", `${words(90)} Aim for 3-12 locations.`],
    ["a territory city", `${words(90)} Start in Denver.`],
    ["too few words", "Nice work."],
  ])("a note with %s falls back to the code-built note", async (_label, badNote) => {
    state.create.mockResolvedValueOnce(reply(GRADE_REPLY)).mockResolvedValueOnce(reply(badNote));
    const body = (await (await post({ attemptId: "attempt-1", fields: FIELDS })).json()) as { note: string };
    expect(body.note).not.toBe(badNote);
    expect(body.note).toContain(TEMPO_ICP_NOTE_COPY.fallback.closing);
    expect(body.note).toContain("Add a second hard walk-away rule.");
    expect(body.note).not.toMatch(/Summit Dental Group|3-12|Denver/);
    expect(savedIcp()).toMatchObject({ status: "graded", note: body.note });
  });

  it("step B failing also uses the fallback note; the grade is kept", async () => {
    state.create.mockResolvedValueOnce(reply(GRADE_REPLY)).mockRejectedValueOnce(new Error("timeout"));
    const body = (await (await post({ attemptId: "attempt-1", fields: FIELDS })).json()) as { status: string; note: string };
    expect(body.status).toBe("graded");
    expect(body.note).toContain(TEMPO_ICP_NOTE_COPY.fallback.closing);
    expect(savedIcp().score).toBe(87.5);
  });

  it("step A failing: saved as ungraded with the encouraging note, no score, and the student isn't blocked", async () => {
    state.create.mockRejectedValueOnce(new Error("rate limited"));
    const res = await post({ attemptId: "attempt-1", fields: FIELDS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ungraded", note: TEMPO_ICP_NOTE_COPY.ungradedNote, feedbackSeen: false });
    expect(savedIcp()).toMatchObject({ status: "ungraded", score: null, band: null, criteria: [], fields: FIELDS });
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it("an unreadable grading reply or no API key is ungraded too", async () => {
    state.create.mockResolvedValueOnce(reply("{\"industry\": {}}"));
    expect(((await (await post({ attemptId: "attempt-1", fields: FIELDS })).json()) as { status: string }).status).toBe("ungraded");
    state.stageData = {};
    delete process.env.OPENAI_API_KEY;
    expect(((await (await post({ attemptId: "attempt-1", fields: FIELDS })).json()) as { status: string }).status).toBe("ungraded");
    expect(state.create).toHaveBeenCalledTimes(1);
  });

  it("a second POST returns the graded record without grading again", async () => {
    state.create.mockResolvedValueOnce(reply(GRADE_REPLY)).mockResolvedValueOnce(reply(GOOD_NOTE));
    await post({ attemptId: "attempt-1", fields: FIELDS });
    const saved = JSON.stringify(savedIcp());
    const again = await post({ attemptId: "attempt-1", fields: { ...FIELDS, icpTargetVerticals: "Something else entirely" } });
    expect(await again.json()).toEqual({ status: "graded", note: GOOD_NOTE, feedbackSeen: false });
    expect(state.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(savedIcp())).toBe(saved);
  });

  it("refuses an incomplete ICP or a missing attempt id", async () => {
    expect((await post({ attemptId: "attempt-1", fields: { ...FIELDS, icpOperationalSignals: "short" } })).status).toBe(400);
    expect((await post({ fields: FIELDS })).status).toBe(400);
    expect((await post({ attemptId: "attempt-1" })).status).toBe(400);
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("GET and PATCH", () => {
  const graded = {
    rubricVersion: "tempo-icp-v1",
    fields: FIELDS,
    criteria: [{ id: "industry", verdict: "met", evidence: "dental", gap: "", points: 20 }],
    score: 64,
    band: "developing",
    note: "Saved note.",
    status: "graded",
    gradedAt: "2026-10-18T00:00:00.000Z",
    feedbackSeen: false,
  };

  it("GET returns only the note and its state (null before a review)", async () => {
    state.stageData = { icp: graded };
    const res = await GET(new Request("http://localhost/api/student/icp-check?attemptId=attempt-1"));
    expect(await res.json()).toEqual({ icp: { status: "graded", note: "Saved note.", feedbackSeen: false } });
    state.stageData = {};
    expect(await (await GET(new Request("http://localhost/api/student/icp-check?attemptId=attempt-1"))).json()).toEqual({ icp: null });
  });

  it("GET reads an old pass/fail record without crashing", async () => {
    state.stageData = { icp: { originalText: "x", result: "affirmed", displayText: "Solid filter.", activeIcpText: "x", feedbackSeen: true } };
    const res = await GET(new Request("http://localhost/api/student/icp-check?attemptId=attempt-1"));
    expect(await res.json()).toEqual({ icp: { status: "ungraded", note: "Solid filter.", feedbackSeen: true } });
  });

  it("PATCH marks the note seen and keeps the grade; the response has no score", async () => {
    state.stageData = { icp: graded, otherKey: "kept" };
    const res = await PATCH(
      new Request("http://localhost/api/student/icp-check", { method: "PATCH", body: JSON.stringify({ attemptId: "attempt-1", feedbackSeen: true }) })
    );
    expect(await res.json()).toEqual({ icp: { status: "graded", note: "Saved note.", feedbackSeen: true } });
    expect(savedIcp()).toMatchObject({ score: 64, band: "developing", feedbackSeen: true });
    expect(state.stageData.otherKey).toBe("kept");
  });
});
