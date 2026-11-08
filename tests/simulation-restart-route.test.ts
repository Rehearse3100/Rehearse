/**
 * simulation-restart-route.test.ts
 * POST /api/student/simulation/restart (app/api/student/simulation/restart/route.ts):
 * since 2026-11-08 restart keeps the attempt's Data Room chat count
 * (data_room_chat_usage), so the 300-question cap isn't reset (the attempt id stays
 * the same). Everything else restart does is unchanged: it clears the stage scores
 * and CRM rows, resets the attempt to lead_gen, and returns the same attempt id. Fake
 * database (records every delete and update), mocked session; no network, no live
 * database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/student/simulation/restart/route";

// ── Fakes ───

type Write = { table: string; kind: "delete" | "update"; payload?: unknown; eqs: Array<[string, unknown]> };

const state = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; kind: "delete" | "update"; payload?: unknown; eqs: Array<[string, unknown]> }>,
  /** The delete error for a table, when a test needs one. */
  deleteErrors: {} as Record<string, { code?: string; message?: string }>,
}));

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      let write: Write | null = null;
      const eqs: Array<[string, unknown]> = [];
      const result = (): { data: unknown; error: unknown } => {
        if (write) {
          return { data: null, error: write.kind === "delete" ? state.deleteErrors[table] ?? null : null };
        }
        if (table === "attempts") {
          return {
            data: { id: "attempt-1", student_id: "student-1", simulation_id: "sim-1", class_id: "class-1", status: "in_progress" },
            error: null,
          };
        }
        return { data: table === "student_classes" ? { id: "enrollment-1" } : null, error: null };
      };
      const builder = {
        select: () => builder,
        delete: () => {
          write = { table, kind: "delete", eqs };
          state.writes.push(write);
          return builder;
        },
        update: (payload: unknown) => {
          write = { table, kind: "update", payload, eqs };
          state.writes.push(write);
          return builder;
        },
        eq: (column: string, value: unknown) => {
          eqs.push([column, value]);
          return builder;
        },
        single: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

async function restart(): Promise<{ status: number; body: unknown }> {
  const response = await POST(
    new Request("http://localhost/api/student/simulation/restart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-1", simulationId: "sim-1", classId: "class-1" }),
    })
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  state.writes = [];
  state.deleteErrors = {};
});

describe("restart", () => {
  it("keeps the Data Room chat count; clears the scores and CRM rows and resets the attempt, as before", async () => {
    expect(await restart()).toEqual({ status: 200, body: { success: true, newAttemptId: "attempt-1" } });
    const deleted = state.writes.filter((write) => write.kind === "delete");
    expect(deleted.map((write) => write.table)).toEqual([
      "stage_scores",
      "crm_log_entries",
      "crm_account_notes",
      "crm_contact_notes",
      "crm_leads",
    ]);
    expect(deleted.every((write) => JSON.stringify(write.eqs) === JSON.stringify([["attempt_id", "attempt-1"]]))).toBe(true);
    expect(state.writes.some((write) => write.table === "data_room_chat_usage")).toBe(false);
    expect(state.writes.filter((write) => write.kind === "update")).toEqual([
      {
        table: "attempts",
        kind: "update",
        payload: {
          current_stage: "lead_gen",
          total_score: 0,
          status: "in_progress",
          completed_at: null,
          stage_data: null,
          lead_selection_attempts: 0,
          student_class_id: "enrollment-1",
        },
        eqs: [["id", "attempt-1"]],
      },
    ]);
  });

  it("a missing crm_leads table still doesn't block it (unchanged)", async () => {
    state.deleteErrors.crm_leads = { code: "PGRST205", message: "Could not find the table" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await restart()).status).toBe(200);
    warnSpy.mockRestore();
  });
});
