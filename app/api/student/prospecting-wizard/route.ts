/**
 * prospecting-wizard/route.ts
 * Loads and saves Tempo Stage 1 wizard draft state on attempts.stage_data.
 * Student JWT session required; uses service role for DB access.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import {
  normalizeProspectingWizardState,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";
import { isGateBypassEnabled, prepareTempoTestBypass } from "@/lib/tempo-test-bypass";
import { revalidateStudentAttemptSurfaces } from "@/lib/revalidate-student-progress";
import { createServiceClient } from "@/lib/supabase/server";

type SaveBody = {
  attemptId?: string;
  state?: ProspectingWizardState;
};

/**
 * GET /api/student/prospecting-wizard?attemptId=...
 * Returns saved wizard state or defaults. When TEMPO_TEST_BYPASS_GATES=true,
 * empty fields are auto-filled server-side and gateBypassEnabled is reported.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  const attemptId = new URL(request.url).searchParams.get("attemptId")?.trim() ?? "";
  if (!attemptId) {
    return NextResponse.json({ error: "Missing attemptId." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: attempt, error } = await supabase
    .from("attempts")
    .select("id, student_id, stage_data, simulation_id, class_id")
    .eq("id", attemptId)
    .eq("student_id", auth.session.studentId)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }

  const gateBypassEnabled = isGateBypassEnabled();
  const saved = attempt.stage_data as ProspectingWizardState | null;
  let state = normalizeProspectingWizardState(saved);

  if (gateBypassEnabled) {
    const prepared = await prepareTempoTestBypass(
      supabase,
      attemptId,
      String(attempt.simulation_id ?? ""),
      state
    );
    state = prepared.state;
    if (prepared.didPersist) {
      const existing = (attempt.stage_data ?? {}) as Record<string, unknown>;
      const { error: persistError } = await supabase
        .from("attempts")
        .update({ stage_data: { ...existing, ...state } })
        .eq("id", attemptId);
      if (persistError) {
        console.error("[prospecting-wizard] bypass persist failed:", persistError);
      } else {
        revalidateStudentAttemptSurfaces({
          classId: (attempt.class_id as string | null) ?? null,
          simulationId: (attempt.simulation_id as string | null) ?? null,
        });
      }
    }
  }

  return NextResponse.json({ state, gateBypassEnabled });
}

/**
 * POST /api/student/prospecting-wizard
 * Persists wizard draft state to attempts.stage_data.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as SaveBody;
    const attemptId = body.attemptId?.trim() ?? "";
    const state = body.state;

    if (!attemptId || !state) {
      return NextResponse.json({ error: "Missing attemptId or state." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: attempt } = await supabase
      .from("attempts")
      .select("id, student_id, stage_data, class_id, simulation_id")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const existing = (attempt.stage_data ?? {}) as Record<string, unknown>;
    const normalized = normalizeProspectingWizardState(state);
    const existingDirectoryIds = Array.isArray(existing.directoryCompanyIds)
      ? existing.directoryCompanyIds.filter((id): id is string => typeof id === "string")
      : [];
    const merged = {
      ...existing,
      ...normalized,
      directoryCompanyIds:
        normalized.directoryCompanyIds.length > 0
          ? normalized.directoryCompanyIds
          : existingDirectoryIds,
    };

    const { error: updateError } = await supabase
      .from("attempts")
      .update({ stage_data: merged })
      .eq("id", attemptId);

    if (updateError) {
      console.error("[prospecting-wizard] save", updateError);
      return NextResponse.json({ error: "Could not save draft." }, { status: 500 });
    }

    revalidateStudentAttemptSurfaces({
      classId: (attempt.class_id as string | null) ?? null,
      simulationId: (attempt.simulation_id as string | null) ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[prospecting-wizard] unexpected", err);
    return NextResponse.json({ error: "Could not save draft." }, { status: 500 });
  }
}
