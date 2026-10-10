/**
 * icp-check/route.ts
 * POST — grades Prospecting ICP text (non-blocking coaching).
 * GET — returns persisted stage_data.icp for the attempt.
 * PATCH — marks feedbackSeen after Continue.
 */

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { revalidateStudentAttemptSurfaces } from "@/lib/revalidate-student-progress";
import { createServiceClient } from "@/lib/supabase/server";
import {
  TEMPO_ICP_AFFIRMED_TEXT,
  TEMPO_ICP_CORRECTED_TEXT,
  TEMPO_ICP_CRITERIA,
  parseProspectingIcpState,
  type IcpCheckResult,
  type ProspectingIcpState,
} from "@/lib/tempo-icp-criteria";

type PostBody = {
  attemptId?: string;
  icpText?: string;
};

type PatchBody = {
  attemptId?: string;
  feedbackSeen?: boolean;
};

/**
 * Builds the ICP grading system prompt from config criteria.
 */
function buildIcpSystemPrompt(): string {
  return `You are grading a sales student's Ideal Customer Profile (ICP) for Tempo,
a scheduling product for appointment-based multi-location service businesses.

Use ONLY these criteria:
${TEMPO_ICP_CRITERIA}

Respond with JSON only:
{ "meetsCorrectCriteria": boolean, "reasoning": "brief internal note" }

meetsCorrectCriteria is true only when the student's ICP clearly covers the
correct patterns (multi-location appointment-based services, manual scheduling,
current operational strain/growth pressure, a real ops/tooling buyer, and an
operations-level decision-maker role that owns scheduling and front-desk
processes). Be fair but not lenient on vague or prestige-only answers.`;
}

/**
 * Parses the GPT JSON judgment. Returns null when shape is invalid.
 */
function parseJudgment(raw: string): { meetsCorrectCriteria: boolean; reasoning: string } | null {
  try {
    const parsed = JSON.parse(raw) as {
      meetsCorrectCriteria?: unknown;
      reasoning?: unknown;
    };
    if (typeof parsed.meetsCorrectCriteria !== "boolean") {
      return null;
    }
    return {
      meetsCorrectCriteria: parsed.meetsCorrectCriteria,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

/**
 * Loads an attempt owned by the authenticated student.
 */
async function loadOwnedAttempt(
  attemptId: string,
  studentId: string
): Promise<{
  id: string;
  stage_data: Record<string, unknown> | null;
  class_id: string | null;
  simulation_id: string | null;
} | null> {
  const supabase = createServiceClient();
  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, student_id, stage_data, class_id, simulation_id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .single();

  if (!attempt) {
    return null;
  }

  return {
    id: attempt.id as string,
    stage_data: (attempt.stage_data as Record<string, unknown> | null) ?? null,
    class_id: (attempt.class_id as string | null) ?? null,
    simulation_id: (attempt.simulation_id as string | null) ?? null,
  };
}

/**
 * Merges ICP payload into attempts.stage_data without wiping other keys.
 */
async function persistIcp(
  attemptId: string,
  existing: Record<string, unknown> | null,
  icp: ProspectingIcpState
): Promise<void> {
  const supabase = createServiceClient();
  const merged = { ...(existing ?? {}), icp };
  const { error } = await supabase
    .from("attempts")
    .update({ stage_data: merged })
    .eq("id", attemptId);

  if (error) {
    throw error;
  }
}

/**
 * GET /api/student/icp-check?attemptId=…
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

  const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }

  const icp = parseProspectingIcpState(attempt.stage_data?.icp);
  return NextResponse.json({ icp });
}

/**
 * PATCH /api/student/icp-check — mark manager feedback as seen (Continue).
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as PatchBody;
    const attemptId = body.attemptId?.trim() ?? "";
    if (!attemptId || body.feedbackSeen !== true) {
      return NextResponse.json({ error: "Missing attemptId or feedbackSeen." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const existingIcp = parseProspectingIcpState(attempt.stage_data?.icp);
    if (!existingIcp) {
      return NextResponse.json({ error: "ICP not submitted yet." }, { status: 400 });
    }

    const next: ProspectingIcpState = { ...existingIcp, feedbackSeen: true };
    await persistIcp(attemptId, attempt.stage_data, next);
    revalidateStudentAttemptSurfaces({
      classId: attempt.class_id,
      simulationId: attempt.simulation_id,
    });
    return NextResponse.json({ icp: next });
  } catch (err) {
    console.error("[icp-check] PATCH failed:", err);
    return NextResponse.json({ error: "Could not update ICP state." }, { status: 500 });
  }
}

/**
 * POST /api/student/icp-check — grade ICP and persist coaching result.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as PostBody;
    const attemptId = body.attemptId?.trim() ?? "";
    const icpText = typeof body.icpText === "string" ? body.icpText.trim() : "";

    if (!attemptId || !icpText) {
      return NextResponse.json({ error: "Missing attemptId or icpText." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    let result: IcpCheckResult = "affirmed";
    let displayText = TEMPO_ICP_AFFIRMED_TEXT;
    let activeIcpText = icpText;

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildIcpSystemPrompt() },
            {
              role: "user",
              content: `Student ICP submission:\n\n${icpText}`,
            },
          ],
        });

        const raw = completion.choices[0]?.message?.content ?? "{}";
        const judgment = parseJudgment(raw);
        if (judgment) {
          console.info("[icp-check] judgment:", judgment.reasoning);
          if (!judgment.meetsCorrectCriteria) {
            result = "corrected";
            displayText = TEMPO_ICP_CORRECTED_TEXT;
            activeIcpText = TEMPO_ICP_CORRECTED_TEXT;
          }
        }
      } catch (err) {
        console.error("[icp-check] OpenAI failed — defaulting to affirmed:", err);
      }
    } else {
      console.error("[icp-check] OPENAI_API_KEY missing — defaulting to affirmed.");
    }

    const icp: ProspectingIcpState = {
      originalText: icpText,
      result,
      displayText,
      activeIcpText,
      feedbackSeen: false,
    };

    await persistIcp(attemptId, attempt.stage_data, icp);
    revalidateStudentAttemptSurfaces({
      classId: attempt.class_id,
      simulationId: attempt.simulation_id,
    });

    return NextResponse.json({
      result,
      displayText,
      activeIcpText,
    });
  } catch (err) {
    console.error("[icp-check] POST failed:", err);
    return NextResponse.json({ error: "Could not check ICP." }, { status: 500 });
  }
}
