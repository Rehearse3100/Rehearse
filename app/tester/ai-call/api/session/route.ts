/**
 * route.ts — POST /tester/ai-call/api/session (TESTER ONLY)
 * The tester page's own Anam session token, so the avatar works with no attempt id and no
 * sign-in. A small copy of what POST /api/student/anam-session does (that route and
 * lib/tempo-anam-config.ts are untouched and not imported):
 * 1. read the stage's avatar and voice ids from the Tempo simulations row
 *    (anam_avatar_ids / anam_voice_ids), over Supabase's REST API with the service role
 *    key (the same request supabase-js sends: GET /rest/v1/simulations with apikey and
 *    Authorization: Bearer headers);
 * 2. mint the token at Anam's POST /v1/auth/session-token with the custom-client LLM id
 *    (Anam's own LLM off: the call brain's replies go to the avatar with talk()), plus
 *    the persona's voiceDetectionOptions from CALL_TIMINGS in lib/call-config.ts.
 *
 * 404 unless tester mode is on (the same check as page.tsx). Tester mode is local only
 * (docs/tempo-test-bypass.md). Reads one row, writes nothing.
 *
 * Body: { stage: "discovery" | "objections" }. Response: { sessionToken, avatarId }.
 * Errors are short messages of its own; what Anam or Supabase said is logged here only.
 */

import { NextResponse } from "next/server";
import { CALL_TIMINGS } from "@/lib/call-config";

export const dynamic = "force-dynamic";

/** The Tempo simulation: the row the project route reads for a Tempo attempt. */
const TEMPO_SIMULATION_ID = "00000000-0000-0000-0000-000000000002";
/** Copy of ANAM_CUSTOM_CLIENT_LLM_ID in lib/tempo-anam-config.ts: Anam's built-in LLM off. */
const ANAM_CUSTOM_CLIENT_LLM_ID = "CUSTOMER_CLIENT_V1";
const ANAM_SESSION_TOKEN_URL = "https://api.anam.ai/v1/auth/session-token";

/** The two tester stages, each with the persona whose voice settings it uses. */
const STAGE_PERSONAS = {
  discovery: "tempo_discovery",
  objections: "tempo_objections",
} as const;

type TesterStage = keyof typeof STAGE_PERSONAS;

function isTesterStage(value: unknown): value is TesterStage {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STAGE_PERSONAS, value);
}

/** One stage's id from a jsonb map ({ discovery: "…", objections: "…" }), trimmed; "" when missing. */
function stageId(map: unknown, stage: TesterStage): string {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return "";
  }
  const value = (map as Record<string, unknown>)[stage];
  return typeof value === "string" ? value.trim() : "";
}

/** The stage's avatar and voice ids from the Tempo row, or null (the reason is logged here). */
async function readStageIds(supabaseUrl: string, serviceKey: string, stage: TesterStage): Promise<{ avatarId: string; voiceId: string } | null> {
  const url = new URL("rest/v1/simulations", supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`);
  url.searchParams.set("select", "anam_avatar_ids,anam_voice_ids");
  url.searchParams.set("id", `eq.${TEMPO_SIMULATION_ID}`);
  const response = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    console.error("[tester-session] simulation lookup failed:", response.status, (await response.text()).slice(0, 300));
    return null;
  }
  const rows: unknown = await response.json();
  const row: unknown = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") {
    console.error("[tester-session] Tempo simulation row not found");
    return null;
  }
  const { anam_avatar_ids: avatarIds, anam_voice_ids: voiceIds } = row as Record<string, unknown>;
  const ids = { avatarId: stageId(avatarIds, stage), voiceId: stageId(voiceIds, stage) };
  if (!ids.avatarId || !ids.voiceId) {
    console.error(`[tester-session] no Anam avatar or voice id for stage '${stage}' on the Tempo row`);
    return null;
  }
  return ids;
}

/**
 * POST /tester/ai-call/api/session — an Anam session token for the tester page's avatar.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.TEMPO_TEST_BYPASS_GATES !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
    }
    const stage = body && typeof body === "object" ? (body as Record<string, unknown>).stage : undefined;
    if (!isTesterStage(stage)) {
      return NextResponse.json({ error: "stage must be 'discovery' or 'objections'." }, { status: 400 });
    }

    const anamKey = process.env.ANAM_API_KEY?.trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!anamKey || !supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "ANAM_API_KEY or the Supabase settings are not configured." }, { status: 500 });
    }

    const ids = await readStageIds(supabaseUrl, serviceKey, stage);
    if (!ids) {
      return NextResponse.json({ error: "Could not read this stage's avatar and voice." }, { status: 502 });
    }

    const label = `tester:${stage}`;
    const anamResponse = await fetch(ANAM_SESSION_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anamKey}` },
      body: JSON.stringify({
        clientLabel: label,
        personaConfig: {
          name: label,
          avatarId: ids.avatarId,
          voiceId: ids.voiceId,
          llmId: ANAM_CUSTOM_CLIENT_LLM_ID,
          voiceDetectionOptions: CALL_TIMINGS[STAGE_PERSONAS[stage]].voiceDetectionOptions,
        },
      }),
      cache: "no-store",
    });
    const responseText = await anamResponse.text();
    if (!anamResponse.ok) {
      console.error("[tester-session] Anam token failure:", anamResponse.status, responseText.slice(0, 300));
      return NextResponse.json({ error: "Could not create the Anam session." }, { status: 502 });
    }
    let sessionToken = "";
    try {
      const parsed: unknown = JSON.parse(responseText);
      const token = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).sessionToken : undefined;
      sessionToken = typeof token === "string" ? token.trim() : "";
    } catch {
      sessionToken = "";
    }
    if (!sessionToken) {
      console.error("[tester-session] no sessionToken in Anam's response");
      return NextResponse.json({ error: "Could not create the Anam session." }, { status: 502 });
    }

    return NextResponse.json({ sessionToken, avatarId: ids.avatarId });
  } catch (error) {
    console.error("[tester-session] unexpected:", error);
    return NextResponse.json({ error: "Could not create the Anam session." }, { status: 500 });
  }
}
