/**
 * tempo-handoff-delivery.test.ts
 * The Tempo manager handoffs (lib/server/tempo-handoffs.ts) stay on the server, and
 * the simulation page (app/student/simulation/[id]/page.tsx) hands each stage only
 * the messages it shows: Stage 1 its own, plus Discovery's only once Stage 1 has
 * been submitted; Discovery, Presentation and Objections their own plus the next
 * stage's brief; Negotiation its own. No "use client" file reaches the module, and
 * no client-reachable file holds the handoff text. Fake database, mocked session and
 * navigation; no network, no live database.
 */

import * as React from "react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentSimulationPage from "@/app/student/simulation/[id]/page";
import { DiscoveryStage } from "@/components/tempo/stages/DiscoveryStage";
import { NegotiationStage } from "@/components/tempo/stages/NegotiationStage";
import { ObjectionHandlingStage } from "@/components/tempo/stages/ObjectionHandlingStage";
import { PresentationStage } from "@/components/tempo/stages/PresentationStage";
import { ProspectingWizard } from "@/components/tempo/stages/ProspectingWizard";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";
import { TEMPO_HANDOFF_MESSAGES } from "@/lib/server/tempo-handoffs";
import type { TempoHandoffStageKey } from "@/lib/tempo-prospecting";
import { PROJECT_ROOT, clientEntryFiles, clientReachableFiles } from "./helpers/client-import-graph";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

// ── Fakes ───

const state = vi.hoisted(() => ({
  /** Rows by table for the fake database (every query on a table gets these). */
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

const STAGES: TempoHandoffStageKey[] = ["prospecting", "discovery", "presentation", "objections", "negotiation"];

/** Sets up an in-progress Tempo attempt at a stage, with its stage_data and scored stages. */
function attemptAt(currentStage: string, stageData: Record<string, unknown>, scoredStages: string[]): void {
  state.tables = {
    student_classes: { id: "enrollment-1" },
    classes: { name: "Rehearse Essentials" },
    class_simulations: {
      simulation_id: TEMPO_SIMULATION_ID,
      simulations: { id: TEMPO_SIMULATION_ID, title: "Tempo: Your First Deal", is_published: true },
    },
    attempts: [
      {
        id: "attempt-1",
        status: "in_progress",
        current_stage: currentStage,
        stage_data: stageData,
        started_at: "2026-11-01T10:00:00.000Z",
      },
    ],
    stage_scores: scoredStages.map((stage) => ({ stage, score: 80, attempt_id: "attempt-1" })),
    crm_log_entries: [],
  };
}

/** The stage element the page renders (inside the CRM wrapper). */
async function renderedStage(): Promise<React.ReactElement<Record<string, unknown>>> {
  const page = (await StudentSimulationPage({
    params: { id: TEMPO_SIMULATION_ID },
    searchParams: { classId: DEFAULT_CLASS_ID },
  })) as React.ReactElement<{ children: React.ReactElement<Record<string, unknown>> }>;
  return page.props.children;
}

/** Which handoff messages appear anywhere in the props the page gives the stage. */
function handoffsInProps(stage: React.ReactElement<Record<string, unknown>>): TempoHandoffStageKey[] {
  const props = JSON.stringify(stage.props);
  return STAGES.filter((key) => props.includes(JSON.stringify(TEMPO_HANDOFF_MESSAGES[key]).slice(1, -1)));
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

// ── What each stage receives ───

describe("the handoff messages the page sends each stage", () => {
  it("Stage 1 before submit: its own message only, no Discovery message", async () => {
    attemptAt("lead_gen", {}, []);
    const stage = await renderedStage();
    expect(stage.type).toBe(ProspectingWizard);
    expect(stage.props.prospectingHandoffMessage).toBe(TEMPO_HANDOFF_MESSAGES.prospecting);
    expect(stage.props.discoveryHandoffMessage).toBeNull();
    expect(handoffsInProps(stage)).toEqual(["prospecting"]);
  });

  it("Stage 1 submitted, Discovery handoff not yet accepted: plus the Discovery message", async () => {
    attemptAt("discovery", {}, ["prospecting"]);
    const stage = await renderedStage();
    expect(stage.type).toBe(ProspectingWizard);
    expect(stage.props.discoveryHandoffMessage).toBe(TEMPO_HANDOFF_MESSAGES.discovery);
    expect(handoffsInProps(stage)).toEqual(["prospecting", "discovery"]);
  });

  it("Discovery: its own and Presentation's", async () => {
    attemptAt("discovery", { discoveryHandoffSeen: true }, ["prospecting"]);
    const stage = await renderedStage();
    expect(stage.type).toBe(DiscoveryStage);
    expect(stage.props.handoffMessage).toBe(TEMPO_HANDOFF_MESSAGES.discovery);
    expect(stage.props.nextHandoffMessage).toBe(TEMPO_HANDOFF_MESSAGES.presentation);
    expect(handoffsInProps(stage)).toEqual(["discovery", "presentation"]);
  });

  it("Presentation: its own and Objections'", async () => {
    attemptAt("presentation", { discoveryHandoffSeen: true }, ["prospecting", "discovery"]);
    const stage = await renderedStage();
    expect(stage.type).toBe(PresentationStage);
    expect(handoffsInProps(stage)).toEqual(["presentation", "objections"]);
  });

  it("Objection Handling: its own and Negotiation's", async () => {
    attemptAt("objections", { discoveryHandoffSeen: true }, ["prospecting", "discovery", "presentation"]);
    const stage = await renderedStage();
    expect(stage.type).toBe(ObjectionHandlingStage);
    expect(handoffsInProps(stage)).toEqual(["objections", "negotiation"]);
  });

  it("Negotiation: its own only", async () => {
    attemptAt("close", { discoveryHandoffSeen: true }, ["prospecting", "discovery", "presentation", "objections"]);
    const stage = await renderedStage();
    expect(stage.type).toBe(NegotiationStage);
    expect(stage.props.handoffMessage).toBe(TEMPO_HANDOFF_MESSAGES.negotiation);
    expect(handoffsInProps(stage)).toEqual(["negotiation"]);
  });
});

// ── Server only ───

describe("the handoff messages stay on the server", () => {
  it("the module refuses to load where a browser window exists", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    try {
      await expect(import("@/lib/server/tempo-handoffs")).rejects.toThrow(/server-only/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("no \"use client\" file reaches lib/server/tempo-handoffs.ts, and none holds the handoff text", () => {
    expect(clientEntryFiles().length).toBeGreaterThan(20);
    const reachable = clientReachableFiles();
    expect(reachable.has(path.join(PROJECT_ROOT, "lib", "server", "tempo-handoffs.ts"))).toBe(false);
    // Phrases found only in the handoffs (the stage layouts' own scenario text is a
    // separate, known item: docs/security-notes.md).
    const markers = [
      "showing real buying signals",
      "has agreed to a 15-minute discovery call",
      "straining a manual phone-based scheduling setup",
      "no-shows run about 1 in 6",
      "wants a call before he signs off",
      "They want Pro across all 8 locations",
    ];
    for (const file of Array.from(reachable)) {
      const source = readFileSync(file, "utf8");
      for (const marker of markers) {
        expect(source.includes(marker), `${path.relative(PROJECT_ROOT, file)}: ${marker}`).toBe(false);
      }
    }
    // The simulation page is the module's reader.
    const pageSource = readFileSync(path.join(PROJECT_ROOT, "app", "student", "simulation", "[id]", "page.tsx"), "utf8");
    expect(pageSource).toContain('from "@/lib/server/tempo-handoffs"');
  });

  it("the Stage 1 files fixed on 2026-11-08 name neither the target account nor its contacts", () => {
    // The opening-message step shows the student's own chosen lead (from the CRM), the
    // stage descriptions say "the account", and the tester autofill is generic.
    const files = [
      "components/tempo/stages/ProspectingStepPanels.tsx",
      "components/tempo/stages/ProspectingWizard.tsx",
      "lib/tempo-simulation.ts",
      "lib/tempo-test-bypass-client.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(PROJECT_ROOT, file), "utf8");
      for (const name of ["Summit", "Dana", "Saul Kim", "Dr. Kim", "Reyes"]) {
        expect(source.includes(name), `${file}: ${name}`).toBe(false);
      }
    }
  });
});
