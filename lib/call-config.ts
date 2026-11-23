/**
 * call-config.ts
 * The shared call brain's settings and wire types (client-safe: numbers and names only,
 * never prompt or card text). The server half is lib/server/call-brain.ts; the route is
 * POST /api/student/call-turn. The browser reads CALL_TIMINGS to run the call clock (time
 * marks, silence check-ins, the mute reminder, the lost-connection limit; the clock rules
 * are lib/call-clock.ts), and the Anam session routes read each persona's
 * voiceDetectionOptions and anamMaxSessionLengthSeconds. The live Dana and Dr. Kim calls
 * (hooks/useSimulationVoiceSession.ts) and the /tester/ai-call page use the same values.
 */

import type { ChatPersona } from "@/lib/chat-personas";
import type { ChatMessage } from "@/types";

// ── Personas ───

/** The personas the call brain runs: Dana (Discovery) and Dr. Kim (Objection Handling). */
export const CALL_PERSONAS = ["tempo_discovery", "tempo_objections"] as const satisfies readonly ChatPersona[];

export type CallPersona = (typeof CALL_PERSONAS)[number];

/** True for the personas the call brain runs (they use /api/student/call-turn, not /api/chat). */
export function isCallPersona(persona: ChatPersona): persona is CallPersona {
  return CALL_PERSONAS.some((key) => key === persona);
}

// ── Timings ───

/** Anam's voice detection settings sent with the session token (only the ones we set). */
export type CallVoiceDetectionOptions = {
  /** Noise reduction on the student's mic, 0 to 1 (Anam's default 0.8). */
  speechEnhancementLevel: number;
  /**
   * How long the student can be silent before Anam ends the session itself, 0 to 7200 s
   * (Anam's default 60; its docs don't say whether the persona speaking restarts it). Set
   * well above our own silence endings, which take about 60 to 80 s of student silence when
   * muted (mute reminder, check-in, then the persona's goodbye), so ours always come first.
   */
  silenceBeforeSessionEndSeconds: number;
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
  /** Muted this long on the student's turn: the browser's muted turn (the persona says they seem to be on mute), once per muted stretch. */
  mutedReminder: number;
  /** From here there is no model call at all: the call just ends. */
  backstop: number;
  /** The connection lost this long (the browser offline, or Anam's connection closed while offline): the call ends ("connection_lost"). */
  connectionLostLimit: number;
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
    mutedReminder: 10,
    backstop: 1080,
    connectionLostLimit: 300,
    voiceDetectionOptions: { speechEnhancementLevel: 1, silenceBeforeSessionEndSeconds: 180 },
  },
  tempo_objections: {
    callLength: 900,
    wrapUpStart: 720,
    finalStretch: 840,
    silence: 20,
    silenceAfterCheckIn: 10,
    mutedReminder: 10,
    backstop: 1080,
    connectionLostLimit: 300,
    voiceDetectionOptions: { speechEnhancementLevel: 1, silenceBeforeSessionEndSeconds: 180 },
  },
};

/** How far past the backstop an Anam session may run before Anam itself ends it. */
const ANAM_SESSION_MARGIN_SECONDS = 60;

/**
 * The Anam session's maxSessionLengthSeconds (sent with the session token): the backstop
 * plus ANAM_SESSION_MARGIN_SECONDS (1,140 s today), so no Anam session runs longer than
 * that even if the browser never ends it. Anam counts from when the persona starts streaming.
 * @param timings - The call persona's timings
 * @returns The limit in seconds
 */
export function anamMaxSessionLengthSeconds(timings: CallTimings): number {
  return timings.backstop + ANAM_SESSION_MARGIN_SECONDS;
}

// ── Labels ───

/** What the brain's label call can say about the student's latest message. */
export const STUDENT_LABELS = ["normal", "unclear", "off_topic", "rude", "break_character", "crisis", "goodbye"] as const;

export type StudentLabel = (typeof STUDENT_LABELS)[number];

// ── End reasons ───

/**
 * Why the brain ended the call (sent with endCall): one per ending note (time up, goodbye,
 * a second rude or break_character, silence after the check-in, crisis), or the backstop.
 */
export const CALL_END_REASONS = ["time_up", "goodbye", "rude", "break_character", "silence", "crisis", "backstop"] as const;

export type CallEndReason = (typeof CALL_END_REASONS)[number];

/**
 * Why a live call ended, as saved with the transcript: the brain's reason, "student" (the
 * end-call button) or "connection_lost" (the browser's own: the connection stayed lost).
 */
export type CallSessionEndReason = CallEndReason | "student" | "connection_lost";

// ── POST /api/student/call-turn ───

/**
 * The request body. Exactly one kind of turn: the student's newMessage, or start, timeMark,
 * silent or muted: true (then no newMessage; afterCheckIn: true only with silent). localTime
 * goes with start; strikes (how many rude and break_character labels this call has had, 0
 * to 9) with every turn. The /tester/ai-call chat route takes the same body without attemptId.
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
  /** The student's mic has been muted for mutedReminder seconds on their turn. */
  muted?: true;
  localTime?: { weekday: string; partOfDay: "morning" | "afternoon" | "evening" };
  strikes?: { rude: number; breakCharacter: number };
};

/**
 * The response: the persona's line; endCall: true when the call ends with it, with
 * endReason; label on turns with the student's text.
 */
export type CallTurnResponse = {
  reply: string;
  endCall?: true;
  endReason?: CallEndReason;
  label?: StudentLabel;
};

/** Any 4xx or 5xx: a short message, never a provider's error text. */
export type CallTurnErrorResponse = { error: string };
