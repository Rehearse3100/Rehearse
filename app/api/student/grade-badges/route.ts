/**
 * grade-badges/route.ts
 * POST /api/student/grade-badges — grades one Tempo stage's badges after the save.
 * complete-stage saves Tempo stages with badges_status 'pending' and replies at
 * once; lib/attempt-actions.ts then calls this route with { attemptId, stage },
 * and the results page calls it for any stage still pending. The submission is
 * read from stage_scores, never from the request. A claim id guards the final
 * write, so retries and parallel calls never double-grade or append badges.
 */

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildBadgeClaimFilter,
  isTempoAttempt,
  parseGradeBadgesBody,
  readJoinedSimulationTitle,
} from "@/lib/tempo-attempt";
import { buildTempoBadgeInputs } from "@/lib/tempo-badge-inputs";
import { detectTempoBadges } from "@/lib/tempo-badges";

/** Grading may make two OpenAI calls (retry-once parse), as complete-stage did inline. */
export const maxDuration = 60;

/**
 * Claims a pending (or stale) grading job for one stage, grades it with the
 * unchanged detectTempoBadges, and saves the result. Returns { status, badges }.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseGradeBadgesBody(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { attemptId, stage } = parsed;

  try {
    const supabase = createServiceClient();

    const { data: attempt } = await supabase
      .from("attempts")
      .select("id, class_id, simulation_id, simulations(title)")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();

    if (
      !attempt ||
      !isTempoAttempt(
        attempt.class_id,
        attempt.simulation_id,
        readJoinedSimulationTitle(attempt.simulations)
      )
    ) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    // ── Claim: one conditional UPDATE; only pending or stale-grading rows match ───
    const nowMs = Date.now();
    const claimId = randomUUID();
    const { data: claimedRows, error: claimError } = await supabase
      .from("stage_scores")
      .update({
        badges_status: "grading",
        badges_claimed_at: new Date(nowMs).toISOString(),
        badges_claim_id: claimId,
      })
      .eq("attempt_id", attemptId)
      .eq("stage", stage)
      .or(buildBadgeClaimFilter(nowMs))
      .select("transcript");

    if (claimError) {
      console.error("[grade-badges] claim failed:", claimError);
      return NextResponse.json({ error: "Could not grade badges." }, { status: 500 });
    }

    const claimed = claimedRows?.[0];
    if (!claimed) {
      // Already done, or another request holds a fresh claim: report the current row.
      const { data: current } = await supabase
        .from("stage_scores")
        .select("badges_status, badges_earned")
        .eq("attempt_id", attemptId)
        .eq("stage", stage)
        .maybeSingle();

      if (!current) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      return NextResponse.json({
        status: typeof current.badges_status === "string" ? current.badges_status : "done",
        badges: Array.isArray(current.badges_earned) ? current.badges_earned : [],
      });
    }

    // ── Grade with the same arguments complete-stage passed inline ───
    let badges: string[] = [];
    try {
      const transcript = typeof claimed.transcript === "string" ? claimed.transcript : "";
      const { crmFields, discoveryPrepPayload } = await buildTempoBadgeInputs(
        supabase,
        attemptId,
        stage,
        transcript
      );
      badges = await detectTempoBadges(stage, transcript, crmFields, discoveryPrepPayload);
    } catch (error) {
      // Same outcome as a failed inline grade today: no badges, never an error to the student.
      console.error("[grade-badges] grading failed; saving no badges:", error);
      badges = [];
    }

    // Replace (never append). If a re-submit reset the row meanwhile, the claim id
    // no longer matches and this write does nothing, which is correct.
    const { error: saveError } = await supabase
      .from("stage_scores")
      .update({ badges_earned: badges, badges_status: "done" })
      .eq("attempt_id", attemptId)
      .eq("stage", stage)
      .eq("badges_claim_id", claimId)
      .eq("badges_status", "grading");

    if (saveError) {
      // The claim goes stale after BADGE_CLAIM_STALE_MS and can be re-claimed.
      console.error("[grade-badges] saving badges failed:", saveError);
      return NextResponse.json({ error: "Could not grade badges." }, { status: 500 });
    }

    return NextResponse.json({ status: "done", badges });
  } catch (error) {
    console.error("[grade-badges] unexpected error:", error);
    return NextResponse.json({ error: "Could not grade badges." }, { status: 500 });
  }
}
