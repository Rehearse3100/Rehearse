/**
 * call-voice-session-hook.test.ts
 * hooks/useSimulationVoiceSession.ts on the live Dana / Dr. Kim path (the shared call
 * brain, POST /api/student/call-turn) and on the legacy "simulation" path (POST /api/chat,
 * unchanged): the opening start turn and its gate, the spoken turns with strikes, Anam's
 * end of speech (also when the persona's message is updated in place with the student's
 * words still last) and, with none, the reply's estimate (speechFallbackMs), the silence
 * turns and time marks from the clock, the hold while the student is speaking (and the
 * dropped-detection rule), endCall (mic muted, reply spoken in full, then the avatar stops
 * and onCallEnd gets the reason), the "[call]" diagnostics (no reply or student text),
 * mute (Anam's own input mute on the same stream) and the Anam session config (set at
 * render only). The review fixes: the pending ending's reason, an interruption that keeps
 * the turn in flight (and, during an ending, ends the call only when the closing line is
 * the last talk in flight), mute pausing Silence, queued words flushed on unmute and by the
 * tick, a failed silent turn not counting, an earlier reply's end of speech not finishing
 * the current one, the ending fallback armed before talk() settles, and the local safety
 * stops (the backstop and Anam's connection closing).
 * React's hooks are replaced by a small synchronous stand-in (state, refs and effects
 * kept by call order, like one mounted component); the Avatar module, the Anam SDK's
 * MessageRole and fetch are mocked; timers and Date are fake. Nothing leaves the machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@anam-ai/js-sdk";
import type { AvatarVoiceCallbacks } from "@/components/Avatar";
import { localTimeAt } from "@/lib/call-clock";
import {
  useSimulationVoiceSession,
  type SimulationVoiceConfig,
  type SimulationVoiceReturn,
} from "@/hooks/useSimulationVoiceSession";

// ── A one-component stand-in for React's hooks ───

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cleanups: [] as Array<(() => void) | undefined>,
  index: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = hooks.index++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      const set = (update: unknown): void => {
        hooks.values[slot] = typeof update === "function" ? (update as (prev: unknown) => unknown)(hooks.values[slot]) : update;
      };
      return [hooks.values[slot], set];
    },
    useRef: (initial: unknown) => {
      const slot = hooks.index++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] = { current: initial };
      }
      return hooks.values[slot];
    },
    useCallback: (fn: unknown) => fn,
    // Every effect runs on every render, after its previous cleanup (deps aren't compared).
    useEffect: (effect: () => unknown) => {
      const slot = hooks.index++;
      hooks.cleanups[slot]?.();
      const cleanup = effect();
      hooks.cleanups[slot] = typeof cleanup === "function" ? (cleanup as () => void) : undefined;
    },
  };
});

// ── Avatar, SDK and fetch mocks ───

const avatarModule = vi.hoisted(() => ({ callbacks: {} as AvatarVoiceCallbacks, sessionConfigs: [] as unknown[] }));

vi.mock("@/components/Avatar", () => ({
  getAvatarInitError: (): null => null,
  setAvatarSessionConfig: (sessionConfig: unknown): void => {
    avatarModule.sessionConfigs.push(sessionConfig);
  },
  setAvatarVoiceCallbacks: (callbacks: AvatarVoiceCallbacks): void => {
    avatarModule.callbacks = callbacks;
  },
}));

vi.mock("@anam-ai/js-sdk", () => ({ MessageRole: { USER: "user", PERSONA: "persona" } }));

/** A reply body, an error status, or a promise of either (a reply that comes back later). */
type Reply = Record<string, unknown> | number | Promise<Record<string, unknown> | number>;
const replies: Reply[] = [];

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
  const next = await (replies.shift() ?? { reply: "Mm-hm.", label: "normal" });
  const status = typeof next === "number" ? next : 200;
  return { ok: status === 200, status, json: async () => (typeof next === "number" ? {} : next) };
});

type Sent = { url: string; body: Record<string, unknown> };
const sent = (): Sent[] =>
  fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> }));
const lastSent = (): Sent | undefined => sent()[sent().length - 1];

function fakeAvatar(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    resumeAudioContext: vi.fn(),
    waitUntilReady: vi.fn(async () => true),
    isReady: vi.fn(() => true),
    setInputMuted: vi.fn(),
    beginStreaming: vi.fn(async () => undefined),
    waitForSessionReady: vi.fn(async () => undefined),
    talk: vi.fn(async () => undefined),
    stopSpeaking: vi.fn(),
    endSession: vi.fn(async () => undefined),
    updateInputStream: vi.fn(async () => undefined),
  };
}

const STREAM = { getAudioTracks: () => [{}] } as unknown as MediaStream;

let config: SimulationVoiceConfig;
let messageCount = 0;

/** One render of the hook (state, refs and effects persist between renders). */
function render(): SimulationVoiceReturn {
  hooks.index = 0;
  return useSimulationVoiceSession(config);
}

/** Lets the fetch → json → talk chain finish. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
}

/** Anam's MESSAGE_HISTORY_UPDATED ending on a message from `role`. */
async function historyEndsWith(role: "user" | "persona", content: string): Promise<void> {
  messageCount += 1;
  const message = { id: `${role}::${messageCount}`, role, content } as unknown as Message;
  avatarModule.callbacks.onMessageHistoryUpdated?.([message]);
  await flush();
}

const studentSaid = (text: string): Promise<void> => historyEndsWith("user", text);
const personaFinished = (text = "(spoken)"): Promise<void> => historyEndsWith("persona", text);

/** Starts a Dana call: the start turn answers `opening`; the effects then see isActive. */
async function startDanaCall(opening = "Hi, this is Dana."): Promise<{ avatar: Record<string, ReturnType<typeof vi.fn>>; onCallEnd: ReturnType<typeof vi.fn> }> {
  const onCallEnd = vi.fn();
  config = { persona: "tempo_discovery", attemptId: "attempt-1", anamStage: "discovery", isMutedRef: { current: false }, onCallEnd };
  const voice = render();
  const avatar = fakeAvatar();
  (voice.avatarRef as { current: unknown }).current = avatar;
  replies.push({ reply: opening });
  await voice.startCall(STREAM);
  render();
  return { avatar, onCallEnd };
}

/** The opening has been spoken and the post-speech cooldown has passed. */
async function openingSpoken(): Promise<void> {
  await personaFinished();
  await vi.advanceTimersByTimeAsync(300);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 19, 10, 0, 0));
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // The hook's "[call]" diagnostics: silenced, and read by the tests that check them.
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  fetchMock.mockClear();
  replies.length = 0;
  hooks.values = [];
  hooks.cleanups = [];
  avatarModule.callbacks = {};
  avatarModule.sessionConfigs = [];
  messageCount = 0;
});

afterEach(() => {
  // Unmount: stop the clock tick and timers.
  hooks.cleanups.forEach((cleanup) => cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The live call path ───

describe("Dana / Dr. Kim: the shared call brain", () => {
  it("the opening is the brain's start turn, spoken; the student's speech counts only once it has been spoken", async () => {
    const { avatar } = await startDanaCall();
    expect(sent()).toEqual([
      {
        url: "/api/student/call-turn",
        body: {
          attemptId: "attempt-1",
          persona: "tempo_discovery",
          messages: [],
          callSeconds: 0,
          silenceSeconds: 0,
          start: true,
          localTime: localTimeAt(new Date(2026, 10, 19, 10, 0, 0)),
          strikes: { rude: 0, breakCharacter: 0 },
        },
      },
    ]);
    expect(avatar.talk).toHaveBeenCalledWith("Hi, this is Dana.");
    // Muted before streaming, and still muted while the opening is spoken.
    expect(avatar.setInputMuted.mock.calls).toEqual([[true]]);

    // Heard before the opening was spoken: ignored.
    await vi.advanceTimersByTimeAsync(300);
    await studentSaid("Hello?");
    expect(sent()).toHaveLength(1);

    // The opening has been spoken (Anam's end of speech): the mic opens.
    await personaFinished("Hi, this is Dana.");
    expect(avatar.setInputMuted).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(300);
    await studentSaid("We help dental groups with scheduling.");
    expect(lastSent()).toEqual({
      url: "/api/student/call-turn",
      body: {
        attemptId: "attempt-1",
        persona: "tempo_discovery",
        messages: [{ role: "assistant", content: "Hi, this is Dana." }],
        newMessage: "We help dental groups with scheduling.",
        callSeconds: 0,
        silenceSeconds: 0,
        strikes: { rude: 0, breakCharacter: 0 },
      },
    });
    expect(sent().some((request) => request.url === "/api/chat")).toBe(false);
  });

  it("strikes: counted from each turn's label and sent with the next turns", async () => {
    await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "Excuse me?", label: "rude" });
    await studentSaid("That's a dumb question.");
    await personaFinished();
    await vi.advanceTimersByTimeAsync(300);
    replies.push({ reply: "I'm Dana.", label: "break_character" });
    await studentSaid("Are you an AI?");
    expect(lastSent()?.body.strikes).toEqual({ rude: 1, breakCharacter: 0 });
    await personaFinished();
    await vi.advanceTimersByTimeAsync(300);
    await studentSaid("Sorry. How many offices do you have?");
    expect(lastSent()?.body.strikes).toEqual({ rude: 1, breakCharacter: 1 });
    expect(lastSent()?.body.messages).toEqual([
      { role: "assistant", content: "Hi, this is Dana." },
      { role: "user", content: "That's a dumb question." },
      { role: "assistant", content: "Excuse me?" },
      { role: "user", content: "Are you an AI?" },
      { role: "assistant", content: "I'm Dana." },
    ]);
  });

  it("callSeconds counts from the start turn; the check-in at 20 s of Silence, afterCheckIn 10 s after its reply", async () => {
    await startDanaCall();
    await personaFinished();
    await vi.advanceTimersByTimeAsync(19_900);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 20 });
    expect(lastSent()?.body).not.toHaveProperty("afterCheckIn");
    expect(lastSent()?.body).not.toHaveProperty("newMessage");

    // The check-in's reply has been spoken: Silence counts again from here.
    await personaFinished();
    await vi.advanceTimersByTimeAsync(10_200);
    expect(lastSent()?.body).toMatchObject({ silent: true, afterCheckIn: true, silenceSeconds: 10, callSeconds: 30 });
    expect(render().callSeconds).toBe(30);
  });

  it("the time marks go on the student's turn at 12:00, 14:00 and 15:00 of call time", async () => {
    await startDanaCall();
    await personaFinished();
    // No end-of-speech events from here: each reply counts as spoken after its estimate (speechFallbackMs).
    await vi.advanceTimersByTimeAsync(900_100);
    const marks = sent().filter((request) => request.body.timeMark === true);
    expect(marks.map((request) => request.body.callSeconds)).toEqual([720, 840, 900]);
    // The two silent turns, then none until the student speaks.
    expect(sent().filter((request) => request.body.silent === true)).toHaveLength(2);
  });

  it("while the student is speaking Silence holds (no check-in mid-answer); it counts again when they stop", async () => {
    const { avatar } = await startDanaCall();
    await personaFinished();
    await vi.advanceTimersByTimeAsync(15_000);
    avatarModule.callbacks.onUserSpeechStarted?.("speech-1");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(sent()).toHaveLength(1);
    avatarModule.callbacks.onUserSpeechEnded?.("speech-1");
    await vi.advanceTimersByTimeAsync(19_900);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20 });
    expect(avatar.talk).toHaveBeenCalledTimes(2);
  });

  it("a start with no end within 10 s is a dropped detection: Silence counts again from then", async () => {
    await startDanaCall();
    await personaFinished();
    await vi.advanceTimersByTimeAsync(5_000);
    avatarModule.callbacks.onUserSpeechStarted?.("speech-1");
    // Released at 15 s (10 s after the start), so the check-in comes due at 35 s.
    await vi.advanceTimersByTimeAsync(29_900);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 35 });
  });

  it("endCall: the mic is muted, the reply is spoken in full, then the avatar stops and onCallEnd gets the reason", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await studentSaid("That's all from me, bye.");
    expect(avatar.talk).toHaveBeenLastCalledWith("Thanks, bye now.");
    const muteOrder = avatar.setInputMuted.mock.invocationCallOrder[avatar.setInputMuted.mock.calls.length - 1] ?? 0;
    expect(avatar.setInputMuted).toHaveBeenLastCalledWith(true);
    expect(muteOrder).toBeLessThan(avatar.talk.mock.invocationCallOrder[1] ?? 0);
    // Still speaking: the call hasn't ended yet.
    expect(onCallEnd).not.toHaveBeenCalled();
    expect(avatar.endSession).not.toHaveBeenCalled();

    await personaFinished("Thanks, bye now.");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
    // The clock froze at the end: nothing more is sent, and the call time stays put.
    const seconds = render().callSeconds;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(2);
    expect(render().callSeconds).toBe(seconds);
  });

  it("no end of speech after the closing reply: the call ends after the reply's estimate (5 words: 4 s), not 30 s", async () => {
    const { onCallEnd } = await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "We're out of time, thanks.", endCall: true, endReason: "time_up" });
    await studentSaid("One more thing.");
    await vi.advanceTimersByTimeAsync(3_900);
    expect(onCallEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onCallEnd).toHaveBeenCalledWith("time_up");
  });

  it("no end-of-speech event at all: the opening counts as spoken after its estimate; an ending turn ends the call after the closing line's", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    // "Hi, this is Dana." is 4 words: 2 s + 4 × 0.4 s = 3.6 s, seen at the 3.75 s tick; then the mic opens.
    await vi.advanceTimersByTimeAsync(3_700);
    expect(avatar.setInputMuted).not.toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(avatar.setInputMuted).toHaveBeenLastCalledWith(false);

    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await studentSaid("That's all from me, bye.");
    expect(avatar.talk).toHaveBeenLastCalledWith("Thanks, bye now.");
    // 3 words: 2 s + 3 × 0.4 s = 3.2 s from its talk().
    await vi.advanceTimersByTimeAsync(3_100);
    expect(onCallEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);

    // The diagnostics: one "[call]" line per step, and never the reply's or the student's text.
    const lines = vi.mocked(console.info).mock.calls.map((args) => args.join(" "));
    expect(lines.every((line) => line.startsWith("[call] "))).toBe(true);
    expect(lines).toEqual([
      "[call] turn sent: start",
      "[call] reply received: endCall false, endReason none, label none",
      "[call] talk() sent: fallback 3600 ms, 1 talks in flight",
      "[call] turn sent: spoken",
      "[call] reply received: endCall true, endReason goodbye, label goodbye",
      "[call] talk() sent: fallback 3200 ms, 2 talks in flight",
      "[call] ending finished: by fallback (goodbye)",
    ]);
    for (const text of ["Hi, this is Dana", "Thanks, bye now", "That's all from me"]) {
      expect(lines.join("\n"), text).not.toContain(text);
    }
  });

  it("no end-of-speech event at all: the check-in at 20 s of Silence, afterCheckIn 10 s after the check-in's estimate", async () => {
    await startDanaCall();
    replies.push({ reply: "Hello? Are you still there?" });
    // The opening counts as spoken at 3.75 s (its 3.6 s estimate), so the check-in is due at 23.75 s.
    await vi.advanceTimersByTimeAsync(23_700);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 23 });
    expect(lastSent()?.body).not.toHaveProperty("afterCheckIn");

    // Its reply (5 words: 4 s) counts as spoken at 27.75 s; afterCheckIn 10 s later, at 37.75 s.
    await vi.advanceTimersByTimeAsync(13_900);
    expect(sent()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastSent()?.body).toMatchObject({ silent: true, afterCheckIn: true, silenceSeconds: 10, callSeconds: 37 });
    expect(vi.mocked(console.info).mock.calls.map((args) => args.join(" "))).toEqual(
      expect.arrayContaining(["[call] silence turn due: checkIn", "[call] silence turn due: afterCheckIn"])
    );
  });

  it("the persona's end of speech with the student's words still last (Anam updates its message in place) counts: the closing line ends the call at once", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    // A growing history, as the SDK keeps it: a message is added at the end only when it starts.
    const opening = { id: "persona::1", role: "persona", content: "Hi, this is Dana." } as unknown as Message;
    const bye = { id: "user::2", role: "user", content: "That's all from me, bye." } as unknown as Message;
    const closingStarted = { id: "persona::3", role: "persona", content: "Thanks," } as unknown as Message;
    const closingSaid = { id: "persona::3", role: "persona", content: "Thanks, bye now." } as unknown as Message;
    const late = { id: "user::4", role: "user", content: "Oh, and one more thing." } as unknown as Message;
    const update = async (history: Message[]): Promise<void> => {
      avatarModule.callbacks.onMessageHistoryUpdated?.(history);
      await flush();
    };

    await update([opening]);
    await vi.advanceTimersByTimeAsync(300);
    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await update([opening, bye]);
    expect(avatar.talk).toHaveBeenLastCalledWith("Thanks, bye now.");

    // The student's late words, heard while the closing line plays: added after it, not sent.
    await update([opening, bye, closingStarted, late]);
    expect(onCallEnd).not.toHaveBeenCalled();
    // The closing line's end of speech: updated in place, so the student's message is still last.
    await update([opening, bye, closingSaid, late]);
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(2);
    expect(vi.mocked(console.info).mock.calls.map((args) => args.join(" "))).toContain("[call] ending finished: by event (goodbye)");
  });

  it("the end-call button during the closing reply stops at once; onCallEnd is not called", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "Take care.", endCall: true, endReason: "crisis", label: "crisis" });
    await studentSaid("I don't want to be here anymore.");
    render().endCall();
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    await personaFinished("Take care.");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onCallEnd).not.toHaveBeenCalled();
  });

  it("mute and unmute are Anam's own input mute on the same stream: no new stream, no restart", async () => {
    const { avatar } = await startDanaCall();
    await openingSpoken();
    avatar.setInputMuted.mockClear();
    const voice = render();

    voice.pauseMic();
    expect(config.isMutedRef?.current).toBe(true);
    expect(avatar.setInputMuted.mock.calls).toEqual([[true]]);

    voice.resumeMic();
    expect(config.isMutedRef?.current).toBe(false);
    expect(avatar.setInputMuted.mock.calls).toEqual([[true], [false]]);
    // The stream startCall was given stays the input.
    expect(avatar.updateInputStream).not.toHaveBeenCalled();
    expect(avatar.beginStreaming.mock.calls).toEqual([[STREAM]]);
  });

  it("the Anam session config is set at render (trimmed attempt id, the stage), and nowhere else", async () => {
    config = { persona: "tempo_objections", attemptId: " attempt-7 ", anamStage: "objections", isMutedRef: { current: false } };
    const voice = render();
    expect(avatarModule.sessionConfigs).toEqual([{ attemptId: "attempt-7", stage: "objections" }]);
    (voice.avatarRef as { current: unknown }).current = fakeAvatar();
    replies.push({ reply: "Dr. Kim here." });
    await voice.startCall(STREAM);
    // startCall sets nothing itself; the next render sets the same config again.
    expect(avatarModule.sessionConfigs).toHaveLength(1);
    expect(lastSent()?.body).toMatchObject({ attemptId: "attempt-7", start: true });
    render();
    expect(avatarModule.sessionConfigs).toEqual([
      { attemptId: "attempt-7", stage: "objections" },
      { attemptId: "attempt-7", stage: "objections" },
    ]);
  });

  // ── The review fixes ───
  // No render() while an ending is under way: this stand-in re-runs every effect on every
  // render, so the effect that clears the ending's fallback timer on unmount would clear it.

  it("getPendingEndReason: none before the ending, the brain's reason while the closing line plays, none after", async () => {
    await startDanaCall();
    await openingSpoken();
    const voice = render();
    expect(voice.getPendingEndReason()).toBeNull();
    replies.push({ reply: "Take care.", endCall: true, endReason: "crisis", label: "crisis" });
    await studentSaid("I don't want to be here anymore.");
    // End pressed now saves this reason (useTempoCallSession), not "student".
    expect(voice.getPendingEndReason()).toBe("crisis");
    await personaFinished("Take care.");
    expect(voice.getPendingEndReason()).toBeNull();
  });

  it("an interruption only stops playback: the turn in flight is kept, its reply spoken, and the student's next words wait for it", async () => {
    const { avatar } = await startDanaCall();
    await openingSpoken();
    let release: (reply: Record<string, unknown>) => void = () => undefined;
    replies.push(new Promise((resolve) => (release = resolve)));
    await studentSaid("How many offices do you have?");
    expect(sent()).toHaveLength(2);

    avatarModule.callbacks.onTalkStreamInterrupted?.("talk-1");
    expect(avatar.stopSpeaking).toHaveBeenCalledTimes(1);
    // Still in flight: the student's next words are queued, not sent as a second turn.
    await studentSaid("And how many people?");
    expect(sent()).toHaveLength(2);

    release({ reply: "We have eight offices.", label: "normal" });
    await flush();
    expect(avatar.talk).toHaveBeenLastCalledWith("We have eight offices.");
    await personaFinished("We have eight offices.");
    await vi.advanceTimersByTimeAsync(700);
    expect(sent()).toHaveLength(3);
    expect(lastSent()?.body).toMatchObject({ newMessage: "And how many people?" });
    expect(lastSent()?.body.messages).toEqual([
      { role: "assistant", content: "Hi, this is Dana." },
      { role: "user", content: "How many offices do you have?" },
      { role: "assistant", content: "We have eight offices." },
    ]);
  });

  it("an interruption during the ending: the call ends at once when the closing line is the only talk in flight", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await studentSaid("That's all from me, bye.");
    avatarModule.callbacks.onTalkStreamInterrupted?.("talk-2");
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls.map((args) => args.join(" "))).toContain("[call] ending finished: by interrupted (goodbye)");
  });

  it("an interruption during the ending with an earlier talk still in flight: the closing line's fallback stands", async () => {
    const { onCallEnd } = await startDanaCall();
    // No end of speech for the opening: its fallback finishes it at 3.75 s, but its talk is still counted.
    await vi.advanceTimersByTimeAsync(4_000);
    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await studentSaid("That's all from me, bye.");
    // Two talks in flight: this interruption may be the opening's, so the call doesn't end yet.
    avatarModule.callbacks.onTalkStreamInterrupted?.("talk-1");
    expect(onCallEnd).not.toHaveBeenCalled();
    // The closing line's estimate (3 words: 3.2 s from its talk()).
    await vi.advanceTimersByTimeAsync(3_100);
    expect(onCallEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
  });

  it("mute pauses Silence: no check-in while muted; unmuted, Silence starts again from zero", async () => {
    const { avatar } = await startDanaCall();
    await personaFinished();
    const voice = render();
    await vi.advanceTimersByTimeAsync(10_000);
    voice.pauseMic();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sent()).toHaveLength(1);

    // Unmuted at 60 s: the check-in comes 20 s later, at 80 s.
    voice.resumeMic();
    expect(avatar.setInputMuted).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(19_900);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 80 });
    expect(lastSent()?.body).not.toHaveProperty("afterCheckIn");

    // The check-in has been spoken; muted again: no afterCheckIn (and so no silence ending) while muted.
    await personaFinished();
    voice.pauseMic();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent()).toHaveLength(2);
    // Unmuted at 200.1 s: afterCheckIn is due 10 s later, seen at the 210.25 s tick.
    voice.resumeMic();
    await vi.advanceTimersByTimeAsync(9_800);
    expect(sent()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(lastSent()?.body).toMatchObject({ silent: true, afterCheckIn: true, silenceSeconds: 10 });
  });

  it("words queued while muted go as soon as the mic is unmuted", async () => {
    await startDanaCall();
    await openingSpoken();
    const voice = render();
    voice.pauseMic();
    // A transcript Anam delivers while muted is queued, not sent.
    await studentSaid("Sorry, I was on mute.");
    expect(sent()).toHaveLength(1);
    voice.resumeMic();
    await flush();
    expect(sent()).toHaveLength(2);
    expect(lastSent()?.body).toMatchObject({ newMessage: "Sorry, I was on mute." });
  });

  it("the clock tick sends queued words (no waiting for the next flush timer)", async () => {
    await startDanaCall();
    await personaFinished();
    // Heard during the 200 ms cooldown after the reply: queued.
    await vi.advanceTimersByTimeAsync(100);
    await studentSaid("Yes, go ahead.");
    expect(sent()).toHaveLength(1);
    // The 250 ms tick sends it, before the 600 ms flush timer.
    await vi.advanceTimersByTimeAsync(300);
    expect(sent()).toHaveLength(2);
    expect(lastSent()?.body).toMatchObject({ newMessage: "Yes, go ahead." });
  });

  it("a silent turn whose request fails doesn't count: the check-in comes due again, not afterCheckIn", async () => {
    await startDanaCall();
    await personaFinished();
    replies.push(500);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(sent()).toHaveLength(2);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20 });
    // Silence counts again from the failure (20 s): no afterCheckIn at 30 s.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toHaveLength(2);
    // The check-in again at 40 s.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent()).toHaveLength(3);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 40 });
    expect(lastSent()?.body).not.toHaveProperty("afterCheckIn");
  });

  it("an earlier reply's end of speech doesn't finish the current reply; the current one's does", async () => {
    await startDanaCall();
    // No end of speech for the opening: its fallback finishes it at 3.75 s (its talk still counted).
    await vi.advanceTimersByTimeAsync(4_000);
    await studentSaid("Thanks for having me.");
    expect(sent()).toHaveLength(2);
    // At 4.1 s the opening's end of speech arrives: "Mm-hm." is still playing.
    await vi.advanceTimersByTimeAsync(100);
    await personaFinished("Hi, this is Dana.");
    // At 5 s "Mm-hm." ends: Silence counts from 5 s, so the check-in is due at 25 s.
    await vi.advanceTimersByTimeAsync(900);
    await personaFinished("Mm-hm.");
    await vi.advanceTimersByTimeAsync(19_900);
    expect(sent()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent()).toHaveLength(3);
    expect(lastSent()?.body).toMatchObject({ silent: true, silenceSeconds: 20, callSeconds: 25 });
  });

  it("a closing talk() that never settles still ends the call at its estimate (the fallback is armed first)", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await openingSpoken();
    avatar.talk.mockImplementationOnce(() => new Promise(() => undefined));
    replies.push({ reply: "Thanks, bye now.", endCall: true, endReason: "goodbye", label: "goodbye" });
    await studentSaid("That's all from me, bye.");
    expect(avatar.talk).toHaveBeenLastCalledWith("Thanks, bye now.");
    await vi.advanceTimersByTimeAsync(3_100);
    expect(onCallEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onCallEnd).toHaveBeenCalledWith("goodbye");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
  });

  it("past the backstop (18:00 of call time) the call ends locally with \"backstop\", once", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await personaFinished();
    // The stand-in brain never ends the call, so only the local stop can.
    await vi.advanceTimersByTimeAsync(1_079_900);
    expect(onCallEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledWith("backstop");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    const lines = vi.mocked(console.info).mock.calls.map((args) => args.join(" "));
    expect(lines).toEqual(expect.arrayContaining(["[call] safety stop: clock", "[call] ending finished: by safety stop (backstop)"]));
    const sentAtEnd = sent().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(sentAtEnd);
  });

  it("Anam's connection closing mid-call ends the call with \"backstop\", once", async () => {
    const { avatar, onCallEnd } = await startDanaCall();
    await openingSpoken();
    avatarModule.callbacks.onConnectionClosed?.("connection lost");
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledWith("backstop");
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    // Our own endSession closing it again: nothing more.
    avatarModule.callbacks.onConnectionClosed?.("closed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(1);
  });

  it("the connection closing during the persona's ending ends it with the ending's own reason", async () => {
    const { onCallEnd } = await startDanaCall();
    await openingSpoken();
    replies.push({ reply: "We're out of time, thanks.", endCall: true, endReason: "time_up" });
    await studentSaid("One more thing.");
    avatarModule.callbacks.onConnectionClosed?.("connection lost");
    expect(onCallEnd).toHaveBeenCalledTimes(1);
    expect(onCallEnd).toHaveBeenCalledWith("time_up");
  });

  it("a start turn that fails: the call doesn't start and the avatar session is closed", async () => {
    config = { persona: "tempo_objections", attemptId: "attempt-1", anamStage: "objections", isMutedRef: { current: false } };
    const voice = render();
    const avatar = fakeAvatar();
    (voice.avatarRef as { current: unknown }).current = avatar;
    replies.push(500);
    await expect(voice.startCall(STREAM)).rejects.toThrow("Could not start the call. Reload and try again.");
    expect(avatar.talk).not.toHaveBeenCalled();
    expect(avatar.endSession).toHaveBeenCalledTimes(1);
    expect(lastSent()?.body).toMatchObject({ persona: "tempo_objections", start: true });
  });
});

// ── The legacy path ───

describe("a legacy simulation: unchanged", () => {
  it("the fixed opening line, then /api/chat with the persona key and stage; no clock and no call-turn", async () => {
    config = {
      persona: "simulation",
      chatStage: "discovery",
      openingGreeting: "Yeah? I'm Pat — what do you want to know?",
      attemptId: "attempt-1",
      anamStage: "discovery",
      isMutedRef: { current: false },
    };
    const voice = render();
    const avatar = fakeAvatar();
    (voice.avatarRef as { current: unknown }).current = avatar;
    await voice.startCall(STREAM);
    expect(sent()).toEqual([]);
    expect(avatar.talk).toHaveBeenCalledWith("Yeah? I'm Pat — what do you want to know?");
    expect(avatar.setInputMuted.mock.calls).toEqual([[true], [false]]);

    render();
    await vi.advanceTimersByTimeAsync(300);
    replies.push({ reply: "Ovens, mostly." });
    await studentSaid("What do you sell?");
    expect(sent()).toEqual([
      {
        url: "/api/chat",
        body: {
          attemptId: "attempt-1",
          persona: "simulation",
          stage: "discovery",
          messages: [{ role: "assistant", content: "Yeah? I'm Pat — what do you want to know?" }],
          newMessage: "What do you sell?",
        },
      },
    ]);
    expect(avatar.talk).toHaveBeenLastCalledWith("Ovens, mostly.");

    // Anam's end of speech and the passing time change nothing on this path.
    await personaFinished("Ovens, mostly.");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent()).toHaveLength(1);
    expect(render().callSeconds).toBe(0);
  });
});
