/**
 * tempo-call-session-hook.test.ts
 * hooks/useTempoCallSession.ts, the logic the live Dana and Dr. Kim calls share: it sets up
 * the voice hook with the persona key, connects on mount with the lobby's microphone
 * stream, mutes and unmutes through Anam's own input mute (pauseMic / resumeMic: no new
 * microphone stream, no track stopped, so the lobby's echo-cancelled mic stays the input)
 * and ends the call once, stopping the lobby's tracks (End pressed during the persona's
 * ending keeps that ending's reason). Unmounted before the call ended, it ends the voice
 * session and stops the tracks (not on strict mode's test unmount and remount). React's
 * hooks are a small synchronous stand-in (effects re-run when their deps change); the
 * voice hook and the audio context are mocked. Nothing leaves the machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationVoiceConfig } from "@/hooks/useSimulationVoiceSession";
import {
  useTempoCallSession,
  type TempoCallSession,
  type TempoCallSessionOptions,
} from "@/hooks/useTempoCallSession";

// ── A one-component stand-in for React's hooks ───

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cleanups: [] as Array<(() => void) | undefined>,
  deps: [] as Array<unknown[] | undefined>,
  index: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  /**
   * An effect runs, after its previous cleanup, on the first render and whenever its deps
   * changed (every render when it has none), as React does. useCallback below returns a new
   * function each render, so an effect that depends on one still re-runs every render.
   */
  const runEffect = (effect: () => unknown, deps?: unknown[]): void => {
    const slot = hooks.index++;
    const previous = hooks.deps[slot];
    if (deps && previous && deps.length === previous.length && deps.every((dep, i) => Object.is(dep, previous[i]))) {
      return;
    }
    hooks.deps[slot] = deps;
    hooks.cleanups[slot]?.();
    const cleanup = effect();
    hooks.cleanups[slot] = typeof cleanup === "function" ? (cleanup as () => void) : undefined;
  };
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
    useEffect: runEffect,
    useLayoutEffect: runEffect,
  };
});

// ── The voice hook and the audio context ───

const voiceHook = vi.hoisted(() => ({
  config: null as SimulationVoiceConfig | null,
  voice: null as Record<string, unknown> | null,
}));

vi.mock("@/hooks/useSimulationVoiceSession", () => ({
  useSimulationVoiceSession: (config: SimulationVoiceConfig): unknown => {
    voiceHook.config = config;
    return voiceHook.voice;
  },
}));

vi.mock("@/lib/audio-playback", () => ({ resumePlaybackContext: async (): Promise<void> => undefined }));

const getUserMedia = vi.fn();
const audioTrack = { stop: vi.fn() };
const AUDIO_STREAM = { getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] } as unknown as MediaStream;

let options: TempoCallSessionOptions<"dana">;

function fakeVoice(): Record<string, unknown> {
  return {
    avatarRef: { current: { waitForMediaElements: vi.fn(async () => true), resumeAudioContext: vi.fn() } },
    statusText: "",
    userTranscripts: "",
    personaTranscripts: "",
    callSeconds: 0,
    getFullTranscript: (): string => "Persona: Hi, this is Dana.\nStudent: Thanks for the time.",
    startCall: vi.fn(async () => undefined),
    endCall: vi.fn(),
    replaceAudioStream: vi.fn(),
    pauseMic: vi.fn(),
    resumeMic: vi.fn(),
    getPendingEndReason: vi.fn(() => null),
  };
}

/** Unmounts: every effect's cleanup runs (then the 0 ms timer the unmount stop waits for). */
async function unmount(): Promise<void> {
  hooks.cleanups.forEach((cleanup) => cleanup?.());
  hooks.cleanups = [];
  hooks.deps = [];
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** One render of the hook (state, refs and effects persist between renders). */
function render(): TempoCallSession {
  hooks.index = 0;
  return useTempoCallSession(options);
}

/** Lets the connect chain finish. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

/** Mounts the hook and lets it connect. */
async function connect(): Promise<TempoCallSession> {
  render();
  await flush();
  return render();
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  getUserMedia.mockReset();
  audioTrack.stop.mockReset();
  hooks.values = [];
  hooks.cleanups = [];
  hooks.deps = [];
  voiceHook.voice = fakeVoice();
  options = {
    persona: "tempo_discovery",
    anamStage: "discovery",
    personaRole: "dana",
    connectErrorMessage: "Could not connect to Dana Reyes. Reload and try again.",
    attemptId: "attempt-1",
    audioStream: AUDIO_STREAM,
    videoStream: null,
    onActive: vi.fn(),
    onError: vi.fn(),
    onSecondsChange: vi.fn(),
    onTranscriptChange: vi.fn(),
    onEnded: vi.fn(),
  };
});

afterEach(async () => {
  // Unmounted, and its 0 ms stop timer run, before the next test starts.
  await unmount();
  vi.unstubAllGlobals();
});

describe("useTempoCallSession", () => {
  it("sets up the voice hook with the persona key and connects on the lobby's stream", async () => {
    const call = await connect();
    expect(voiceHook.config).toMatchObject({ persona: "tempo_discovery", attemptId: "attempt-1", anamStage: "discovery" });
    expect(voiceHook.voice?.startCall).toHaveBeenCalledWith(AUDIO_STREAM);
    expect(options.onActive).toHaveBeenCalledTimes(1);
    expect(call.shell.connected).toBe(true);
    expect(call.shell.formattedTime).toBe("00:00");
  });

  it("mute and unmute: Anam's input mute only; no new microphone stream, no track stopped", async () => {
    const call = await connect();
    call.shell.onToggleMute();
    expect(voiceHook.voice?.pauseMic).toHaveBeenCalledTimes(1);
    expect(render().shell.micMuted).toBe(true);

    render().shell.onToggleMute();
    expect(voiceHook.voice?.resumeMic).toHaveBeenCalledTimes(1);
    expect(voiceHook.voice?.resumeMic).toHaveBeenCalledWith();
    expect(render().shell.micMuted).toBe(false);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(voiceHook.voice?.replaceAudioStream).not.toHaveBeenCalled();
  });

  it("the end-call button ends once: the lobby's tracks stop and onEnded gets the parsed transcript", async () => {
    const call = await connect();
    call.shell.onEndCall();
    expect(voiceHook.voice?.endCall).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(options.onEnded).toHaveBeenCalledWith(
      "Persona: Hi, this is Dana.\nStudent: Thanks for the time.",
      0,
      [
        { role: "dana", content: "Hi, this is Dana.", timestamp: "00:00" },
        { role: "student", content: "Thanks for the time.", timestamp: "00:00" },
      ],
      "student"
    );

    // The brain's endCall after the button: nothing more.
    voiceHook.config?.onCallEnd?.("goodbye");
    expect(options.onEnded).toHaveBeenCalledTimes(1);

    // Unmounted after the end: nothing more either.
    await unmount();
    expect(voiceHook.voice?.endCall).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("End pressed while the persona's ending is under way: the call keeps that ending's reason, not \"student\"", async () => {
    const call = await connect();
    vi.mocked(voiceHook.voice?.getPendingEndReason as () => string | null).mockReturnValue("crisis");
    call.shell.onEndCall();
    expect(voiceHook.voice?.endCall).toHaveBeenCalledTimes(1);
    expect(options.onEnded).toHaveBeenCalledTimes(1);
    expect(vi.mocked(options.onEnded).mock.calls[0]?.[3]).toBe("crisis");
    // The ending's own onCallEnd afterwards: nothing more.
    voiceHook.config?.onCallEnd?.("crisis");
    expect(options.onEnded).toHaveBeenCalledTimes(1);
  });

  it("unmounted before the call ended: the voice session ends and the microphone and camera tracks stop, once", async () => {
    const videoTrack = { stop: vi.fn(), readyState: "live" };
    options.videoStream = { getVideoTracks: () => [videoTrack], getTracks: () => [videoTrack] } as unknown as MediaStream;
    await connect();
    await unmount();
    expect(voiceHook.voice?.endCall).toHaveBeenCalledTimes(1);
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    // Not a call end the student or the persona made: no post-call screen.
    expect(options.onEnded).not.toHaveBeenCalled();
    await unmount();
    expect(voiceHook.voice?.endCall).toHaveBeenCalledTimes(1);
  });

  it("strict mode's test unmount and remount (development) doesn't end the call", async () => {
    await connect();
    // React runs the cleanups, then the effects again, on the same refs.
    hooks.cleanups.forEach((cleanup) => cleanup?.());
    hooks.cleanups = [];
    hooks.deps = [];
    render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voiceHook.voice?.endCall).not.toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(voiceHook.voice?.startCall).toHaveBeenCalledTimes(1);
  });
});
