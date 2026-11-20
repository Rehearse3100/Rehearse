/**
 * call-clock.test.ts
 * The live call's clock rules (lib/call-clock.ts), shared by the live Dana and Dr. Kim
 * calls (hooks/useSimulationVoiceSession.ts) and the /tester/ai-call page: the call time
 * and the Silence readout, the time marks (wrap-up start, final stretch, time up), the
 * two silent turns (the check-in, then afterCheckIn), the start request's localTime, the
 * mm:ss readout, the hold while the student is speaking, a failed silent turn not counting,
 * Silence restarting when the microphone is unmuted, and the end-of-speech fallback's
 * estimate (speechFallbackMs). Pure functions: every rule
 * takes the time as a number, so nothing here needs a browser or a timer.
 */

import { describe, expect, it } from "vitest";
import { CALL_PERSONAS, CALL_TIMINGS } from "@/lib/call-config";
import {
  CLOCK_TICK_MS,
  SPEECH_FALLBACK_BASE_MS,
  SPEECH_FALLBACK_MAX_MS,
  SPEECH_FALLBACK_MIN_MS,
  SPEECH_FALLBACK_PER_WORD_MS,
  TIME_MARKS,
  USER_SPEECH_DROPPED_MS,
  WEEKDAY_NAMES,
  callSecondsAt,
  clockAfterMicUnmuted,
  clockAfterReplyFinished,
  clockAfterSilentTurnFailed,
  clockAfterStudentSpeechStarted,
  clockAfterTurnSent,
  dueSilenceTurn,
  dueTimeMark,
  emptyCallClock,
  endCallClock,
  formatClock,
  isStudentsTurn,
  localTimeAt,
  silenceSecondsAt,
  speechFallbackMs,
  startCallClock,
  timeMarksReached,
  type CallClock,
} from "@/lib/call-clock";

const TIMINGS = CALL_TIMINGS.tempo_discovery;
/** Any start time: the rules only use differences. */
const T0 = 1_700_000_000_000;
const at = (seconds: number): number => T0 + seconds * 1000;

/** A call that started at T0 and whose opening reply finished at `repliedAt` seconds. */
function openedClock(repliedAt = 0): CallClock {
  const sent = clockAfterTurnSent(emptyCallClock(), T0, "start", TIMINGS);
  return clockAfterReplyFinished(sent, at(repliedAt));
}

describe("constants", () => {
  it("the timers and the time marks in call-time order", () => {
    expect(CLOCK_TICK_MS).toBe(250);
    expect([SPEECH_FALLBACK_BASE_MS, SPEECH_FALLBACK_PER_WORD_MS, SPEECH_FALLBACK_MIN_MS, SPEECH_FALLBACK_MAX_MS]).toEqual([
      2_000, 400, 3_000, 30_000,
    ]);
    expect(USER_SPEECH_DROPPED_MS).toBe(10_000);
    expect([...TIME_MARKS]).toEqual(["wrapUpStart", "finalStretch", "callLength"]);
    for (const persona of CALL_PERSONAS) {
      const timings = CALL_TIMINGS[persona];
      expect(timings.wrapUpStart < timings.finalStretch && timings.finalStretch < timings.callLength, persona).toBe(true);
      expect(timings.callLength < timings.backstop, persona).toBe(true);
    }
  });
});

describe("speechFallbackMs: the end-of-speech fallback, 2 s + 0.4 s per word, 3 s to 30 s", () => {
  it.each([
    ["no words: the 3 s floor", "", 3_000],
    ["only whitespace: no words", "  \n\t ", 3_000],
    ["one word (2.4 s): the 3 s floor", "Okay.", 3_000],
    ["two words: exactly 2.8 s, still the floor", "Okay, bye.", 3_000],
    ["three words: 3.2 s", "Thanks, bye now.", 3_200],
    ["extra whitespace between words counts once", "  Thanks,\n  bye   now. ", 3_200],
    ["ten words: 6 s", "one two three four five six seven eight nine ten", 6_000],
    ["70 words: exactly 30 s", Array(70).fill("word").join(" "), 30_000],
    ["100 words: the 30 s cap", Array(100).fill("word").join(" "), 30_000],
  ])("%s", (_name, text, expected) => {
    expect(speechFallbackMs(text)).toBe(expected);
  });
});

describe("call time and Silence", () => {
  it("an empty clock: stopped at 00:00, nothing due", () => {
    const clock = emptyCallClock();
    expect(clock).toEqual({ startedAt: null, endedAt: null, offsetSeconds: 0, silenceSince: null, silenceTurnsSent: 0, timeMarksDone: 0 });
    expect(callSecondsAt(clock, at(50))).toBe(0);
    expect(silenceSecondsAt(clock, at(50))).toBe(0);
    expect(isStudentsTurn(clock, false)).toBe(false);
    expect(dueTimeMark(clock, at(5000), TIMINGS, false)).toBeNull();
    expect(dueSilenceTurn(clock, at(5000), TIMINGS, false)).toBeNull();
  });

  it("startCallClock starts once; Silence counts from the start", () => {
    const started = startCallClock(emptyCallClock(), T0);
    expect(started.startedAt).toBe(T0);
    expect(started.silenceSince).toBe(T0);
    expect(startCallClock(started, at(30))).toBe(started);
  });

  it("the call time: whole seconds, plus the offsets, frozen when the call ends", () => {
    const started = startCallClock(emptyCallClock(), T0);
    expect(callSecondsAt(started, at(0))).toBe(0);
    expect(callSecondsAt(started, T0 + 1999)).toBe(1);
    expect(callSecondsAt(started, at(65))).toBe(65);
    expect(callSecondsAt({ ...started, offsetSeconds: 30 }, at(65))).toBe(95);
    // A clock read before its start never goes below 0.
    expect(callSecondsAt(started, T0 - 5000)).toBe(0);
    const ended = endCallClock(started, at(100));
    expect(callSecondsAt(ended, at(500))).toBe(100);
    // Ending twice keeps the first end.
    expect(endCallClock(ended, at(200))).toBe(ended);
  });

  it("Silence: 0 on the persona's turn, counting from the reply's end, frozen at the end", () => {
    const sent = clockAfterTurnSent(emptyCallClock(), T0, "start", TIMINGS);
    // The persona's turn (the opening is being spoken).
    expect(sent.silenceSince).toBeNull();
    expect(silenceSecondsAt(sent, at(4))).toBe(0);
    const replied = clockAfterReplyFinished(sent, at(4));
    expect(silenceSecondsAt(replied, at(4))).toBe(0);
    expect(silenceSecondsAt(replied, T0 + 15_900)).toBe(11);
    const ended = endCallClock(replied, at(10));
    expect(silenceSecondsAt(ended, at(60))).toBe(6);
  });

  it("clockAfterReplyFinished: no change before the start or after the end", () => {
    const empty = emptyCallClock();
    expect(clockAfterReplyFinished(empty, at(3))).toBe(empty);
    const ended = endCallClock(openedClock(), at(10));
    expect(clockAfterReplyFinished(ended, at(20))).toBe(ended);
  });
});

describe("turns sent", () => {
  it("any turn starts the call if needed and holds Silence until its reply finishes", () => {
    for (const via of ["start", "spoken", "typed", "silence", "timeMark"] as const) {
      const sent = clockAfterTurnSent(emptyCallClock(), T0, via, TIMINGS);
      expect(sent.startedAt, via).toBe(T0);
      expect(sent.silenceSince, via).toBeNull();
      expect(isStudentsTurn(sent, false), via).toBe(false);
    }
  });

  it("silent turns move on (check-in, afterCheckIn, then none); the student's turn re-arms them; a time mark leaves them", () => {
    let clock = openedClock();
    clock = clockAfterTurnSent(clock, at(20), "silence", TIMINGS);
    expect(clock.silenceTurnsSent).toBe(1);
    clock = clockAfterTurnSent(clockAfterReplyFinished(clock, at(23)), at(33), "silence", TIMINGS);
    expect(clock.silenceTurnsSent).toBe(2);
    clock = clockAfterTurnSent(clock, at(60), "silence", TIMINGS);
    expect(clock.silenceTurnsSent).toBe(2);
    expect(clockAfterTurnSent(clock, at(70), "timeMark", TIMINGS).silenceTurnsSent).toBe(2);
    expect(clockAfterTurnSent(clock, at(70), "spoken", TIMINGS).silenceTurnsSent).toBe(0);
    expect(clockAfterTurnSent(clock, at(70), "typed", TIMINGS).silenceTurnsSent).toBe(0);
  });

  it("a time-mark or student turn marks every time mark reached so far as done; a silent turn doesn't", () => {
    const clock = openedClock();
    expect(clockAfterTurnSent(clock, at(850), "spoken", TIMINGS).timeMarksDone).toBe(2);
    expect(clockAfterTurnSent(clock, at(850), "timeMark", TIMINGS).timeMarksDone).toBe(2);
    expect(clockAfterTurnSent(clock, at(850), "silence", TIMINGS).timeMarksDone).toBe(0);
    expect(clockAfterTurnSent(clock, at(100), "spoken", TIMINGS).timeMarksDone).toBe(0);
    // Never goes back down.
    expect(clockAfterTurnSent({ ...clock, timeMarksDone: 3 }, at(100), "spoken", TIMINGS).timeMarksDone).toBe(3);
  });
});

describe("what is due on the student's turn", () => {
  it("timeMarksReached counts the marks the call time has reached", () => {
    expect(timeMarksReached(0, TIMINGS)).toBe(0);
    expect(timeMarksReached(TIMINGS.wrapUpStart - 1, TIMINGS)).toBe(0);
    expect(timeMarksReached(TIMINGS.wrapUpStart, TIMINGS)).toBe(1);
    expect(timeMarksReached(TIMINGS.finalStretch, TIMINGS)).toBe(2);
    expect(timeMarksReached(TIMINGS.callLength, TIMINGS)).toBe(3);
    expect(timeMarksReached(TIMINGS.backstop, TIMINGS)).toBe(3);
  });

  it("isStudentsTurn: started, not ended, not busy, and the reply has finished", () => {
    const clock = openedClock(2);
    expect(isStudentsTurn(clock, false)).toBe(true);
    expect(isStudentsTurn(clock, true)).toBe(false);
    expect(isStudentsTurn({ ...clock, silenceSince: null }, false)).toBe(false);
    expect(isStudentsTurn(endCallClock(clock, at(5)), false)).toBe(false);
  });

  it("dueTimeMark: the latest mark reached that isn't done, only on the student's turn", () => {
    const clock = openedClock(2);
    expect(dueTimeMark(clock, at(TIMINGS.wrapUpStart - 1), TIMINGS, false)).toBeNull();
    expect(dueTimeMark(clock, at(TIMINGS.wrapUpStart), TIMINGS, false)).toBe("wrapUpStart");
    // A jump over several marks sends only the last.
    expect(dueTimeMark(clock, at(TIMINGS.callLength + 5), TIMINGS, false)).toBe("callLength");
    // Busy, the persona's turn, or the call ended: nothing.
    expect(dueTimeMark(clock, at(TIMINGS.wrapUpStart), TIMINGS, true)).toBeNull();
    expect(dueTimeMark({ ...clock, silenceSince: null }, at(TIMINGS.wrapUpStart), TIMINGS, false)).toBeNull();
    expect(dueTimeMark(endCallClock(clock, at(10)), at(TIMINGS.wrapUpStart), TIMINGS, false)).toBeNull();
    // Once sent, the next mark only.
    const sent = clockAfterReplyFinished(clockAfterTurnSent(clock, at(TIMINGS.wrapUpStart), "timeMark", TIMINGS), at(TIMINGS.wrapUpStart + 4));
    expect(dueTimeMark(sent, at(TIMINGS.wrapUpStart + 5), TIMINGS, false)).toBeNull();
    expect(dueTimeMark(sent, at(TIMINGS.finalStretch), TIMINGS, false)).toBe("finalStretch");
  });

  it("dueSilenceTurn: the check-in at the silence timing, then afterCheckIn, then nothing until the student speaks", () => {
    let clock = openedClock(3);
    expect(dueSilenceTurn(clock, at(3 + TIMINGS.silence - 1), TIMINGS, false)).toBeNull();
    expect(dueSilenceTurn(clock, at(3 + TIMINGS.silence), TIMINGS, false)).toBe("checkIn");
    expect(dueSilenceTurn(clock, at(3 + TIMINGS.silence), TIMINGS, true)).toBeNull();
    // The check-in goes; Silence counts again from its reply.
    clock = clockAfterReplyFinished(clockAfterTurnSent(clock, at(23), "silence", TIMINGS), at(26));
    expect(dueSilenceTurn(clock, at(26 + TIMINGS.silenceAfterCheckIn - 1), TIMINGS, false)).toBeNull();
    expect(dueSilenceTurn(clock, at(26 + TIMINGS.silenceAfterCheckIn), TIMINGS, false)).toBe("afterCheckIn");
    // After both: nothing, however long the silence.
    clock = clockAfterReplyFinished(clockAfterTurnSent(clock, at(36), "silence", TIMINGS), at(39));
    expect(dueSilenceTurn(clock, at(500), TIMINGS, false)).toBeNull();
    // The student speaks: the check-in is armed again.
    clock = clockAfterReplyFinished(clockAfterTurnSent(clock, at(600), "spoken", TIMINGS), at(604));
    expect(dueSilenceTurn(clock, at(604 + TIMINGS.silence), TIMINGS, false)).toBe("checkIn");
  });
});

describe("the student's speech holds Silence", () => {
  it("on the student's turn Silence holds at 00:00 (and nothing comes due) until it restarts", () => {
    const clock = openedClock(2);
    const held = clockAfterStudentSpeechStarted(clock, false);
    expect(held.silenceSince).toBeNull();
    expect(silenceSecondsAt(held, at(200))).toBe(0);
    expect(dueSilenceTurn(held, at(200), TIMINGS, false)).toBeNull();
    expect(dueTimeMark(held, at(TIMINGS.wrapUpStart), TIMINGS, false)).toBeNull();
    // They stop at 40 s: Silence counts from there.
    const released = clockAfterReplyFinished(held, at(40));
    expect(silenceSecondsAt(released, at(55))).toBe(15);
    expect(dueSilenceTurn(released, at(40 + TIMINGS.silence), TIMINGS, false)).toBe("checkIn");
  });

  it("no change when it isn't the student's turn", () => {
    const sent = clockAfterTurnSent(openedClock(2), at(10), "spoken", TIMINGS);
    expect(clockAfterStudentSpeechStarted(sent, false)).toBe(sent);
    const opened = openedClock(2);
    expect(clockAfterStudentSpeechStarted(opened, true)).toBe(opened);
    const ended = endCallClock(opened, at(5));
    expect(clockAfterStudentSpeechStarted(ended, false)).toBe(ended);
    const empty = emptyCallClock();
    expect(clockAfterStudentSpeechStarted(empty, false)).toBe(empty);
  });
});

describe("a failed silent turn and the microphone unmuted", () => {
  it("clockAfterSilentTurnFailed: the failed silent turn doesn't count (never below 0)", () => {
    const checkIn = clockAfterTurnSent(openedClock(), at(20), "silence", TIMINGS);
    expect(clockAfterSilentTurnFailed(checkIn).silenceTurnsSent).toBe(0);
    expect(clockAfterSilentTurnFailed({ ...checkIn, silenceTurnsSent: 2 }).silenceTurnsSent).toBe(1);
    expect(clockAfterSilentTurnFailed({ ...checkIn, silenceTurnsSent: 0 }).silenceTurnsSent).toBe(0);
    // Its reply's end still restarts Silence, and the check-in comes due again.
    const released = clockAfterReplyFinished(clockAfterSilentTurnFailed(checkIn), at(21));
    expect(dueSilenceTurn(released, at(21 + TIMINGS.silence), TIMINGS, false)).toBe("checkIn");
  });

  it("clockAfterMicUnmuted: on the student's turn Silence restarts from zero", () => {
    const opened = openedClock(2);
    const unmuted = clockAfterMicUnmuted(opened, at(60), false);
    expect(unmuted.silenceSince).toBe(at(60));
    expect(silenceSecondsAt(unmuted, at(60))).toBe(0);
    expect(dueSilenceTurn(unmuted, at(60 + TIMINGS.silence - 1), TIMINGS, false)).toBeNull();
    expect(dueSilenceTurn(unmuted, at(60 + TIMINGS.silence), TIMINGS, false)).toBe("checkIn");
  });

  it("clockAfterMicUnmuted: no change when it isn't the student's turn", () => {
    const opened = openedClock(2);
    expect(clockAfterMicUnmuted(opened, at(60), true)).toBe(opened);
    const sent = clockAfterTurnSent(opened, at(10), "spoken", TIMINGS);
    expect(clockAfterMicUnmuted(sent, at(60), false)).toBe(sent);
    const ended = endCallClock(opened, at(5));
    expect(clockAfterMicUnmuted(ended, at(60), false)).toBe(ended);
    const empty = emptyCallClock();
    expect(clockAfterMicUnmuted(empty, at(60), false)).toBe(empty);
  });
});

describe("localTime and the readout", () => {
  it("localTimeAt: the weekday and part of day in the browser's own time zone", () => {
    // 19 November 2026 is a Thursday (the Date constructor here is local time).
    expect(localTimeAt(new Date(2026, 10, 19, 9, 0))).toEqual({ weekday: "Thursday", partOfDay: "morning" });
    expect(localTimeAt(new Date(2026, 10, 19, 11, 59))).toEqual({ weekday: "Thursday", partOfDay: "morning" });
    expect(localTimeAt(new Date(2026, 10, 19, 12, 0))).toEqual({ weekday: "Thursday", partOfDay: "afternoon" });
    expect(localTimeAt(new Date(2026, 10, 19, 16, 59))).toEqual({ weekday: "Thursday", partOfDay: "afternoon" });
    expect(localTimeAt(new Date(2026, 10, 19, 17, 0))).toEqual({ weekday: "Thursday", partOfDay: "evening" });
    expect(localTimeAt(new Date(2026, 10, 22, 0, 0)).weekday).toBe("Sunday");
    expect(WEEKDAY_NAMES).toHaveLength(7);
  });

  it("formatClock: mm:ss, minutes past 59, never negative", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(5)).toBe("00:05");
    expect(formatClock(59.9)).toBe("00:59");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(900)).toBe("15:00");
    expect(formatClock(3600)).toBe("60:00");
    expect(formatClock(-3)).toBe("00:00");
  });
});
