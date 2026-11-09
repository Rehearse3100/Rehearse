/**
 * route.ts — POST /tester/ai-call/api/chat (TESTER ONLY)
 * The tester AI call's own call brain for Dana (tempo_discovery) and Dr. Kim
 * (tempo_objections): a copy of how POST /api/chat builds their messages
 * (persona-copy.ts) with the new call behaviour on top (brain.ts). The real /api/chat
 * is untouched.
 *
 * 404 unless tester mode is on (the same check as page.tsx: a copy of
 * isGateBypassEnabled() in lib/tempo-test-bypass.ts). No attempt id and no sign-in: tester
 * mode is local only (docs/tempo-test-bypass.md), and nothing is written anywhere.
 *
 * Body: { persona, model?, messages, newMessage?, callSeconds, silenceSeconds, silent?, start?, timeMark? }.
 * Response: { reply, endCall?: true, ms } (ms: this handler's time). From the backstop on
 * there is no model call: { reply: "", endCall: true }. A failed, timed-out (15 s) or empty
 * model call is retried once, then the reply is FALLBACK_REPLY; an error's text never
 * reaches the page.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  buildTesterMessages,
  FALLBACK_REPLY,
  finishReply,
  isPastBackstop,
  parseTesterTurn,
  TESTER_PERSONA_SETTINGS,
  type ModelRequestSettings,
  type TesterMessage,
} from "./brain";

export const dynamic = "force-dynamic";

/** The first try plus one retry (the SDK's own retries are off, so this is the only retry). */
const MODEL_ATTEMPTS = 2;
/** Each try gives up after this long and counts as failed (the SDK's default is 10 minutes). */
const MODEL_TIMEOUT_MS = 15_000;

/**
 * The reply text, or null when every attempt failed or came back empty (each failure
 * is logged here, never sent to the page).
 */
async function askModel(openai: OpenAI, settings: ModelRequestSettings, messages: TesterMessage[]): Promise<string | null> {
  for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
    try {
      const completion = await openai.chat.completions.create({ ...settings, messages });
      const content = completion.choices[0]?.message?.content?.trim() ?? "";
      if (content) {
        return content;
      }
      console.warn(`[tester-chat] empty reply from ${settings.model} (attempt ${attempt})`);
    } catch (error) {
      console.error(`[tester-chat] ${settings.model} call failed (attempt ${attempt}):`, error);
    }
  }
  return null;
}

/**
 * POST /tester/ai-call/api/chat — the persona's next line for the tester page.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.TEMPO_TEST_BYPASS_GATES !== "true") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const startedAt = performance.now();
  const elapsedMs = (): number => Math.round(performance.now() - startedAt);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
    }
    const parsed = parseTesterTurn(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { turn } = parsed;
    const settings = TESTER_PERSONA_SETTINGS[turn.persona];

    if (isPastBackstop(turn, settings.timings)) {
      return NextResponse.json({ reply: "", endCall: true, ms: elapsedMs() });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: MODEL_TIMEOUT_MS });
    const content = await askModel(openai, settings.models[turn.model], buildTesterMessages(turn, settings.timings));
    const { reply, isEndCall } = content === null ? { reply: FALLBACK_REPLY, isEndCall: false } : finishReply(content);
    return NextResponse.json({ reply, ...(isEndCall ? { endCall: true } : {}), ms: elapsedMs() });
  } catch (error) {
    console.error("[tester-chat] unexpected:", error);
    return NextResponse.json({ error: "Could not generate a reply." }, { status: 500 });
  }
}
