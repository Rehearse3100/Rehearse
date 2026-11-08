/**
 * leaderboard-by-attempt.test.ts
 * The results page (app/student/simulation/[id]/complete/page.tsx) decides the
 * leaderboard from the student's verified ?attempt=, never from the URL: a URL id
 * for another simulation goes back to the dashboard and never shows that
 * simulation's rows; a matching URL shows only the attempt's simulation. Fake
 * database (filters applied in memory), mocked session and navigation; no network,
 * no live database.
 */

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SimulationCompletePage from "@/app/student/simulation/[id]/complete/page";
import { StudentLeaderboard } from "@/components/StudentLeaderboard";
import { TempoSimulationResultsView } from "@/components/tempo/TempoSimulationResultsView";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";
import type { LeaderboardEntry } from "@/types";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

// ── Fakes ───

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  /** Rows by table; each query keeps the rows matching its .eq() filters. */
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Every .eq() filter applied to the attempts table, in order. */
  attemptFilters: [] as Array<[string, unknown]>,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/student/dashboard",
}));

vi.mock("@/lib/student-session", () => ({
  getStudentSession: vi.fn(async () => ({ studentId: "student-1", displayName: "Sam Student" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const matching = (): Row[] =>
        (state.tables[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          if (table === "attempts") state.attemptFilters.push([column, value]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        single: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: matching(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

const LEGACY_SIMULATION_ID = "11111111-1111-1111-1111-111111111111";

/** A completed attempt with the leaderboard's joined student name. */
function completedAttempt(
  id: string,
  studentId: string,
  simulationId: string,
  name: string,
  score: number,
  extra: Row = {}
): Row {
  return {
    id,
    student_id: studentId,
    simulation_id: simulationId,
    class_id: simulationId === TEMPO_SIMULATION_ID ? DEFAULT_CLASS_ID : "class-legacy",
    status: "completed",
    total_score: score,
    completed_at: "2026-11-01T12:00:00.000Z",
    started_at: "2026-11-01T11:00:00.000Z",
    students: { display_name: name },
    simulations:
      simulationId === TEMPO_SIMULATION_ID
        ? { id: TEMPO_SIMULATION_ID, title: "Tempo: Your First Deal" }
        : { id: LEGACY_SIMULATION_ID, title: "Legacy Practice" },
    ...extra,
  };
}

beforeEach(() => {
  state.attemptFilters = [];
  state.tables = {
    attempts: [
      // The signed-in student's own attempts, one per simulation.
      completedAttempt("attempt-legacy", "student-1", LEGACY_SIMULATION_ID, "Sam Student", 410),
      completedAttempt("attempt-tempo", "student-1", TEMPO_SIMULATION_ID, "Sam Student", 380),
      // Other students' completed attempts at each simulation.
      completedAttempt("other-tempo", "student-2", TEMPO_SIMULATION_ID, "Tempo Classmate", 500),
      completedAttempt("other-legacy", "student-3", LEGACY_SIMULATION_ID, "Legacy Classmate", 450),
    ],
    student_classes: [{ id: "enrollment-1", student_id: "student-1", class_id: DEFAULT_CLASS_ID }],
    stage_scores: [],
  };
});

/** Finds the first element of a component type in a rendered element tree. */
function findElement<P>(node: unknown, type: unknown): React.ReactElement<P> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement<P>(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node as React.ReactElement<P>;
  return findElement<P>((node.props as { children?: unknown }).children, type);
}

const leaderboardNames = (entries: LeaderboardEntry[]): string[] => entries.map((entry) => entry.student_name);

// ── Mismatched URL ───

describe("a URL id that doesn't match the attempt", () => {
  it("goes back to the dashboard and never queries the URL simulation's leaderboard", async () => {
    // The student's legacy attempt, with the Tempo id in the URL.
    await expect(
      SimulationCompletePage({
        params: { id: TEMPO_SIMULATION_ID },
        searchParams: { attempt: "attempt-legacy", classId: DEFAULT_CLASS_ID },
      })
    ).rejects.toThrow("REDIRECT:/student/dashboard");
    expect(state.attemptFilters).not.toContainEqual(["simulation_id", TEMPO_SIMULATION_ID]);
  });

  it("the other way round too (Tempo attempt, legacy id in the URL)", async () => {
    await expect(
      SimulationCompletePage({
        params: { id: LEGACY_SIMULATION_ID },
        searchParams: { attempt: "attempt-tempo" },
      })
    ).rejects.toThrow("REDIRECT:/student/dashboard");
    expect(state.attemptFilters).not.toContainEqual(["simulation_id", LEGACY_SIMULATION_ID]);
  });

  it("someone else's attempt still goes back to the dashboard (unchanged)", async () => {
    await expect(
      SimulationCompletePage({
        params: { id: TEMPO_SIMULATION_ID },
        searchParams: { attempt: "other-tempo", classId: DEFAULT_CLASS_ID },
      })
    ).rejects.toThrow("REDIRECT:/student/dashboard");
  });
});

// ── Matching URL ───

describe("a URL id that matches the attempt", () => {
  it("Tempo: the leaderboard has only Tempo attempts", async () => {
    const page = await SimulationCompletePage({
      params: { id: TEMPO_SIMULATION_ID },
      searchParams: { attempt: "attempt-tempo", classId: DEFAULT_CLASS_ID },
    });
    const view = findElement<{ leaderboard: LeaderboardEntry[] }>(page, TempoSimulationResultsView);
    expect(view).not.toBeNull();
    expect(leaderboardNames(view!.props.leaderboard)).toEqual(["Tempo Classmate", "Sam Student"]);
    expect(state.attemptFilters).toContainEqual(["simulation_id", TEMPO_SIMULATION_ID]);
  });

  it("legacy: the leaderboard has only that simulation's attempts", async () => {
    const page = await SimulationCompletePage({
      params: { id: LEGACY_SIMULATION_ID },
      searchParams: { attempt: "attempt-legacy" },
    });
    const board = findElement<{ entries: LeaderboardEntry[] }>(page, StudentLeaderboard);
    expect(board).not.toBeNull();
    expect(leaderboardNames(board!.props.entries)).toEqual(["Legacy Classmate", "Sam Student"]);
    expect(state.attemptFilters).not.toContainEqual(["simulation_id", TEMPO_SIMULATION_ID]);
  });
});
