/**
 * tester-shortcuts-gate.test.ts
 * The tester shortcuts work only with TEMPO_TEST_BYPASS_GATES=true: the header
 * dropdown (passed down from the student layout as testBypass), ?teststage= on the
 * simulation page, and ?testresults= / ?testbadges=all on the results page. With
 * the flag off they're ignored. Fake database, mocked session and navigation; no
 * network, no live database.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentSimulationPage from "@/app/student/simulation/[id]/page";
import SimulationCompletePage from "@/app/student/simulation/[id]/complete/page";
import { StudentDashboardHeader } from "@/components/student/StudentDashboardHeader";
import { StudentPortalShell } from "@/components/student/StudentPortalShell";
import { TempoSimulationResultsView } from "@/components/tempo/TempoSimulationResultsView";
import { NegotiationStage } from "@/components/tempo/stages/NegotiationStage";
import { ProspectingWizard } from "@/components/tempo/stages/ProspectingWizard";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

// ── Fakes ───

const state = vi.hoisted(() => ({
  /** Rows by table for the fake database. */
  tables: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/student/dashboard",
}));

vi.mock("@/lib/student-session", () => ({
  getStudentSession: vi.fn(async () => ({ studentId: "student-1", displayName: "Sam Student" })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const respond = (): { data: unknown; error: null } => ({ data: state.tables[table] ?? null, error: null });
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
        single: () => Promise.resolve(respond()),
        maybeSingle: () => Promise.resolve(respond()),
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(respond()).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

const setBypass = (on: boolean): void => {
  vi.stubEnv("TEMPO_TEST_BYPASS_GATES", on ? "true" : "");
};

beforeEach(() => {
  state.tables = {
    student_classes: { id: "enrollment-1" },
    classes: { name: "Rehearse Essentials" },
    class_simulations: {
      simulation_id: TEMPO_SIMULATION_ID,
      simulations: { id: TEMPO_SIMULATION_ID, title: "Tempo: Your First Deal", is_published: true },
    },
    // A fresh Tempo attempt still in Prospecting.
    attempts: [
      {
        id: "attempt-1",
        status: "in_progress",
        current_stage: "lead_gen",
        stage_data: {},
        started_at: "2026-10-16T10:00:00.000Z",
      },
    ],
    stage_scores: [],
    crm_log_entries: [],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Dropdown ───

describe("the tester shortcuts dropdown", () => {
  const header = (testBypass: boolean): string =>
    renderToStaticMarkup(
      React.createElement(StudentDashboardHeader, { displayName: "Sam Student", classCount: 1, testBypass })
    );

  it("is hidden when the flag is off and shown when it is on", () => {
    expect(header(false)).not.toContain("Tester settings");
    expect(header(true)).toContain("Tester settings");
    expect(header(true)).toContain("Stage 1 — Prospecting");
  });

  it("the portal shell passes the layout's flag to the header", () => {
    const shell = (testBypass: boolean): string =>
      renderToStaticMarkup(
        React.createElement(StudentPortalShell, {
          displayName: "Sam Student",
          classCount: 1,
          testBypass,
          children: React.createElement("p", null, "page"),
        })
      );
    expect(shell(false)).not.toContain("Tester settings");
    expect(shell(true)).toContain("Tester settings");
  });
});

// ── ?teststage= ───

describe("?teststage= on the simulation page", () => {
  /** The stage component the page renders (inside the CRM wrapper). */
  async function renderedStage(searchParams: Record<string, string>): Promise<unknown> {
    const page = (await StudentSimulationPage({
      params: { id: TEMPO_SIMULATION_ID },
      searchParams: { classId: DEFAULT_CLASS_ID, ...searchParams },
    })) as React.ReactElement<{ children: React.ReactElement }>;
    return page.props.children.type;
  }

  it("is ignored with the flag off: the attempt's real stage renders", async () => {
    setBypass(false);
    expect(await renderedStage({ teststage: "negotiation" })).toBe(ProspectingWizard);
  });

  it("jumps to the stage with the flag on", async () => {
    setBypass(true);
    expect(await renderedStage({ teststage: "negotiation" })).toBe(NegotiationStage);
  });
});

// ── Results previews ───

describe("results previews on the complete page", () => {
  const complete = (searchParams: Record<string, string>): Promise<unknown> =>
    SimulationCompletePage({
      params: { id: TEMPO_SIMULATION_ID },
      searchParams: { classId: DEFAULT_CLASS_ID, ...searchParams },
    });

  it("?testresults= and ?testbadges=all show the mock results with the flag on", async () => {
    setBypass(true);
    const previews: Array<Record<string, string>> = [
      { testresults: "deal_agreed" },
      { testresults: "kim_walked" },
      { testbadges: "all" },
    ];
    for (const params of previews) {
      const page = (await complete(params)) as React.ReactElement<{ children: React.ReactElement }>;
      expect(page.props.children.type, JSON.stringify(params)).toBe(TempoSimulationResultsView);
    }
  });

  it("with the flag off they're ignored: no attempt given → back to the dashboard", async () => {
    setBypass(false);
    const previews: Array<Record<string, string>> = [
      { testresults: "deal_agreed" },
      { testresults: "partial_close" },
      { testbadges: "all" },
    ];
    for (const params of previews) {
      await expect(complete(params), JSON.stringify(params)).rejects.toThrow("REDIRECT:/student/dashboard");
    }
  });
});
