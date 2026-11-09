/**
 * brain.ts — SERVER ONLY (tester AI call)
 * The tester call brain's own behaviour, on top of the copied prompts (persona-copy.ts):
 * the settings for each persona (models and call timings), reading the request body,
 * the one situation note per turn, the message list sent to the model, [END_CALL]
 * handling and the dash filter. Pure (no network); route.ts makes the model call.
 *
 * Message order: the fixed system prompt, the cleaned history, then at most one
 * situation note as a system message, then the student's message (none for a start,
 * silent or time-mark turn). The note comes after the fixed prompt and history so the
 * fixed prompt stays cached.
 *
 * The call timings live in ../../timings.json (numbers only), which the page reads too:
 * the page never imports this file.
 */

import TIMINGS_FILE from "../../timings.json";
import { buildPersonaSystemPrompt, CHAT_MAX_MESSAGE_CHARS, cleanChatHistory, type ChatMessage } from "./persona-copy";

// ── Personas and settings ───

export const TESTER_PERSONAS = ["tempo_discovery", "tempo_objections"] as const;
export type TesterPersona = (typeof TESTER_PERSONAS)[number];

export const TESTER_MODELS = ["gpt-6-luna", "gpt-4o"] as const;
export type TesterModel = (typeof TESTER_MODELS)[number];

/** One model's Chat Completions settings (the messages are added by the caller). */
export type ModelRequestSettings = {
  model: TesterModel;
  reasoning_effort?: "none";
  max_completion_tokens?: number;
  max_tokens?: number;
};

/** Call timings, in seconds of call time (the callSeconds the page sends). */
export type CallTimings = {
  /** The call's length: from here the persona ends the call. */
  callLength: number;
  /** From here the persona starts steering towards wrapping up. */
  wrapUpStart: number;
  /** From here the persona wraps up now. */
  finalStretch: number;
  /** The page's silence check-in fires at this much silence. */
  silence: number;
  /** From here there is no model call at all: the call just ends. */
  backstop: number;
};

export type TesterPersonaSettings = {
  /** Used when the body names no model. */
  defaultModel: TesterModel;
  /** gpt-6-luna rejects max_tokens, so its cap goes under max_completion_tokens; gpt-4o has no reasoning effort. */
  models: Record<TesterModel, ModelRequestSettings>;
  timings: CallTimings;
};

/** The timings file, typed: a persona or a number missing there fails the type check. */
const TIMINGS: Record<TesterPersona, CallTimings> = TIMINGS_FILE;

/** Everything tunable, one object per persona (the timings come from timings.json). */
export const TESTER_PERSONA_SETTINGS: Record<TesterPersona, TesterPersonaSettings> = {
  tempo_discovery: {
    defaultModel: "gpt-6-luna",
    models: {
      "gpt-6-luna": { model: "gpt-6-luna", reasoning_effort: "none", max_completion_tokens: 200 },
      "gpt-4o": { model: "gpt-4o", max_tokens: 200 },
    },
    timings: TIMINGS.tempo_discovery,
  },
  tempo_objections: {
    defaultModel: "gpt-6-luna",
    models: {
      "gpt-6-luna": { model: "gpt-6-luna", reasoning_effort: "none", max_completion_tokens: 200 },
      "gpt-4o": { model: "gpt-4o", max_tokens: 200 },
    },
    timings: TIMINGS.tempo_objections,
  },
};

// ── Situation notes ───

export const SITUATION_NOTES = {
  start:
    "The call has just started. Open it naturally in your own words and in character: greet them and set the scene in one or two sentences.",
  wrapUpStart: "Time is getting short. Start steering the conversation towards wrapping up.",
  finalStretch: "You need to wrap up now. Summarise next steps briefly and politely.",
  callLength:
    "Time is up. End the call now: thank them and say goodbye in one or two sentences, then end your reply with [END_CALL].",
  silent: "The student has been quiet for a while. Check in briefly and naturally, in character.",
} as const;

/** The marker the model ends its last reply with; removed from the reply, it becomes endCall: true. */
export const END_CALL_MARKER = "[END_CALL]";

/** The reply when the model call fails twice or returns nothing. */
export const FALLBACK_REPLY = "Sorry, could you say that again?";

// ── The request ───

/** One turn, read from the request body. */
export type TesterTurn = {
  persona: TesterPersona;
  model: TesterModel;
  history: ChatMessage[];
  /** The student's message; null for a start, silent or time-mark turn (no student text is added). */
  newMessage: string | null;
  callSeconds: number;
  silenceSeconds: number;
  isStart: boolean;
  isSilent: boolean;
  /** The page's turn at a time mark: the persona speaks first, with the note for callSeconds. */
  isTimeMark: boolean;
};

function wholeSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Reads { persona, model?, messages, newMessage?, callSeconds, silenceSeconds, silent?, start?, timeMark? }.
 * persona must be one of the two; model one of the two (the persona's default when missing);
 * newMessage is required unless start, timeMark or silent is true (in that order, the first
 * true one wins); every message is at most CHAT_MAX_MESSAGE_CHARS, as in /api/chat.
 * callSeconds and silenceSeconds that aren't numbers count as 0. Returns the turn or a
 * short error.
 */
export function parseTesterTurn(body: unknown): { turn: TesterTurn } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "The body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  const persona = TESTER_PERSONAS.find((key) => key === raw.persona);
  if (!persona) {
    return { error: "Unknown persona." };
  }
  const model = raw.model === undefined ? TESTER_PERSONA_SETTINGS[persona].defaultModel : TESTER_MODELS.find((key) => key === raw.model);
  if (!model) {
    return { error: "Unknown model." };
  }
  const isStart = raw.start === true;
  const isTimeMark = !isStart && raw.timeMark === true;
  const isSilent = !isStart && !isTimeMark && raw.silent === true;
  let newMessage: string | null = null;
  if (!isStart && !isTimeMark && !isSilent) {
    if (typeof raw.newMessage !== "string" || !raw.newMessage) {
      return { error: "newMessage is required." };
    }
    newMessage = raw.newMessage;
  }
  const history = cleanChatHistory(raw.messages);
  if ((newMessage?.length ?? 0) > CHAT_MAX_MESSAGE_CHARS || history.some((message) => message.content.length > CHAT_MAX_MESSAGE_CHARS)) {
    return { error: `Messages can be at most ${CHAT_MAX_MESSAGE_CHARS} characters.` };
  }
  return {
    turn: {
      persona,
      model,
      history,
      newMessage,
      callSeconds: wholeSeconds(raw.callSeconds),
      silenceSeconds: wholeSeconds(raw.silenceSeconds),
      isStart,
      isSilent,
      isTimeMark,
    },
  };
}

/** True from the backstop on: no model call, the call just ends. */
export function isPastBackstop(turn: TesterTurn, timings: CallTimings): boolean {
  return turn.callSeconds >= timings.backstop;
}

/**
 * The turn's one situation note, or null. When several apply, the first of: start,
 * time up (callLength), final stretch, silent, wrap-up start. The ending notes beat the
 * silence check-in so a quiet student can't keep the call from ending; the check-in beats
 * the gentle wrap-up nudge because a silent turn has nothing else to answer. A time-mark
 * turn gets the note for its callSeconds, like any other turn.
 */
export function pickSituationNote(turn: TesterTurn, timings: CallTimings): string | null {
  if (turn.isStart) {
    return SITUATION_NOTES.start;
  }
  if (turn.callSeconds >= timings.callLength) {
    return SITUATION_NOTES.callLength;
  }
  if (turn.callSeconds >= timings.finalStretch) {
    return SITUATION_NOTES.finalStretch;
  }
  if (turn.isSilent) {
    return SITUATION_NOTES.silent;
  }
  if (turn.callSeconds >= timings.wrapUpStart) {
    return SITUATION_NOTES.wrapUpStart;
  }
  return null;
}

export type TesterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

/**
 * The messages for the model: as /api/chat assembles them (the persona's system prompt,
 * trimmed; the history; the new message), plus the situation note as a system message
 * right before the student's message.
 */
export function buildTesterMessages(turn: TesterTurn, timings: CallTimings): TesterMessage[] {
  const note = pickSituationNote(turn, timings);
  return [
    { role: "system", content: buildPersonaSystemPrompt(turn.persona).trim() },
    ...turn.history.map((message): TesterMessage => ({ role: message.role, content: message.content })),
    ...(note ? [{ role: "system" as const, content: note }] : []),
    ...(turn.newMessage !== null ? [{ role: "user" as const, content: turn.newMessage }] : []),
  ];
}

// ── The reply ───

/** Tidies what a removal left behind: no doubled spaces, no space before punctuation, no doubled punctuation. */
function tidyAfterRemoval(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?:[ \t]*[,;:])+/g, "$1")
    .replace(/,[ \t]*([.!?])/g, "$1")
    .replace(/([.!?])[ \t]*,/g, "$1")
    .trim();
}

/**
 * Replaces en dashes (–) and em dashes (—) so the sentence still reads naturally:
 * - a range reads "to": "2–3 weeks" → "2 to 3 weeks", "Monday–Friday" → "Monday to Friday";
 * - otherwise a full stop when a new sentence follows (a capital letter other than "I"),
 *   else a comma: "We tried that — it failed" → "We tried that, it failed";
 * - a dash at the end becomes a full stop; one at the start, or next to punctuation, goes.
 * Text without a dash comes back unchanged.
 */
export function removeDashes(text: string): string {
  if (!/[–—]/.test(text)) {
    return text;
  }
  const ranges = text.replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2").replace(/([A-Za-z])–([A-Za-z])/g, "$1 to $2");
  const replaced = ranges.replace(/\s*[–—]+\s*/g, (match: string, offset: number, whole: string): string => {
    const before = whole.slice(0, offset);
    const after = whole.slice(offset + match.length);
    if (before.trim() === "") {
      return "";
    }
    if (after.trim() === "") {
      return ".";
    }
    if (/[.,;:!?…]$/.test(before)) {
      return " ";
    }
    if (/^[.,;:!?…)\]"'’”]/.test(after)) {
      return "";
    }
    return /^[A-Z]/.test(after) && !/^I\b/.test(after) ? ". " : ", ";
  });
  return tidyAfterRemoval(replaced);
}

/**
 * The reply as sent to the page: [END_CALL] removed (and reported as isEndCall), then
 * the dash filter. A reply without either comes back trimmed and otherwise unchanged.
 */
export function finishReply(raw: string): { reply: string; isEndCall: boolean } {
  const isEndCall = raw.toUpperCase().includes(END_CALL_MARKER);
  const withoutMarker = isEndCall ? tidyAfterRemoval(raw.replace(/\[END_CALL\]/gi, " ")) : raw.trim();
  return { reply: removeDashes(withoutMarker), isEndCall };
}
