/**
 * anam-session/route.ts
 * POST — mints a short-lived Anam session token for custom-LLM mode (CUSTOMER_CLIENT_V1).
 * Anam runs STT + TTS + avatar video; Rehearse supplies GPT via client talk stream.
 * Server-only ANAM_API_KEY; client receives sessionToken + avatarId only.
 * A Tempo attempt's discovery and objections sessions (the live Dana and Dr. Kim calls)
 * also send that persona's voiceDetectionOptions from CALL_TIMINGS in lib/call-config.ts;
 * every other session's personaConfig is unchanged.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { CALL_TIMINGS, type CallPersona } from "@/lib/call-config";
import { TEMPO_SIMULATION_ID } from "@/lib/constants";
import {
  ANAM_CUSTOM_CLIENT_LLM_ID,
  getAnamAvatarId,
  getAnamVoiceId,
  isAnamSessionStage,
  normalizeAnamIdMap,
  type AnamSessionStage,
} from "@/lib/tempo-anam-config";
import { createServiceClient } from "@/lib/supabase/server";

const ANAM_SESSION_TOKEN_URL = "https://api.anam.ai/v1/auth/session-token";

/** The call persona a Tempo attempt's stage runs (its voice settings come from CALL_TIMINGS). */
const TEMPO_STAGE_PERSONAS: Record<AnamSessionStage, CallPersona> = {
  discovery: "tempo_discovery",
  objections: "tempo_objections",
};

type AnamSessionBody = {
  attemptId?: unknown;
  stage?: unknown;
};

type AnamSessionTokenResponse = {
  sessionToken?: string;
};

/**
 * POST /api/student/anam-session
 * Body: { attemptId, stage: 'discovery' | 'objections' }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as AnamSessionBody;
    const attemptId =
      typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    const stage = typeof body.stage === "string" ? body.stage.trim() : "";

    if (!attemptId || !stage) {
      return NextResponse.json(
        { error: "attemptId and stage are required." },
        { status: 400 }
      );
    }

    if (!isAnamSessionStage(stage)) {
      return NextResponse.json(
        { error: "stage must be 'discovery' or 'objections'." },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANAM_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANAM_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, simulation_id")
      .eq("id", attemptId)
      .eq("student_id", auth.session.studentId)
      .maybeSingle();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const { data: simulation, error: simulationError } = await supabase
      .from("simulations")
      .select("id, anam_avatar_ids, anam_voice_ids")
      .eq("id", attempt.simulation_id)
      .maybeSingle();

    if (simulationError) {
      console.error("[anam-session] simulation lookup failed:", simulationError);
      const message = simulationError.message ?? "Simulation lookup failed.";
      const needsMigration =
        message.includes("anam_avatar_ids") || message.includes("anam_voice_ids");
      return NextResponse.json(
        {
          error: needsMigration
            ? "Anam columns missing on simulations table. Run supabase/FULL-SETUP.sql in Supabase SQL Editor."
            : `Simulation lookup failed: ${message}`,
        },
        { status: needsMigration ? 500 : 500 }
      );
    }

    if (!simulation) {
      return NextResponse.json({ error: "Simulation not found." }, { status: 404 });
    }

    const avatarIds = normalizeAnamIdMap(simulation.anam_avatar_ids);
    const voiceIds = normalizeAnamIdMap(simulation.anam_voice_ids);

    const avatarId = getAnamAvatarId(stage, avatarIds);
    if (!avatarId) {
      return NextResponse.json(
        {
          error: `No Anam avatar ID configured for stage '${stage}'. Set simulations.anam_avatar_ids['${stage}'] for this simulation.`,
        },
        { status: 400 }
      );
    }

    const voiceId = getAnamVoiceId(stage, voiceIds);
    if (!voiceId) {
      return NextResponse.json(
        {
          error: `No Anam voice ID configured for stage '${stage}'. Set simulations.anam_voice_ids['${stage}'] for this simulation.`,
        },
        { status: 400 }
      );
    }

    // Shown in Anam dashboard (persona name + client label). Updated client-side to
    // Anam session UUID on SESSION_READY when supported.
    const sessionLabel = `${stage}:${attemptId}`;
    // Tempo only: a legacy simulation can use these stages too, and keeps Anam's defaults.
    const isTempoCall = attempt.simulation_id === TEMPO_SIMULATION_ID;

    const anamResponse = await fetch(ANAM_SESSION_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        clientLabel: sessionLabel,
        personaConfig: {
          name: sessionLabel,
          avatarId,
          voiceId,
          llmId: ANAM_CUSTOM_CLIENT_LLM_ID,
          ...(isTempoCall
            ? { voiceDetectionOptions: CALL_TIMINGS[TEMPO_STAGE_PERSONAS[stage]].voiceDetectionOptions }
            : {}),
        },
      }),
    });

    const responseText = await anamResponse.text();
    let responseJson: AnamSessionTokenResponse & { error?: string; message?: string } =
      {};
    if (responseText) {
      try {
        responseJson = JSON.parse(responseText) as typeof responseJson;
      } catch {
        responseJson = {};
      }
    }

    if (!anamResponse.ok) {
      const detail =
        responseJson.message ??
        responseJson.error ??
        responseText.slice(0, 500) ??
        `Anam API error (${anamResponse.status})`;
      console.error("[anam-session] Anam token failure:", anamResponse.status, detail);
      return NextResponse.json(
        { error: `Could not create Anam session token: ${detail}` },
        { status: 502 }
      );
    }

    const sessionToken = responseJson.sessionToken?.trim();
    if (!sessionToken) {
      console.error("[anam-session] Missing sessionToken in Anam response:", responseText);
      return NextResponse.json(
        { error: "Anam returned no session token." },
        { status: 502 }
      );
    }

    return NextResponse.json({ sessionToken, avatarId });
  } catch (error) {
    console.error("[anam-session] unexpected:", error);
    return NextResponse.json(
      { error: "Could not create Anam session." },
      { status: 500 }
    );
  }
}
