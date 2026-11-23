/**
 * call-clock.ts
 * The live call's clock: pure rules (every one takes the time as a number, so they need
 * no browser) for the call time, the Silence readout, the time marks (wrap-up start, final
 * stretch, time up), the two silent turns (the check-in, then afterCheckIn) and the mute
 * reminder (muted time counts as silence; the reminder comes first), from CALL_TIMINGS in
 * lib/call-config.ts. Client-safe. Used by the live Dana and Dr. Kim calls
 * (hooks/useSimulationVoiceSession.ts) and the /tester/ai-call page, which keeps its own
 * test controls (+30 sec) and reads these rules from here.
 */

import type { CallTimings } from "@/lib/call-config";

// ── Time marks and timers ───

/** The time marks in call-time order; each fires once per call. Call time is amber from the first, red from the last. */
export const TIME_MARKS = ["wrapUpStart", "finalStretch", "callLength"] as const;

export type TimeMark = (typeof TIME_MARKS)[number];

/** How often the readouts refresh. */
export const CLOCK_TICK_MS = 250;
/** The end-of-speech fallback (speechFallbackMs): a fixed allowance, plus this much per word, within the bounds below. */
export const SPEECH_FALLBACK_BASE_MS = 2_000;
export const SPEECH_FALLBACK_PER_WORD_MS = 400;
export const SPEECH_FALLBACK_MIN_MS = 3_000;
export const SPEECH_FALLBACK_MAX_MS = 30_000;
/**
 * Anam's guidance (its JavaScript SDK events reference): a USER_SPEECH_STARTED with no
 * USER_SPEECH_ENDED this long after it is a dropped detection, so a missed end can't
 * hold the Silence readout forever.
 */
export const USER_SPEECH_DROPPED_MS = 10_000;

/**
 * How long after talk(text) to wait for Anam's end of speech before counting the reply as
 * spoken anyway (Silence then counts from there; after the closing line, the call ends):
 * an estimate of how long the reply takes to say, 2 s plus 0.4 s per word (words are
 * separated by whitespace), at least 3 s and at most 30 s. A real end of speech still
 * finishes the reply earlier.
 */
export function speechFallbackMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const estimate = SPEECH_FALLBACK_BASE_MS + SPEECH_FALLBACK_PER_WORD_MS * words;
  return Math.min(SPEECH_FALLBACK_MAX_MS, Math.max(SPEECH_FALLBACK_MIN_MS, estimate));
}

// ── Turn sources ───

/** The turns that carry the student's text. */
export type StudentTurnSource = "typed" | "spoken";

/** "muted": the mute reminder (muted: true), sent by dueMutedReminder. */
export type TurnSource = StudentTurnSource | "silence" | "muted" | "start" | "timeMark";

// ── Call clock (pure: every rule takes the time as a number, so it needs no browser) ───

/** The call timer's state. Times are Date.now() milliseconds. */
export type CallClock = {
  /** When the call started (Start call or the first turn), or null before that. */
  startedAt: number | null;
  /** When the persona ended the call; both readouts freeze here. */
  endedAt: number | null;
  /** The "+30 sec" presses, in seconds. */
  offsetSeconds: number;
  /** What the Silence readout counts from; null = the persona's turn (shown as 00:00). */
  silenceSince: number | null;
  /**
   * Silent turns sent since the student's last turn (or Start call): 0 = the check-in may
   * fire, 1 = the afterCheckIn turn may fire, 2 = neither until the student speaks.
   */
  silenceTurnsSent: number;
  /** How many of TIME_MARKS are done this call (0 to 3); a mark jumped over counts as done. */
  timeMarksDone: number;
  /** When the student's current muted stretch began; null while the mic is on. */
  mutedSince: number | null;
  /** The mute reminder has gone this muted stretch (once per stretch). */
  isMutedReminderSent: boolean;
};

/** A stopped clock at 00:00 (the page's start, and "Reset chat"). */
export function emptyCallClock(): CallClock {
  return {
    startedAt: null,
    endedAt: null,
    offsetSeconds: 0,
    silenceSince: null,
    silenceTurnsSent: 0,
    timeMarksDone: 0,
    mutedSince: null,
    isMutedReminderSent: false,
  };
}

/** Starts the call at `now` (Silence counts from the start); no change once started. */
export function startCallClock(clock: CallClock, now: number): CallClock {
  return clock.startedAt === null ? { ...clock, startedAt: now, silenceSince: now } : clock;
}

/** The call time shown at `now`, in whole seconds: real elapsed time (frozen at the end) plus offsets. */
export function callSecondsAt(clock: CallClock, now: number): number {
  const elapsedMs = clock.startedAt === null ? 0 : (clock.endedAt ?? now) - clock.startedAt;
  return Math.max(0, Math.floor(elapsedMs / 1000)) + clock.offsetSeconds;
}

/** The Silence readout at `now`, in whole seconds (0 before the call and during the persona's turn). */
export function silenceSecondsAt(clock: CallClock, now: number): number {
  if (clock.startedAt === null || clock.silenceSince === null) {
    return 0;
  }
  return Math.max(0, Math.floor(((clock.endedAt ?? now) - clock.silenceSince) / 1000));
}

/** How many of TIME_MARKS the call time `seconds` has reached (0 to 3). */
export function timeMarksReached(seconds: number, timings: CallTimings): number {
  return TIME_MARKS.filter((mark) => seconds >= timings[mark]).length;
}

/**
 * A turn was sent at `now`: starts the call if needed, and holds Silence at 00:00 until the
 * reply finishes. The student's turn (or Start call) re-arms both silent turns; each silent
 * turn moves on to the next (check-in, then afterCheckIn, then none); a time mark or the
 * mute reminder leaves them as they were (so after the reminder's reply, Silence counts to
 * the check-in as usual). The mute reminder is then done for this muted stretch. A
 * time-mark or student turn marks every time mark reached so far as done: the brain adds
 * the note for the call time to every turn, so a student turn sent after a crossing has
 * already carried it.
 */
export function clockAfterTurnSent(clock: CallClock, now: number, via: TurnSource, timings: CallTimings): CallClock {
  const started = startCallClock(clock, now);
  const isMarkDelivered = via === "timeMark" || via === "typed" || via === "spoken";
  const isSilenceKept = via === "timeMark" || via === "muted";
  return {
    ...started,
    silenceSince: null,
    silenceTurnsSent: via === "silence" ? Math.min(2, started.silenceTurnsSent + 1) : isSilenceKept ? started.silenceTurnsSent : 0,
    timeMarksDone: isMarkDelivered
      ? Math.max(started.timeMarksDone, timeMarksReached(callSecondsAt(started, now), timings))
      : started.timeMarksDone,
    isMutedReminderSent: via === "muted" ? true : started.isMutedReminderSent,
  };
}

/**
 * A silent turn whose request failed doesn't count: silenceTurnsSent goes back one (not
 * below 0), so the same silent turn can come due again.
 */
export function clockAfterSilentTurnFailed(clock: CallClock): CallClock {
  return { ...clock, silenceTurnsSent: Math.max(0, clock.silenceTurnsSent - 1) };
}

/** A mute reminder whose request failed doesn't count either: it can come due again this muted stretch. */
export function clockAfterMutedTurnFailed(clock: CallClock): CallClock {
  return { ...clock, isMutedReminderSent: false };
}

/**
 * The student muted their mic at `now`: a muted stretch begins (its reminder not yet
 * sent). Silence keeps counting: muted time is silence. No change while already muted.
 */
export function clockAfterMicMuted(clock: CallClock, now: number): CallClock {
  return clock.mutedSince === null ? { ...clock, mutedSince: now, isMutedReminderSent: false } : clock;
}

/**
 * The student unmuted their mic: the muted stretch ends. Nothing else is reset (Silence and
 * the silent turns carry on; the student's next turn re-arms them as usual).
 */
export function clockAfterMicUnmuted(clock: CallClock): CallClock {
  return clock.mutedSince === null && !clock.isMutedReminderSent ? clock : { ...clock, mutedSince: null, isMutedReminderSent: false };
}

/** The persona's reply finished at `now` (or the turn failed): Silence counts from here. No change once ended. */
export function clockAfterReplyFinished(clock: CallClock, now: number): CallClock {
  return clock.startedAt === null || clock.endedAt !== null ? clock : { ...clock, silenceSince: now };
}

/** endCall: freezes both readouts at `now`. */
export function endCallClock(clock: CallClock, now: number): CallClock {
  return clock.endedAt === null ? { ...clock, endedAt: now } : clock;
}

/** True while the call runs and it's the student's turn: no reply coming or being spoken. */
export function isStudentsTurn(clock: CallClock, isBusy: boolean): boolean {
  return clock.startedAt !== null && clock.endedAt === null && !isBusy && clock.silenceSince !== null;
}

/**
 * The time mark to send now, or null: the latest mark the call time has reached that
 * isn't done yet (so a jump over several sends only the last), on the student's turn.
 */
export function dueTimeMark(clock: CallClock, now: number, timings: CallTimings, isBusy: boolean): TimeMark | null {
  const reached = timeMarksReached(callSecondsAt(clock, now), timings);
  return isStudentsTurn(clock, isBusy) && reached > clock.timeMarksDone ? TIME_MARKS[reached - 1] ?? null : null;
}

/**
 * The silent turn to send now, or null, on the student's turn: the check-in when Silence
 * reaches the silence timing, or, once the check-in went, the afterCheckIn turn when
 * Silence (counting again from the check-in's reply) reaches silenceAfterCheckIn.
 */
export function dueSilenceTurn(clock: CallClock, now: number, timings: CallTimings, isBusy: boolean): "checkIn" | "afterCheckIn" | null {
  if (!isStudentsTurn(clock, isBusy)) {
    return null;
  }
  const silenceSeconds = silenceSecondsAt(clock, now);
  if (clock.silenceTurnsSent === 0 && silenceSeconds >= timings.silence) {
    return "checkIn";
  }
  return clock.silenceTurnsSent === 1 && silenceSeconds >= timings.silenceAfterCheckIn ? "afterCheckIn" : null;
}

/**
 * Whole seconds the student has been muted on their turn at `now`: counted from the later
 * of the mute and the persona's last reply finishing (0 when not muted or not their turn).
 */
export function mutedSecondsAt(clock: CallClock, now: number): number {
  if (clock.mutedSince === null || clock.silenceSince === null || clock.startedAt === null || clock.endedAt !== null) {
    return 0;
  }
  return Math.max(0, Math.floor((now - Math.max(clock.mutedSince, clock.silenceSince)) / 1000));
}

/**
 * True when the mute reminder is due, on the student's turn: muted for mutedReminder
 * seconds (mutedSecondsAt) and not yet sent this muted stretch. It goes before a due
 * silent turn, so a muted student hears it before the check-in or the silence ending.
 */
export function dueMutedReminder(clock: CallClock, now: number, timings: CallTimings, isBusy: boolean): boolean {
  return isStudentsTurn(clock, isBusy) && !clock.isMutedReminderSent && clock.mutedSince !== null && mutedSecondsAt(clock, now) >= timings.mutedReminder;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The start request's localTime: the weekday and part of day of `date` in the browser's own time zone. */
export function localTimeAt(date: Date): { weekday: string; partOfDay: "morning" | "afternoon" | "evening" } {
  const hour = date.getHours();
  return {
    weekday: WEEKDAY_NAMES[date.getDay()] ?? "Sunday",
    partOfDay: hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening",
  };
}

/** Whole seconds as mm:ss (minutes keep counting past 59). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

// ── The student's speech (live call) ───

/**
 * The student started speaking (Anam's USER_SPEECH_STARTED) on their turn: Silence holds at
 * 00:00, and with it the time marks and check-ins, until clockAfterReplyFinished restarts
 * it (when they stop, after USER_SPEECH_DROPPED_MS with no end, or once their turn's reply
 * finishes). No change when it isn't the student's turn.
 */
export function clockAfterStudentSpeechStarted(clock: CallClock, isBusy: boolean): CallClock {
  return isStudentsTurn(clock, isBusy) ? { ...clock, silenceSince: null } : clock;
}
