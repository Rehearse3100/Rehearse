/**
 * call-config.ts
 * The shared call brain's settings and wire types (client-safe: numbers and names only,
 * never prompt or card text). The server half is lib/server/call-brain.ts; the route is
 * POST /api/student/call-turn. The browser reads CALL_TIMINGS to run the call clock (time
 * marks, silence check-ins), and the Anam session route reads each persona's
 * voiceDetectionOptions. The /tester/ai-call page uses the same values.
 */

import type { ChatPersona } from "@/lib/chat-personas";
import type { ChatMessage } from "@/types";

// ── Personas ───

/** The personas the call brain runs: Dana (Discovery) and Dr. Kim (Objection Handling). */
export const CALL_PERSONAS = ["tempo_discovery", "tempo_objections"] as const satisfies readonly ChatPersona[];

export type CallPersona = (typeof CALL_PERSONAS)[number];

// ── Timings ───

/** Anam's voice detection settings sent with the session token (only the ones we set). */
export type CallVoiceDetectionOptions = {
  /** Noise reduction on the student's mic, 0 to 1 (Anam's default 0.8). */
  speechEnhancementLevel: number;
};

/** Call timings, in seconds of call time (the callSeconds the browser sends). */
export type CallTimings = {
  /** The call's length: from here the persona ends the call. */
  callLength: number;
  /** From here the persona starts steering towards wrapping up. */
  wrapUpStart: number;
  /** From here the persona wraps up now. */
  finalStretch: number;
  /** The browser's silence check-in fires at this much silence. */
  silence: number;
  /** Still silent this long after the check-in's reply: the browser's afterCheckIn turn (the persona ends the call). */
  silenceAfterCheckIn: number;
  /** From here there is no model call at all: the call just ends. */
  backstop: number;
  /** For the Anam session token, not the brain. */
  voiceDetectionOptions: CallVoiceDetectionOptions;
};

export const CALL_TIMINGS: Record<CallPersona, CallTimings> = {
  tempo_discovery: {
    callLength: 900,
    wrapUpStart: 720,
    finalStretch: 840,
    silence: 20,
    silenceAfterCheckIn: 10,
    backstop: 1080,
    voiceDetectionOptions: { speechEnhancementLevel: 1 },
  },
  tempo_objections: {
    callLength: 900,
    wrapUpStart: 720,
    finalStretch: 840,
    silence: 20,
    silenceAfterCheckIn: 10,
    backstop: 1080,
    voiceDetectionOptions: { speechEnhancementLevel: 1 },
  },
};

// ── Labels ───

/** What the brain's label call can say about the student's latest message. */
export const STUDENT_LABELS = ["normal", "unclear", "off_topic", "rude", "break_character", "crisis", "goodbye"] as const;

export type StudentLabel = (typeof STUDENT_LABELS)[number];

// ── POST /api/student/call-turn ───

/**
 * The request body. Exactly one kind of turn: the student's newMessage, or start, timeMark
 * or silent: true (then no newMessage; afterCheckIn: true only with silent). localTime goes
 * with start; strikes (how many rude and break_character labels this call has had, 0 to 9)
 * with every turn. The /tester/ai-call chat route takes the same body without attemptId.
 */
export type CallTurnRequest = {
  attemptId: string;
  persona: CallPersona;
  /** The conversation so far (user and assistant turns). */
  messages: ChatMessage[];
  newMessage?: string;
  /** The call time shown, in whole seconds. */
  callSeconds: number;
  /** Seconds since the persona's last reply finished. */
  silenceSeconds: number;
  start?: true;
  timeMark?: true;
  silent?: true;
  afterCheckIn?: true;
  localTime?: { weekday: string; partOfDay: "morning" | "afternoon" | "evening" };
  strikes?: { rude: number; breakCharacter: number };
};

/** The response: the persona's line; endCall: true when the call ends with it; label on turns with the student's text. */
export type CallTurnResponse = {
  reply: string;
  endCall?: true;
  label?: StudentLabel;
};

/** Any 4xx or 5xx: a short message, never a provider's error text. */
export type CallTurnErrorResponse = { error: string };
