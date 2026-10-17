/**
 * call-notes/route.ts
 * POST /api/student/call-notes { attemptId, stage } — AI call notes for a finished
 * Tempo call (stage "discovery" or "objections"), shown in the Reference Library.
 * The attempt must be the student's own Tempo attempt and the call must be saved
 * in stage_scores. Notes already in stage_scores.call_notes are returned as they
 * are (no model call). Otherwise one gpt-4o call sees ONLY the saved transcript
 * (lib/tempo-call-notes.ts); a valid reply is saved where call_notes is still null
 * and returned. No transcript, a failed call or an invalid reply → an error, and
 * nothing is saved.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isTempoAttempt, readJoinedSimulationTitle } from "@/lib/tempo-attempt";
import {
  buildCallNotesMessages,
  parseCallNotes,
  parseCallNotesBody,
  parseCallNotesReply,
  type CallNotes,
} from "@/lib/tempo-call-notes";
import { parseReferenceCall } from "@/lib/tempo-reference-library";

const CALL_NOTES_TEMPERATURE = 0.2;
/** Room for a two-sentence summary and three groups of up to 3 short bullets. */
const CALL_NOTES_MAX_TOKENS = 600;

/**
 * Returns { notes } for the student's finished call, writing them once if needed.
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
  const body = parseCallNotesBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    const { data: attempt } = await supabase
      .from("attempts")
      .select("id, class_id, simulation_id, simulations(title)")
      .eq("id", body.attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();
    if (
      !attempt ||
      !isTempoAttempt(attempt.class_id, attempt.simulation_id, readJoinedSimulationTitle(attempt.simulations))
    ) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const { data: row } = await supabase
      .from("stage_scores")
      .select("id, transcript, call_notes")
      .eq("attempt_id", body.attemptId)
      .eq("stage", body.stage)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }

    // Already written: return the stored notes, no model call.
    const stored = parseCallNotes(row.call_notes);
    if (stored) {
      return NextResponse.json({ notes: stored });
    }

    const transcript = parseReferenceCall(body.stage, row.transcript).messages;
    if (transcript.length === 0) {
      return NextResponse.json({ error: "No transcript to summarize." }, { status: 422 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Call notes are not available right now." }, { status: 500 });
    }

    let notes: CallNotes | null;
    try {
      const response = await new OpenAI({ apiKey }).chat.completions.create({
        model: "gpt-4o",
        temperature: CALL_NOTES_TEMPERATURE,
        max_tokens: CALL_NOTES_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: buildCallNotesMessages(transcript),
      });
      notes = parseCallNotesReply(response.choices[0]?.message?.content);
    } catch (error) {
      console.error("[call-notes] model:", error);
      notes = null;
    }
    if (!notes) {
      return NextResponse.json({ error: "Couldn't write call notes." }, { status: 502 });
    }

    // Save only if no notes were stored meanwhile; if another request won, return its notes.
    const { data: saved, error: saveError } = await supabase
      .from("stage_scores")
      .update({ call_notes: notes })
      .eq("id", row.id)
      .is("call_notes", null)
      .select("call_notes");
    if (saveError) {
      console.error("[call-notes] save:", saveError);
      return NextResponse.json({ error: "Couldn't save call notes." }, { status: 500 });
    }
    if (Array.isArray(saved) && saved.length > 0) {
      return NextResponse.json({ notes });
    }
    const { data: current } = await supabase
      .from("stage_scores")
      .select("call_notes")
      .eq("id", row.id)
      .maybeSingle();
    return NextResponse.json({ notes: parseCallNotes(current?.call_notes) ?? notes });
  } catch (error) {
    console.error("[call-notes] unexpected:", error);
    return NextResponse.json({ error: "Couldn't write call notes." }, { status: 500 });
  }
}
