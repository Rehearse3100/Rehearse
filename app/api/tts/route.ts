/**
 * route.ts — /api/tts
 * ElevenLabs text-to-speech with character alignment timestamps. Signed-in students
 * only (paid service); the text is at most TTS_MAX_TEXT_CHARS (1,000) characters.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import {
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_SIMILARITY_BOOST,
  ELEVENLABS_STABILITY,
  TTS_MAX_TEXT_CHARS,
} from "@/lib/constants";
import { timingsFromAlignment } from "@/lib/elevenLabsTimings";
import type { TtsRequestBody, TtsResponseBody } from "@/types";

function elevenLabsErrorMessage(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      detail?: { status?: string; message?: string } | string;
      message?: string;
    };
    const detail = parsed.detail;
    if (typeof detail === "string" && detail.trim()) {
      return `ElevenLabs API error ${status}: ${detail}`;
    }
    if (detail && typeof detail === "object") {
      const statusCode = detail.status ? `${detail.status}: ` : "";
      const msg = detail.message?.trim() || bodyText.slice(0, 300);
      return `ElevenLabs API error ${status}: ${statusCode}${msg}`;
    }
    if (parsed.message?.trim()) {
      return `ElevenLabs API error ${status}: ${parsed.message}`;
    }
  } catch {
    // fall through
  }
  const snippet = bodyText.trim().slice(0, 300);
  return snippet
    ? `ElevenLabs API error ${status}: ${snippet}`
    : `ElevenLabs API error ${status}`;
}

/**
 * POST /api/tts — synthesizes speech for avatar or phone UI.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();

    if (!voiceId || !apiKey) {
      return NextResponse.json(
        { error: "ELEVENLABS_VOICE_ID or ELEVENLABS_API_KEY missing." },
        { status: 500 }
      );
    }

    const body = (await req.json()) as TtsRequestBody;
    const { text } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }
    if (trimmedText.length > TTS_MAX_TEXT_CHARS) {
      return NextResponse.json({ error: `text can be at most ${TTS_MAX_TEXT_CHARS} characters.` }, { status: 400 });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: trimmedText,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: ELEVENLABS_STABILITY,
            similarity_boost: ELEVENLABS_SIMILARITY_BOOST,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const message = elevenLabsErrorMessage(response.status, errText);
      console.error("TTS ElevenLabs failure:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const data = (await response.json()) as {
      audio_base64?: string;
      alignment?: unknown;
    };

    const { words, wtimes, wdurations, chars, ctimes, cdurations } = timingsFromAlignment(
      data.alignment
    );

    const payload: TtsResponseBody = {
      audioBase64: data.audio_base64,
      words,
      wtimes,
      wdurations,
      chars,
      ctimes,
      cdurations,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("TTS route error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate TTS";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
