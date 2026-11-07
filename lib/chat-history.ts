/**
 * chat-history.ts
 * Cleans the conversation history a browser sends to POST /api/chat before it reaches
 * the model: only "user" and "assistant" turns with text survive (an injected
 * "system" turn, or anything else, is dropped), and only the latest
 * CHAT_MAX_HISTORY_MESSAGES of them. Lengths are checked by the route.
 */

import { CHAT_MAX_HISTORY_MESSAGES } from "@/lib/constants";
import type { ChatMessage } from "@/types";

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
