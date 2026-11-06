/**
 * data-room-chat-guard.ts
 * Safety checks the Data Room chat route (app/api/student/data-room-chat) runs on
 * every question before its answer pipeline, in this order: the 500-character cap,
 * the per-attempt message limit (USAGE_TOTAL_MAX rows in public.data_room_chat_usage;
 * skipped in tester mode by the route; fail open), counting the message, OpenAI moderation
 * (fail open), and the non-Latin-script check that runs before the router's own
 * English check. Every refusal is a fixed reply from GUARD_REPLIES (the one place
 * the texts live), in the same shape as the route's other fixed replies: no
 * opening sentence, no findings. The chat input (ProspectingDataRoomChat) uses the
 * same character cap.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type OpenAI from "openai";
import type { ScopedAnswer } from "@/lib/data-room-chat-scope";

// ── Limits ───

/** Longest question accepted (the input box stops here too). */
export const DATA_ROOM_CHAT_MAX_CHARS = 500;
/** The input box shows its "N / 500" counter past this many characters. */
export const DATA_ROOM_CHAT_COUNTER_FROM = 400;
/** Questions per attempt over the whole simulation (no per-minute limit). */
export const USAGE_TOTAL_MAX = 300;
/** More than this share of the letters in a non-Latin script reads as not English. */
export const NON_LATIN_MAX_SHARE = 0.3;
export const MODERATION_MODEL = "omni-moderation-latest";
export const USAGE_TABLE = "data_room_chat_usage";

// ── Fixed replies ───

export const GUARD_REPLIES = {
  tooLong: "Please keep your question under 500 characters.",
  totalLimit:
    "You've reached the research assistant's limit for this simulation. Use your notes and the company pages to finish your research.",
  selfHarm:
    "It sounds like you might be going through something hard. I'm only a research assistant, but you don't have to deal with it alone. In the US you can call or text 988 to reach the Suicide & Crisis Lifeline at any time; elsewhere, your local emergency number or a crisis line can help.",
  flagged: "I can only help with researching these companies. Please keep questions professional.",
  notEnglish: "Please ask in English.",
} as const;

export type GuardReplyKey = keyof typeof GUARD_REPLIES;

/** A fixed reply in the route's fixed-reply shape: the text alone, no findings. */
export function guardReply(key: GuardReplyKey): ScopedAnswer {
  return { intro: GUARD_REPLIES[key], items: [] };
}

// ── Checks ───

export function isTooLong(message: string): boolean {
  return message.length > DATA_ROOM_CHAT_MAX_CHARS;
}

/**
 * The attempt's message limit: "totalLimit" once it has asked USAGE_TOTAL_MAX
 * questions, else null (one count query; how fast it asks doesn't matter).
 * Fails open: if the table is missing or the count fails, it logs and allows.
 */
export async function checkUsageLimits(
  supabase: SupabaseClient,
  attemptId: string
): Promise<"totalLimit" | null> {
  try {
    const { count, error } = await supabase
      .from(USAGE_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attemptId);
    if (error) {
      throw error;
    }
    return (count ?? 0) >= USAGE_TOTAL_MAX ? "totalLimit" : null;
  } catch (error) {
    console.error("[data-room-chat] usage limits unavailable, allowing:", error);
    return null;
  }
}

/** Counts the question (one row). A failed insert is logged and ignored. */
export async function recordUsage(
  supabase: SupabaseClient,
  attemptId: string,
  studentId: string,
  now: number = Date.now()
): Promise<void> {
  try {
    const { error } = await supabase
      .from(USAGE_TABLE)
      .insert({ attempt_id: attemptId, student_id: studentId, created_at: new Date(now).toISOString() });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("[data-room-chat] usage count failed:", error);
  }
}

/**
 * OpenAI moderation on the message only: "selfHarm" when flagged in any self-harm
 * category, "flagged" when flagged for anything else, null when clean. Errors are
 * logged and count as clean (the rest of the pipeline only shows database facts).
 */
export async function moderateMessage(openai: OpenAI, message: string): Promise<"selfHarm" | "flagged" | null> {
  try {
    const response = await openai.moderations.create({ model: MODERATION_MODEL, input: message });
    const result = response.results[0];
    if (!result?.flagged) {
      return null;
    }
    const isSelfHarm = Object.entries(result.categories ?? {}).some(
      ([category, hit]) => category.startsWith("self-harm") && hit === true
    );
    return isSelfHarm ? "selfHarm" : "flagged";
  } catch (error) {
    console.error("[data-room-chat] moderation failed, continuing:", error);
    return null;
  }
}

const LETTER = new RegExp("\\p{L}", "gu");
const LATIN_LETTER = new RegExp("\\p{Script=Latin}", "gu");

/** True when more than NON_LATIN_MAX_SHARE of the text's letters are in a non-Latin script. */
export function isMostlyNonLatin(text: string): boolean {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) {
    return false;
  }
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  return (letters - latin) / letters > NON_LATIN_MAX_SHARE;
}
