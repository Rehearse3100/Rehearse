/**
 * badge-grading-routes.test.ts
 * POST /api/student/grade-badges and the badge branch of POST /api/student/complete-stage,
 * against a fake database client. Auth, OpenAI grading, and lead conversion are mocked;
 * nothing touches the network or the live database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as completeStageRoute } from "@/app/api/student/complete-stage/route";
import { POST as gradeBadges } from "@/app/api/student/grade-badges/route";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";
import { detectTempoBadges } from "@/lib/tempo-badges";

// ── Fake database client (records every query) ───

type Query = {
  table: string;
  op: "select" | "update" | "upsert";
  values?: Record<string, unknown>;
  columns?: string;
  eqs: Array<[string, unknown]>;
  or?: string;
};

type Responder = (query: Query) => { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
  queries: [] as Query[],
  respond: (() => ({ data: null, error: null })) as Responder,
  serviceClientCalls: 0,
}));

/**
 * Chainable stand-in for the query builder; awaiting or maybeSingle() resolves
 * through the current test's responder.
 */
function createFakeClient(): unknown {
  return {
    from(table: string) {
      const query: Query = { table, op: "select", eqs: [] };
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
        upsert(values: Record<string, unknown>) {
          query.op = "upsert";
          query.values = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eqs.push([column, value]);
          return builder;
        },
        or(filter: string) {
          query.or = filter;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(state.respond(query));
        },
        single() {
          return Promise.resolve(state.respond(query));
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(state.respond(query)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => {
    state.serviceClientCalls += 1;
    return createFakeClient();
  },
}));

vi.mock("@/lib/tempo-lead-conversion", () => ({
  convertLead: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/tempo-badges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tempo-badges")>()),
  detectTempoBadges: vi.fn(async () => ["pres_roi_quantified"]),
}));

const TEMPO_ATTEMPT = {
  id: "attempt-1",
  student_id: "student-1",
  stage_data: {},
  class_id: DEFAULT_CLASS_ID,
  simulation_id: TEMPO_SIMULATION_ID,
  simulations: { title: "Tempo" },
};

const LEGACY_ATTEMPT = {
  ...TEMPO_ATTEMPT,
  class_id: "another-class",
  simulations: { title: "Legacy Sales Call" },
};

/** POST request with a JSON body. */
function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Finds the recorded query for a table/op, optionally filtered by a predicate. */
function findQuery(table: string, op: Query["op"], match?: (query: Query) => boolean): Query {
  const found = state.queries.find(
    (query) => query.table === table && query.op === op && (!match || match(query))
  );
  if (!found) {
    throw new Error(`No ${op} on ${table}`);
  }
  return found;
}

beforeEach(() => {
  state.queries = [];
  state.serviceClientCalls = 0;
  vi.mocked(detectTempoBadges).mockReset();
  vi.mocked(detectTempoBadges).mockResolvedValue(["pres_roi_quantified"]);
});

// ── grade-badges ───

describe("POST /api/student/grade-badges", () => {
  it("returns 400 for a bad stage without touching the database", async () => {
    const res = await gradeBadges(
      jsonRequest("http://x/api/student/grade-badges", { attemptId: "attempt-1", stage: "lead_gen" })
    );
    expect(res.status).toBe(400);
    expect(state.serviceClientCalls).toBe(0);
  });

  it("grades from the saved submission and ignores transcript/badges sent by the browser", async () => {
    state.respond = (query) => {
      if (query.table === "attempts") {
        return { data: TEMPO_ATTEMPT, error: null };
      }
      if (query.op === "update" && query.values?.badges_status === "grading") {
        return { data: [{ transcript: "SAVED SUBMISSION" }], error: null };
      }
      return { data: null, error: null };
    };

    const res = await gradeBadges(
      jsonRequest("http://x/api/student/grade-badges", {
        attemptId: "attempt-1",
        stage: "presentation",
        transcript: "FORGED BY BROWSER",
        badges: ["pres_proof_point"],
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done", badges: ["pres_roi_quantified"] });
    expect(detectTempoBadges).toHaveBeenCalledWith("presentation", "SAVED SUBMISSION", null, null);

    const claim = findQuery("stage_scores", "update", (q) => q.values?.badges_status === "grading");
    expect(claim.eqs).toEqual([
      ["attempt_id", "attempt-1"],
      ["stage", "presentation"],
    ]);
    expect(claim.or).toMatch(/^badges_status\.eq\.pending,and\(badges_status\.eq\.grading,badges_claimed_at\.lte\./);

    const save = findQuery("stage_scores", "update", (q) => q.values?.badges_status === "done");
    expect(save.values).toEqual({ badges_earned: ["pres_roi_quantified"], badges_status: "done" });
    expect(save.eqs).toEqual([
      ["attempt_id", "attempt-1"],
      ["stage", "presentation"],
      ["badges_claim_id", claim.values?.badges_claim_id],
      ["badges_status", "grading"],
    ]);
    expect(typeof claim.values?.badges_claim_id).toBe("string");
  });

  it("does not grade again when the row is not claimable; reports the current row", async () => {
    state.respond = (query) => {
      if (query.table === "attempts") {
        return { data: TEMPO_ATTEMPT, error: null };
      }
      if (query.op === "update") {
        return { data: [], error: null };
      }
      return { data: { badges_status: "grading", badges_earned: [] }, error: null };
    };

    const res = await gradeBadges(
      jsonRequest("http://x/api/student/grade-badges", { attemptId: "attempt-1", stage: "close" })
    );
    expect(await res.json()).toEqual({ status: "grading", badges: [] });
    expect(detectTempoBadges).not.toHaveBeenCalled();
  });

  it("saves no badges and status done when grading throws after the claim", async () => {
    vi.mocked(detectTempoBadges).mockRejectedValueOnce(new Error("OpenAI down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.respond = (query) => {
      if (query.table === "attempts") {
        return { data: TEMPO_ATTEMPT, error: null };
      }
      if (query.op === "update" && query.values?.badges_status === "grading") {
        return { data: [{ transcript: "{}" }], error: null };
      }
      return { data: null, error: null };
    };

    const res = await gradeBadges(
      jsonRequest("http://x/api/student/grade-badges", { attemptId: "attempt-1", stage: "presentation" })
    );
    expect(await res.json()).toEqual({ status: "done", badges: [] });
    const save = findQuery("stage_scores", "update", (q) => q.values?.badges_status === "done");
    expect(save.values).toEqual({ badges_earned: [], badges_status: "done" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 404 for a non-Tempo attempt and never claims", async () => {
    state.respond = (query) =>
      query.table === "attempts"
        ? { data: LEGACY_ATTEMPT, error: null }
        : { data: null, error: null };

    const res = await gradeBadges(
      jsonRequest("http://x/api/student/grade-badges", { attemptId: "attempt-1", stage: "close" })
    );
    expect(res.status).toBe(404);
    expect(state.queries.some((query) => query.op === "update")).toBe(false);
  });
});

// ── complete-stage badge branch ───

describe("POST /api/student/complete-stage", () => {
  const BODY = {
    attemptId: "attempt-1",
    stage: "presentation",
    score: 0,
    feedback: "Submitted — scoring coming soon",
    transcript: "{\"form\":{}}",
  };

  /** Responds like the database for a normal save. */
  function respondForAttempt(attempt: unknown, upsertError: unknown = null): Responder {
    return (query) => {
      if (query.table === "attempts" && query.op === "select") {
        return { data: attempt, error: null };
      }
      if (query.table === "stage_scores" && query.op === "upsert") {
        return { data: null, error: upsertError };
      }
      if (query.table === "stage_scores" && query.op === "select") {
        return { data: [{ score: 0 }], error: null };
      }
      return { data: null, error: null };
    };
  }

  it("Tempo: skips inline grading, saves pending, and replies with badgesPending", async () => {
    state.respond = respondForAttempt(TEMPO_ATTEMPT);
    const res = await completeStageRoute(jsonRequest("http://x/api/student/complete-stage", BODY));

    expect(await res.json()).toEqual({ nextStage: "objections", totalScore: 0, badgesPending: true });
    expect(detectTempoBadges).not.toHaveBeenCalled();
    expect(findQuery("stage_scores", "upsert").values).toEqual({
      attempt_id: "attempt-1",
      stage: "presentation",
      score: 0,
      feedback: BODY.feedback,
      transcript: BODY.transcript,
      badges_earned: [],
      badges_status: "pending",
      badges_claimed_at: null,
      badges_claim_id: null,
    });
    expect(findQuery("attempts", "update").values).toEqual({
      current_stage: "objections",
      total_score: 0,
    });
  });

  it("Legacy: grades inline as today and saves exactly the old row (no new columns)", async () => {
    state.respond = respondForAttempt(LEGACY_ATTEMPT);
    const res = await completeStageRoute(jsonRequest("http://x/api/student/complete-stage", BODY));

    expect(await res.json()).toEqual({ nextStage: "objections", totalScore: 0 });
    expect(detectTempoBadges).toHaveBeenCalledWith("presentation", BODY.transcript, null, null);
    expect(findQuery("stage_scores", "upsert").values).toEqual({
      attempt_id: "attempt-1",
      stage: "presentation",
      score: 0,
      feedback: BODY.feedback,
      transcript: BODY.transcript,
      badges_earned: ["pres_roi_quantified"],
    });
  });

  it("returns the existing 500 and does not advance when the save fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.respond = respondForAttempt(TEMPO_ATTEMPT, { message: "insert failed" });
    const res = await completeStageRoute(jsonRequest("http://x/api/student/complete-stage", BODY));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not save stage progress." });
    expect(state.queries.some((q) => q.table === "attempts" && q.op === "update")).toBe(false);
    errorSpy.mockRestore();
  });
});
