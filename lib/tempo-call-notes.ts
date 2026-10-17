/**
 * tempo-call-notes.ts
 * AI call notes for the Tempo Reference Library (pure; no DB, no network). POST
 * /api/student/call-notes writes them once per finished call with one gpt-4o call
 * that sees ONLY the saved transcript, validates the reply here, and stores it in
 * stage_scores.call_notes; the Call notes card in components/tempo/TempoReferenceLibrary.tsx
 * shows them. Plain facts from the transcript only: no grading, advice or scores.
 */

import type { ReferenceCallStage, ReferenceTranscriptMessage } from "@/lib/tempo-reference-library";

/** The stored notes; also the model's JSON reply shape. */
export type CallNotes = {
  /** Two sentences on what the call covered. */
  summary: string;
  told_you: string[];
  concerns: string[];
  committed: string[];
};

/** Most bullets kept in each group. */
export const MAX_CALL_NOTE_BULLETS = 3;

/** The call-notes call's instructions (it sees only the transcript). */
export const CALL_NOTES_SYSTEM_PROMPT = [
  'You write short call notes for a sales-training student after a practice sales call. You see only the call transcript. Lines starting with "Student:" are the student (the sales rep); the other speaker is the prospect.',
  "Reply with a single JSON object and nothing else:",
  '{"summary": string, "told_you": string[], "concerns": string[], "committed": string[]}',
  "",
  "Rules:",
  "- summary: two sentences on what the call covered.",
  "- told_you: up to 3 facts the prospect shared about their business, situation or needs.",
  "- concerns: up to 3 concerns or objections the prospect raised.",
  "- committed: up to 3 things the student agreed or promised to do next.",
  "- Use only plain facts stated in the transcript. Never add anything that isn't in it.",
  "- No grading, no advice and no scoring: never say what the student did well or badly, or what they should do.",
  "- Use an empty list when the transcript has nothing for a group.",
].join("\n");

/** The call's messages: the system prompt and the transcript, one "Speaker: text" line per message. */
export function buildCallNotesMessages(
  transcript: readonly ReferenceTranscriptMessage[]
): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: CALL_NOTES_SYSTEM_PROMPT },
    {
      role: "user",
      content: transcript
        .map((message) => `${message.speaker === "student" ? "Student" : message.name}: ${message.content}`)
        .join("\n"),
    },
  ];
}

function bulletList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    return null;
  }
  return (raw as string[])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_CALL_NOTE_BULLETS);
}

/**
 * Validates notes (a model reply, a stored value or a route response): a
 * non-empty summary and three string lists (trimmed, empty items dropped, at most
 * 3 each). Anything else is null.
 */
export function parseCallNotes(raw: unknown): CallNotes | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const toldYou = bulletList(record.told_you);
  const concerns = bulletList(record.concerns);
  const committed = bulletList(record.committed);
  if (!summary || !toldYou || !concerns || !committed) {
    return null;
  }
  return { summary, told_you: toldYou, concerns, committed };
}

/** The model's text reply as notes, or null when it isn't valid JSON of the right shape. */
export function parseCallNotesReply(text: string | null | undefined): CallNotes | null {
  try {
    return parseCallNotes(JSON.parse(text ?? ""));
  } catch {
    return null;
  }
}

/** The route's request body: { attemptId, stage } with stage "discovery" or "objections". */
export function parseCallNotesBody(raw: unknown): { attemptId: string; stage: ReferenceCallStage } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { attemptId, stage } = raw as Record<string, unknown>;
  if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
    return null;
  }
  return stage === "discovery" || stage === "objections" ? { attemptId: attemptId.trim(), stage } : null;
}
