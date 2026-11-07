/**
 * route.ts — /api/score
 * GPT-4o sales coach scoring for each simulation stage (legacy simulations).
 * Signed-in students only. Every text that goes into the scoring prompt is capped:
 * transcript, pitch, prior-stages summary, product context and lead-gen answers at
 * SCORE_MAX_TEXT_CHARS, persona name / role and product name at
 * SCORE_MAX_SHORT_TEXT_CHARS (longer → 400). simulationContext.personaSystemPrompt is
 * sent by the browser but never used here.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import { MAX_SCORE_TOKENS, SCORE_MAX_SHORT_TEXT_CHARS, SCORE_MAX_TEXT_CHARS } from "@/lib/constants";
import {
  buildScoringPrompt,
  formatLeadGenAnswers,
  parseScoringResponse,
} from "@/lib/scoring";
import type { ScoreRequestBody, ScoreResponseBody, ScoringContext } from "@/types";

/**
 * Creates OpenAI client at request time (build-safe without env at compile).
 */
function createOpenAiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

/**
 * Maps API request body to ScoringContext for prompt building.
 */
function toScoringContext(body: ScoreRequestBody): ScoringContext {
  const { simulationContext, stage } = body;
  return {
    stage,
    personaName: simulationContext.personaName,
    personaRole: simulationContext.personaRole,
    productName: simulationContext.productName?.trim() || "the product",
    productContext: simulationContext.productContext,
    transcript: body.transcript,
    pitchText: body.pitchText,
    studentAnswers: body.studentAnswers
      ? formatLeadGenAnswers(body.studentAnswers)
      : undefined,
    priorStagesSummary: body.priorStagesSummary,
  };
}

/** True when any text the scoring prompt uses is over its cap. */
function exceedsScoreLimits(body: ScoreRequestBody): boolean {
  const isOver = (value: unknown, max: number): boolean => typeof value === "string" && value.length > max;
  const longTexts = [
    body.transcript,
    body.pitchText,
    body.priorStagesSummary,
    body.simulationContext?.productContext,
    body.studentAnswers?.fit,
    body.studentAnswers?.painPoints,
    body.studentAnswers?.openingApproach,
  ];
  const shortTexts = [
    body.simulationContext?.personaName,
    body.simulationContext?.personaRole,
    body.simulationContext?.productName,
  ];
  return (
    longTexts.some((value) => isOver(value, SCORE_MAX_TEXT_CHARS)) ||
    shortTexts.some((value) => isOver(value, SCORE_MAX_SHORT_TEXT_CHARS))
  );
}

/**
 * Calls GPT-4o once with the scoring prompt.
 */
async function requestScore(
  openai: OpenAI,
  prompt: string
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: MAX_SCORE_TOKENS,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0]?.message?.content ?? "{}";
}

/**
 * POST /api/score — returns numeric score and written feedback.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured." }, { status: 500 });
    }

    const body = (await req.json()) as ScoreRequestBody;
    const { stage, simulationContext } = body;

    if (!stage || !simulationContext) {
      return NextResponse.json({ error: "stage and simulationContext are required." }, { status: 400 });
    }
    if (exceedsScoreLimits(body)) {
      return NextResponse.json({ error: "A field is too long to score." }, { status: 400 });
    }

    console.log("[/api/score] scoring stage:", stage);

    const openai = createOpenAiClient(apiKey);
    const context = toScoringContext(body);
    const prompt = buildScoringPrompt(stage, context);

    let raw = await requestScore(openai, prompt);
    let parsed = parseScoringResponse(raw);

    if (!parsed) {
      raw = await requestScore(openai, prompt);
      parsed = parseScoringResponse(raw);
    }

    if (!parsed) {
      const fallback: ScoreResponseBody = {
        score: 0,
        feedback: "Scoring failed. Please try again.",
      };
      return NextResponse.json(fallback);
    }

    const payload: ScoreResponseBody = {
      score: parsed.score,
      feedback: parsed.feedback,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Score route error:", error);
    const message = error instanceof Error ? error.message : "Scoring failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
