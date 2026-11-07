/**
 * route.ts — /api/chat
 * POST — a call persona's next spoken line (GPT-4o). Signed-in students only, and the
 * attempt must be theirs. The browser sends a persona key (lib/chat-personas.ts),
 * never a prompt: the server builds the system prompt (lib/server/persona-prompts.ts),
 * byte-for-byte what the browser used to send. "simulation" (legacy teacher-made
 * simulations) reads the attempt's simulation persona prompt and, at objections, the
 * attempt's saved presentation transcript. A systemPrompt in the body is ignored.
 * History keeps only user and assistant turns, the latest 60; every message and the
 * new one are at most 2,000 characters.
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { requireStudentApi } from "@/lib/api-auth";
import { cleanChatHistory } from "@/lib/chat-history";
import { parseChatPersona, parseLegacyChatStage, type LegacyChatStage } from "@/lib/chat-personas";
import { CHAT_MAX_MESSAGE_CHARS, MAX_TOKENS } from "@/lib/constants";
import { CHAT_SYSTEM_PROMPT } from "@/lib/persona";
import { buildPersonaSystemPrompt, type PersonaPromptContext } from "@/lib/server/persona-prompts";
import { createServiceClient } from "@/lib/supabase/server";
import type { ChatRequestBody } from "@/types";

function createOpenAiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

/**
 * POST /api/chat — generates the persona's next spoken line.
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

    const body = (await req.json()) as ChatRequestBody;
    const { newMessage } = body;

    if (!newMessage || typeof newMessage !== "string") {
      return NextResponse.json({ error: "newMessage is required." }, { status: 400 });
    }
    const persona = parseChatPersona(body.persona);
    if (!persona) {
      return NextResponse.json({ error: "Unknown persona." }, { status: 400 });
    }
    const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    if (!attemptId) {
      return NextResponse.json({ error: "attemptId is required." }, { status: 400 });
    }
    const legacyStage: LegacyChatStage | null = persona === "simulation" ? parseLegacyChatStage(body.stage) : null;
    if (persona === "simulation" && !legacyStage) {
      return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
    }

    const prior = cleanChatHistory(body.messages);
    if (newMessage.length > CHAT_MAX_MESSAGE_CHARS || prior.some((m) => m.content.length > CHAT_MAX_MESSAGE_CHARS)) {
      return NextResponse.json(
        { error: `Messages can be at most ${CHAT_MAX_MESSAGE_CHARS} characters.` },
        { status: 400 }
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

    // A legacy simulation's persona is its own prompt from the database; at
    // objections the hint quotes the attempt's saved pitch.
    const context: PersonaPromptContext = {};
    if (persona === "simulation") {
      const { data: simulation, error: simulationError } = await supabase
        .from("simulations")
        .select("persona_system_prompt")
        .eq("id", attempt.simulation_id)
        .maybeSingle();
      if (simulationError || !simulation) {
        console.error("[/api/chat] simulation", simulationError);
        return NextResponse.json({ error: "Could not load the simulation." }, { status: 500 });
      }
      context.simulationPrompt = String(simulation.persona_system_prompt ?? "");
      context.legacyStage = legacyStage;
      if (legacyStage === "objections") {
        const { data: pitch } = await supabase
          .from("stage_scores")
          .select("transcript")
          .eq("attempt_id", attemptId)
          .eq("stage", "presentation")
          .maybeSingle();
        context.pitchText = typeof pitch?.transcript === "string" ? pitch.transcript : "";
      }
    }

    // As before: an empty prompt falls back to the generic persona.
    const system = buildPersonaSystemPrompt(persona, context).trim() || CHAT_SYSTEM_PROMPT;

    const openai = createOpenAiClient(apiKey);
    const conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...prior.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: newMessage },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: MAX_TOKENS,
      messages: conversationHistory,
    });

    const reply =
      response.choices[0]?.message?.content?.trim() || "I don't have time for this.";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("Chat route error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate response";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
