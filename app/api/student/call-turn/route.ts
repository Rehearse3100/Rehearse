/**
 * route.ts — POST /api/student/call-turn
 * One turn of a live Tempo persona call (Dana or Dr. Kim) through the shared call brain
 * (lib/server/call-brain.ts): the persona's next line, whether the call ends with it, and
 * the student's message label. Signed-in students only, on their own Tempo attempt. The
 * live Dana and Dr. Kim calls send every turn here (hooks/useSimulationVoiceSession.ts).
 *
 * Body: CallTurnRequest (lib/call-config.ts): the turn plus attemptId.
 * Response: CallTurnResponse { reply, endCall?: true, endReason?, label? } (endReason
 * whenever endCall is sent). 401 signed out, 400 for a
 * bad body, 404 when the attempt isn't the student's or isn't Tempo, 403 when the
 * persona's stage isn't the one the attempt is on (attempts.current_stage, which
 * complete-stage advances), the attempt is completed, or the stage already has its saved
 * score (stage_scores), 500 otherwise. The local test bypass (TEMPO_TEST_BYPASS_GATES,
 * whose ?teststage= jumps open any stage) skips the stage check. No error ever carries
 * OpenAI's or Supabase's text; the brain turns a failed model call into a fallback line.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import type { CallPersona, CallTurnErrorResponse, CallTurnResponse } from "@/lib/call-config";
import { ATTEMPT_STATUS, TEMPO_SIMULATION_ID } from "@/lib/constants";
import { parseCallTurn, runCallTurn } from "@/lib/server/call-brain";
import { createServiceClient } from "@/lib/supabase/server";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";
import type { SimulationStage } from "@/types";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "Could not generate a reply.";
const STAGE_CLOSED_ERROR = "This call is not open on your attempt.";

/** The Tempo stage (attempts.current_stage) each call persona's call belongs to. */
const PERSONA_STAGES: Record<CallPersona, SimulationStage> = {
  tempo_discovery: "discovery",
  tempo_objections: "objections",
};

/**
 * POST /api/student/call-turn — the persona's next line for the student's live call.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[call-turn] OPENAI_API_KEY is not configured");
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
    }
    const parsed = parseCallTurn(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const rawAttemptId = (body as Record<string, unknown>).attemptId;
    const attemptId = typeof rawAttemptId === "string" ? rawAttemptId.trim() : "";
    if (!attemptId) {
      return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, simulation_id, status, current_stage")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();
    if (attemptError) {
      console.error("[call-turn] attempt lookup failed:", attemptError);
    }
    if (attemptError || !attempt || attempt.simulation_id !== TEMPO_SIMULATION_ID) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    // The call must be the stage the attempt is on, and that stage not already completed.
    if (!isGateBypassEnabled()) {
      const stage = PERSONA_STAGES[parsed.turn.persona];
      if (attempt.status === ATTEMPT_STATUS.COMPLETED || attempt.current_stage !== stage) {
        return NextResponse.json({ error: STAGE_CLOSED_ERROR }, { status: 403 });
      }
      const { data: savedScore, error: scoreError } = await supabase
        .from("stage_scores")
        .select("id")
        .eq("attempt_id", attemptId)
        .eq("stage", stage)
        .maybeSingle();
      if (scoreError) {
        console.error("[call-turn] stage score lookup failed:", scoreError);
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
      }
      if (savedScore) {
        return NextResponse.json({ error: STAGE_CLOSED_ERROR }, { status: 403 });
      }
    }

    const { reply, endCall, endReason, label } = await runCallTurn(parsed.turn, new OpenAI({ apiKey }));
    const response: CallTurnResponse = {
      reply,
      ...(endCall ? { endCall: true, endReason } : {}),
      ...(label ? { label } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[call-turn] unexpected:", error);
    const response: CallTurnErrorResponse = { error: GENERIC_ERROR };
    return NextResponse.json(response, { status: 500 });
  }
}
