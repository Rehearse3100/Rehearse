/**
 * restart/route.ts
 * Resets the current in-progress attempt — clears stage scores and CRM rows
 * (crm_log_entries, crm_account_notes, crm_contact_notes, crm_leads), then returns
 * the student to lead_gen. A missing crm_leads table doesn't block the restart. The
 * Data Room chat message count (data_room_chat_usage) is kept (2026-11-08): the
 * attempt id stays the same, so the 300-question cap carries over.
 * Called when a student clicks "Restart Simulation".
 * Requires a valid student session cookie.
 *
 * POST body: { attemptId, simulationId, classId }
 * Returns: { success: true, newAttemptId: string }
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { ATTEMPT_STATUS } from "@/lib/constants";
import { createServiceClient } from "@/lib/supabase/server";
import type { RestartSimulationResponse } from "@/types";

type RestartBody = {
  attemptId?: string;
  simulationId?: string;
  classId?: string;
};

/** True when a delete failed only because its table hasn't been created yet. */
function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

/**
 * Clears progress on the current attempt and resets it to the first stage.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as RestartBody;
    const attemptId = body.attemptId?.trim() ?? "";
    const simulationId = body.simulationId?.trim() ?? "";
    const classId = body.classId?.trim() ?? "";

    if (!attemptId || !simulationId || !classId) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, student_id, simulation_id, class_id, status")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    if (attempt.simulation_id !== simulationId) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    if (attempt.class_id && attempt.class_id !== classId) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      return NextResponse.json({ error: "Only in-progress attempts can be restarted." }, { status: 400 });
    }

    const { data: enrollment } = await supabase
      .from("student_classes")
      .select("id")
      .eq("student_id", auth.session.studentId)
      .eq("class_id", classId)
      .maybeSingle();

    const { error: deleteScoresError } = await supabase
      .from("stage_scores")
      .delete()
      .eq("attempt_id", attemptId);

    if (deleteScoresError) {
      console.error("[simulation/restart] delete scores", deleteScoresError);
      return NextResponse.json(
        { error: deleteScoresError.message || "Could not clear stage progress." },
        { status: 500 }
      );
    }

    const { error: deleteCrmLogsError } = await supabase
      .from("crm_log_entries")
      .delete()
      .eq("attempt_id", attemptId);

    if (deleteCrmLogsError) {
      console.error("[simulation/restart] delete crm logs", deleteCrmLogsError);
      return NextResponse.json(
        { error: deleteCrmLogsError.message || "Could not clear CRM logs." },
        { status: 500 }
      );
    }

    const { error: deleteCrmAccountNotesError } = await supabase
      .from("crm_account_notes")
      .delete()
      .eq("attempt_id", attemptId);

    if (deleteCrmAccountNotesError) {
      console.error("[simulation/restart] delete crm account notes", deleteCrmAccountNotesError);
      return NextResponse.json(
        { error: deleteCrmAccountNotesError.message || "Could not clear CRM account notes." },
        { status: 500 }
      );
    }

    const { error: deleteCrmContactNotesError } = await supabase
      .from("crm_contact_notes")
      .delete()
      .eq("attempt_id", attemptId);

    if (deleteCrmContactNotesError) {
      console.error("[simulation/restart] delete crm contact notes", deleteCrmContactNotesError);
      return NextResponse.json(
        { error: deleteCrmContactNotesError.message || "Could not clear CRM contact notes." },
        { status: 500 }
      );
    }

    const { error: deleteCrmLeadsError } = await supabase
      .from("crm_leads")
      .delete()
      .eq("attempt_id", attemptId);

    if (deleteCrmLeadsError) {
      // Table missing until supabase/crm-leads-migration.sql is applied — do not block restart.
      if (!isMissingTableError(deleteCrmLeadsError)) {
        console.error("[simulation/restart] delete crm leads", deleteCrmLeadsError);
        return NextResponse.json(
          { error: deleteCrmLeadsError.message || "Could not clear CRM leads." },
          { status: 500 }
        );
      }
      console.warn(
        "[simulation/restart] crm_leads table missing — run supabase/crm-leads-migration.sql"
      );
    }

    // The attempt's Data Room chat count (data_room_chat_usage) is kept: restart keeps
    // the attempt id, so clearing it would reset the 300-question cap (2026-11-08).

    const resetPayload: Record<string, unknown> = {
      current_stage: "lead_gen",
      total_score: 0,
      status: ATTEMPT_STATUS.IN_PROGRESS,
      completed_at: null,
      stage_data: null,
      lead_selection_attempts: 0,
    };

    if (!attempt.class_id) {
      resetPayload.class_id = classId;
    }

    if (enrollment?.id) {
      resetPayload.student_class_id = enrollment.id;
    }

    const { error: resetError } = await supabase
      .from("attempts")
      .update(resetPayload)
      .eq("id", attemptId);

    if (resetError) {
      console.error("[simulation/restart] reset", resetError);
      return NextResponse.json(
        { error: resetError.message || "Could not restart simulation." },
        { status: 500 }
      );
    }

    const payload: RestartSimulationResponse = {
      success: true,
      newAttemptId: attemptId,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[simulation/restart] unexpected", err);
    const message = err instanceof Error ? err.message : "Could not restart simulation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
