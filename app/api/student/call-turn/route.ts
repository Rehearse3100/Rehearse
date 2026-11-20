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
 * bad body, 404 when the attempt isn't the student's or isn't Tempo, 500 otherwise. No
 * error ever carries OpenAI's or Supabase's text; the brain turns a failed model call into
 * a fallback line.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import type { CallTurnErrorResponse, CallTurnResponse } from "@/lib/call-config";
import { TEMPO_SIMULATION_ID } from "@/lib/constants";
import { parseCallTurn, runCallTurn } from "@/lib/server/call-brain";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GENERIC_ERROR = "Could not generate a reply.";

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
      .select("id, simulation_id")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();
    if (attemptError) {
      console.error("[call-turn] attempt lookup failed:", attemptError);
    }
    if (attemptError || !attempt || attempt.simulation_id !== TEMPO_SIMULATION_ID) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
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
