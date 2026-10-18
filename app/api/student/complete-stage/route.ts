/**
 * complete-stage/route.ts
 * POST /api/student/complete-stage — saves stage score and advances attempt.
 * Uses service role because students do not have Supabase auth sessions.
 * Tempo attempts save badges as 'pending' and reply with badgesPending: true;
 * the browser then calls POST /api/student/grade-badges. Legacy attempts still
 * grade badges inline here.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { parseIcpGradeRecord } from "@/lib/icp-grading";
import { getNextStage } from "@/lib/stages";
import { createServiceClient } from "@/lib/supabase/server";
import { isTempoAttempt, readJoinedSimulationTitle } from "@/lib/tempo-attempt";
import { buildTempoBadgeInputs } from "@/lib/tempo-badge-inputs";
import { detectTempoBadges } from "@/lib/tempo-badges";
import { convertLead } from "@/lib/tempo-lead-conversion";
import type { SimulationStage } from "@/types";

type CompleteStageBody = {
  attemptId?: string;
  stage?: SimulationStage;
  score?: number;
  feedback?: string;
  transcript?: string;
};

/** stage_scores upsert row; the grading columns are set only for Tempo stages. */
type StageScoreUpsert = {
  attempt_id: string;
  stage: SimulationStage;
  score: number;
  feedback: string;
  transcript: string;
  badges_earned: string[];
  badges_status?: "pending";
  badges_claimed_at?: null;
  badges_claim_id?: null;
};

/**
 * Upserts a stage score and updates attempt progress for the logged-in student.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as CompleteStageBody;
    const { attemptId, stage, score, feedback, transcript } = body;

    if (!attemptId || !stage || score === undefined || !feedback || transcript === undefined) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: attempt } = await supabase
      .from("attempts")
      .select("id, student_id, stage_data, class_id, simulation_id, simulations(title)")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    // Ensure the prospecting transcript carries the ICP review (rubric version,
    // status and the manager note) from stage_data.icp, in the current or the old
    // shape, even if the client omitted it. The score, band and criteria stay in
    // stage_data only.
    let transcriptToStore = transcript;
    if (stage === "prospecting") {
      try {
        const parsed =
          typeof transcript === "string" && transcript.trim()
            ? (JSON.parse(transcript) as Record<string, unknown>)
            : {};
        const stageData = (attempt.stage_data ?? {}) as Record<string, unknown>;
        const icpRecord = parseIcpGradeRecord(stageData.icp);
        if (icpRecord && !parsed.icp) {
          parsed.icp = {
            rubricVersion: icpRecord.rubricVersion,
            status: icpRecord.status,
            note: icpRecord.note,
          };
          transcriptToStore = JSON.stringify(parsed);
        }
      } catch {
        /* keep original transcript */
      }
    }

    if (stage === "prospecting") {
      const { data: selectedLead, error: selectedError } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("attempt_id", attemptId)
        .eq("status", "selected")
        .maybeSingle();

      if (selectedError) {
        console.error(
          "[complete-stage] could not load selected lead for auto-convert:",
          selectedError
        );
      } else if (!selectedLead) {
        console.error(
          "[complete-stage] prospecting completed with no selected crm_leads row — Discovery gate will block until a Lead is converted"
        );
      } else {
        try {
          const convertResult = await convertLead(supabase, attemptId, selectedLead.id as string);
          if (!convertResult.success) {
            console.error(
              "[complete-stage] auto-convert failed after wizard selection:",
              convertResult.reason,
              convertResult.managerNote
            );
          }
        } catch (err) {
          console.error("[complete-stage] auto-convert threw:", err);
        }
      }
    }

    const isBadgeStage =
      stage === "discovery" ||
      stage === "objections" ||
      stage === "prospecting" ||
      stage === "presentation" ||
      stage === "close";
    // Tempo attempts grade badges after this save (grade-badges route), so Submit
    // never waits on OpenAI. Tempo is decided from the DB row, never the request.
    const defersBadges =
      isBadgeStage &&
      isTempoAttempt(
        attempt.class_id,
        attempt.simulation_id,
        readJoinedSimulationTitle(attempt.simulations)
      );

    let badgesEarned: string[] = [];
    if (isBadgeStage && !defersBadges) {
      const { crmFields, discoveryPrepPayload } = await buildTempoBadgeInputs(
        supabase,
        attemptId,
        stage,
        transcriptToStore
      );

      badgesEarned = await detectTempoBadges(
        stage,
        transcriptToStore,
        crmFields,
        discoveryPrepPayload
      );
    }

    // Legacy rows keep today's six columns; Tempo rows also reset the grading state,
    // so re-submitting a Tempo stage sends it back to pending and it is graded again.
    const scoreRow: StageScoreUpsert = {
      attempt_id: attemptId,
      stage,
      score,
      feedback,
      transcript: transcriptToStore,
      badges_earned: badgesEarned,
      ...(defersBadges
        ? { badges_status: "pending", badges_claimed_at: null, badges_claim_id: null }
        : {}),
    };
    const { error: upsertError } = await supabase
      .from("stage_scores")
      .upsert(scoreRow, { onConflict: "attempt_id,stage" });

    if (upsertError) {
      console.error("[complete-stage] stage_scores upsert failed:", upsertError);
      return NextResponse.json({ error: "Could not save stage progress." }, { status: 500 });
    }

    const pendingFlag = defersBadges ? { badgesPending: true } : {};

    const { data: scores } = await supabase
      .from("stage_scores")
      .select("score")
      .eq("attempt_id", attemptId);

    const totalScore = (scores ?? []).reduce((sum, row) => sum + row.score, 0);
    const next = getNextStage(stage);

    if (next === "results" || next === null) {
      await supabase
        .from("attempts")
        .update({
          current_stage: "results",
          status: "completed",
          total_score: totalScore,
          completed_at: new Date().toISOString(),
        })
        .eq("id", attemptId);

      return NextResponse.json({ nextStage: "results", totalScore, ...pendingFlag });
    }

    await supabase
      .from("attempts")
      .update({ current_stage: next, total_score: totalScore })
      .eq("id", attemptId);

    return NextResponse.json({ nextStage: next, totalScore, ...pendingFlag });
  } catch {
    return NextResponse.json({ error: "Could not save stage progress." }, { status: 500 });
  }
}
