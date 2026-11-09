/**
 * route.ts — POST /tester/ai-call/api/chat (TESTER ONLY)
 * The tester AI call's own call brain for Dana (tempo_discovery) and Dr. Kim
 * (tempo_objections): the persona prompts, shared rules plus one card per persona
 * (persona-cards.ts), and the call behaviour around them (brain.ts). The real /api/chat
 * is untouched.
 *
 * 404 unless tester mode is on (the same check as page.tsx: a copy of
 * isGateBypassEnabled() in lib/tempo-test-bypass.ts). No attempt id and no sign-in: tester
 * mode is local only (docs/tempo-test-bypass.md), and nothing is written anywhere.
 *
 * Body: { persona, model?, messages, newMessage?, callSeconds, silenceSeconds, silent?, afterCheckIn?, start?, timeMark?, localTime?, strikes? }.
 * Response: { reply, endCall?: true, label?, ms } (ms: this handler's time). endCall: true
 * exactly when the turn's situation note is an ending note (crisis, callLength, goodbye,
 * rudeEnd, breakEnd, silentEnd), whatever the reply says; [END_CALL] in the reply is only
 * removed from the text. From the backstop on there is no model call: { reply: "",
 * endCall: true }. A failed, timed-out (15 s) or empty reply call is retried once, then the
 * reply is FALLBACK_REPLY (endCall still follows the note); an error's text never reaches
 * the page.
 *
 * A turn with a newMessage also gets a label call (gpt-6-luna, no retries, 5 s timeout)
 * that classifies the student's message, in parallel with the usual reply call. A label
 * of normal, a failed label call or an answer that isn't a label keeps that reply.
 * Otherwise, if the label changes the turn's situation note, the reply is discarded and
 * one more reply call is made with the label's note. The label is returned so the page
 * can count strikes.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  buildLabelMessages,
  buildTesterMessages,
  FALLBACK_REPLY,
  finishReply,
  isEndingNote,
  isPastBackstop,
  LABEL_REQUEST_SETTINGS,
  parseLabel,
  parseTesterTurn,
  pickSituationNote,
  TESTER_PERSONA_SETTINGS,
  type ModelRequestSettings,
  type StudentLabel,
  type TesterMessage,
} from "./brain";

export const dynamic = "force-dynamic";

/** The first try plus one retry (the SDK's own retries are off, so this is the only retry). */
const MODEL_ATTEMPTS = 2;
/** Each try gives up after this long and counts as failed (the SDK's default is 10 minutes). */
const MODEL_TIMEOUT_MS = 15_000;
/** The label call gives up after this long (one try, no retry) and counts as normal. */
const LABEL_TIMEOUT_MS = 5_000;

/** The student's label, or "normal" when the label call fails or times out (logged here only). */
async function askLabel(openai: OpenAI, messages: TesterMessage[]): Promise<StudentLabel> {
  try {
    const completion = await openai.chat.completions.create(
      { ...LABEL_REQUEST_SETTINGS, messages },
      { timeout: LABEL_TIMEOUT_MS, maxRetries: 0 }
    );
    return parseLabel(completion.choices[0]?.message?.content ?? null);
  } catch (error) {
    console.error("[tester-chat] label call failed:", error);
    return "normal";
  }
}

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
    const replySettings = settings.models[turn.model];
    const isLabelled = turn.newMessage !== null;
    // The label call and the usual reply call run at the same time.
    const [label, normalContent] = await Promise.all([
      isLabelled ? askLabel(openai, buildLabelMessages(turn)) : Promise.resolve<StudentLabel>("normal"),
      askModel(openai, replySettings, buildTesterMessages(turn, settings.timings)),
    ]);
    const note = pickSituationNote(turn, settings.timings, label);
    // A label whose note doesn't win this turn would resend the same messages: keep the reply.
    const isNoteChanged = note !== pickSituationNote(turn, settings.timings);
    const content = isNoteChanged ? await askModel(openai, replySettings, buildTesterMessages(turn, settings.timings, label)) : normalContent;
    const reply = content === null ? FALLBACK_REPLY : finishReply(content);
    // The code decides every ending: the note, never [END_CALL] in the reply.
    const isEndCall = isEndingNote(note);
    return NextResponse.json({ reply, ...(isEndCall ? { endCall: true } : {}), ...(isLabelled ? { label } : {}), ms: elapsedMs() });
  } catch (error) {
    console.error("[tester-chat] unexpected:", error);
    return NextResponse.json({ error: "Could not generate a reply." }, { status: 500 });
  }
}
