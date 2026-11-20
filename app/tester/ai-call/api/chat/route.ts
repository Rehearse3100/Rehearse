/**
 * route.ts — POST /tester/ai-call/api/chat (TESTER ONLY)
 * The tester page's turns, through the shared call brain (lib/server/call-brain.ts: the
 * same code POST /api/student/call-turn runs), with no sign-in and no attempt. The real
 * /api/chat is untouched.
 *
 * 404 unless tester mode is on (the same check as page.tsx: a copy of
 * isGateBypassEnabled() in lib/tempo-test-bypass.ts). Tester mode is local only
 * (docs/tempo-test-bypass.md), and nothing is written anywhere.
 *
 * Body: CallTurnRequest (lib/call-config.ts) without attemptId.
 * Response: { reply, endCall?: true, label?, ms } (ms: this handler's time, for the page's
 * transcript). Errors are short messages; a model's error text never reaches the page.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { parseCallTurn, runCallTurn } from "@/lib/server/call-brain";

export const dynamic = "force-dynamic";

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
    const parsed = parseCallTurn(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
    }

    const { reply, endCall, label } = await runCallTurn(parsed.turn, new OpenAI({ apiKey }));
    return NextResponse.json({ reply, ...(endCall ? { endCall: true } : {}), ...(label ? { label } : {}), ms: elapsedMs() });
  } catch (error) {
    console.error("[tester-chat] unexpected:", error);
    return NextResponse.json({ error: "Could not generate a reply." }, { status: 500 });
  }
}
