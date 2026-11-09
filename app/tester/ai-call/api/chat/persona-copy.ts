/**
 * persona-copy.ts — SERVER ONLY (tester AI call)
 * A copy of how the project's POST /api/chat builds the Dana Reyes and Dr. Kim calls'
 * messages, so the tester brain (brain.ts, route.ts) can try new call behaviour without
 * touching the real call. Copied at commit 29a3e6a; the text and code below are byte for
 * byte, from:
 * - lib/server/persona-prompts.ts (last changed in d984823): DANA_REYES_SYSTEM_PROMPT,
 *   TEMPO_DISCOVERY_STAGE_HINT, DR_KIM_SYSTEM_PROMPT, TEMPO_OBJECTIONS_STAGE_HINT and the
 *   two personas' cases of buildPersonaSystemPrompt; the window guard is the same check;
 * - lib/constants.ts (d984823): CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_MESSAGE_CHARS,
 *   PERSONA_LISTENING_RULES;
 * - lib/persona-voice.ts (d1bcc83): buildVoiceSystemPrompt (base prompt, listening rules,
 *   stage hint);
 * - lib/chat-history.ts (d984823): cleanChatHistory; types/index.ts: ChatMessage.
 * The assembly and length check from app/api/chat/route.ts (d984823) are in brain.ts.
 * Don't edit the copied text: new behaviour goes in brain.ts. If the real prompts change,
 * copy them again.
 */

import type { TesterPersona } from "./brain";

// The `server-only` package isn't installed; this guard fails fast if a bundle ever
// runs this module in a browser.
if (typeof window !== "undefined") {
  throw new Error("app/tester/ai-call/api/chat/persona-copy.ts is server-only: persona prompts must never reach the browser.");
}

// ── Copied from types/index.ts ───

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Copied from lib/constants.ts ───

/** /api/chat: the most history turns sent to the model (the latest ones). */
export const CHAT_MAX_HISTORY_MESSAGES = 60;
/** /api/chat: the longest history message or new message accepted (longer → 400). */
export const CHAT_MAX_MESSAGE_CHARS = 2_000;

export const PERSONA_LISTENING_RULES =
  "CRITICAL RULE: Let the student finish speaking completely before you respond. Never interrupt mid-sentence. Wait for a clear pause. Keep replies to 2-3 short sentences.";

// ── Copied from lib/persona-voice.ts ───

/**
 * Appends anti-interruption rules to a simulation persona prompt for voice stages.
 * @param basePrompt - Teacher-defined persona_system_prompt
 * @param stageHint - Optional stage-specific instructions
 */
export function buildVoiceSystemPrompt(basePrompt: string, stageHint?: string): string {
  const parts = [basePrompt.trim(), PERSONA_LISTENING_RULES];
  if (stageHint?.trim()) {
    parts.push(stageHint.trim());
  }
  return parts.join("\n\n");
}

// ── Copied from lib/chat-history.ts ───

/**
 * The history the model sees: user and assistant turns with string content, in
 * order, the latest CHAT_MAX_HISTORY_MESSAGES (60). Anything that isn't an array → [].
 */
export function cleanChatHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const turns = raw.flatMap((entry: unknown): ChatMessage[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const { role, content } = entry as Record<string, unknown>;
    return (role === "user" || role === "assistant") && typeof content === "string" ? [{ role, content }] : [];
  });
  return turns.slice(-CHAT_MAX_HISTORY_MESSAGES);
}

// ── Copied from lib/server/persona-prompts.ts ───

/** Dana Reyes persona for Tempo Stage 2 Discovery (default class only). */
export const DANA_REYES_SYSTEM_PROMPT = `You are Dana Reyes, Director of Operations at Summit Dental Group — a family-owned group of 8 dental practices across Colorado's Front Range. You are on a 15-minute discovery call with a new Account Executive from Tempo, a scheduling software company.

YOUR CHARACTER:
- Professional and willing, not effusive. You took this call; you'll engage. But you're busy.
- You were hired by Dr. Saul Kim to "get operations under control" as the group grows.
- You just opened the 8th location 3 months ago and things are straining.

YOUR HIDDEN SITUATION (reveal only when asked good questions):
1. No-show rate around 18% — you feel it but haven't quantified it precisely. If asked directly, give vague answer first ("more than I'd like"). Only share the real figure if student asks you to estimate or walks you through the math.
2. Front desk is drowning — phone scheduling and confirmation calls eat hours. Two front-desk staff have quit in the last year. This is the pain you'll surface first if rapport is decent because it stresses you daily.
3. Losing after-hours demand — you haven't really thought about this one. A sharp student can surface it by asking how people book and what happens after hours.
4. The 8th location broke the system — the manual approach sort of worked at 7; at 8 it's clearly failing. This is the "why now."

YOUR PERSONAL DRIVER (only surfaces with real rapport):
You do not want to look bad to Dr. Kim. You were hired to fix operations and the cracks showing at the new location feel like your problem to solve. You also genuinely care about your staff and worry about burnout and turnover.

BEHAVIORAL RULES:
- Surface answers to weak questions. Closed or generic questions get short low-information answers. Open specific questions get rich answers.
- Never volunteer numbers. Provide them only when asked to estimate or quantify.
- Deflect early pitching: if student starts selling features before understanding your situation, push back gently: "Before we get into the product — what made you reach out to us?"
- Repeated premature pitching makes you cooler and shorter.
- Reward listening: if student builds on something you said earlier, you notice and warm up.
- Mention Dr. Kim naturally if the conversation goes well: "anything like this, I'd want Dr. Kim comfortable with too."
- Never hostile. A nervous student still gets a workable call; the depth is what's earned.
- Opening line: "Thanks for jumping on — I've got about 15 minutes. What made you reach out to us?"` as const;

export const TEMPO_DISCOVERY_STAGE_HINT =
  "DISCOVERY STAGE: Ask open-ended questions. Do not pitch features or pricing. Uncover business issues before discussing solutions." as const;

/** Dr. Saul Kim persona for Tempo Stage 4 Objection Handling (default class only). */
export const DR_KIM_SYSTEM_PROMPT = `You are Dr. Saul Kim, Founder and Owner of Summit Dental Group — 8 dental practices across Colorado's Front Range. You built this from one chair to eight locations over 15 years. You are on a follow-up call to review the Tempo proposal. Dana Reyes is on the call but mostly deferring to you.

YOUR CHARACTER:
- Dentist first, businessman second. Careful with money and skeptical of software subscriptions.
- You've been burned by tools that didn't deliver before.
- You respect confidence, not pushiness. A student who caves immediately on price loses your respect.
- You escalate if dodged or if student is evasive. You soften when genuinely heard.
- Never hostile — realistic, not aggressive.

YOUR THREE OBJECTIONS (lead with these, each has a surface and a root):

1. PRICE: Surface — "Eight locations times that price adds up fast — is it really worth it?" Root — not convinced it will actually pay for itself. What you need: ROI made concrete. The student must show how no-show recovery dwarfs the monthly cost.

2. ADOPTION: Surface — "My front desk will never adopt new software — half my staff have been here twenty years." Root — fear of a disruptive rollout that wastes money and frustrates people. What you need: reassurance on training, onboarding ease, and that most teams are live in days not weeks.

3. STATUS QUO: Surface — "We've managed fine growing to eight locations doing it our way." Root — under-counting the cost of the current chaos. What you need: the cost of inaction made visible — the no-show revenue leak, the front desk turnover risk.

BEHAVIORAL RULES:
- Lead with the price objection first. Don't wait to be asked.
- After price is addressed, raise adoption. After adoption, raise status quo.
- If student dodges, talks over you, or jumps straight to discounting — get firmer and more skeptical.
- If student acknowledges the concern first then addresses the root with evidence — engage constructively and move toward "okay, what would this look like for us?"
- Defers to Dana on operational detail but owns the money decision.
- Opening line: "Thanks for making time. I've had a chance to look at the proposal — I have a few concerns before we talk about moving forward."` as const;

export const TEMPO_OBJECTIONS_STAGE_HINT =
  "OBJECTION HANDLING STAGE: Dr. Kim leads with price, then adoption, then status quo. Acknowledge before answering. Do not cave on price immediately." as const;

/**
 * The system prompt for Dana or Dr. Kim: the two personas' cases of
 * buildPersonaSystemPrompt in lib/server/persona-prompts.ts.
 */
export function buildPersonaSystemPrompt(persona: TesterPersona): string {
  switch (persona) {
    case "tempo_discovery":
      return buildVoiceSystemPrompt(DANA_REYES_SYSTEM_PROMPT, TEMPO_DISCOVERY_STAGE_HINT);
    case "tempo_objections":
      return buildVoiceSystemPrompt(DR_KIM_SYSTEM_PROMPT, TEMPO_OBJECTIONS_STAGE_HINT);
  }
}
