/**
 * AiCallTester.tsx
 * The client half of the throwaway /tester/ai-call page (see page.tsx for how to remove
 * it). A text chat with the tester's own call brain, POST /tester/ai-call/api/chat
 * (api/chat/route.ts: a copy of how /api/chat builds Dana's and Dr. Kim's calls, plus the
 * new call behaviour), an optional Anam avatar, and a call timer with test controls. The
 * real /api/chat is not used here. Never import anything from api/ into this file: the
 * persona prompts there are server only.
 *
 * ── Fields sent to the tester brain (the real call will use the same names later) ───
 * Every POST /tester/ai-call/api/chat sends { persona, model, messages, callSeconds,
 * silenceSeconds } plus one of:
 * - newMessage: the student's typed or spoken turn;
 * - start: true (no newMessage): "Start call" asks for the persona's opening;
 * - silent: true (no newMessage): the auto silence turn; no student text joins the history.
 * callSeconds: the call time shown on the page at send time, in whole seconds, every
 * "+30 sec" offset included (Start call or the first turn starts the call, so it sends 0
 * plus offsets). silenceSeconds: the Silence readout at send time: whole seconds since the
 * persona's last reply finished (or since the call started, before any reply).
 * The response is { reply, endCall?, ms }. endCall: true → the persona ended the call:
 * the timer stops, sending is disabled and "Call ended by the persona" shows; the avatar
 * says the goodbye, then stops. "Reset chat" re-enables it all.
 * A reply "finishes" when it arrives, or, when the avatar speaks it, when Anam reports the
 * persona's message done (MESSAGE_HISTORY_UPDATED ending on the persona). From a turn
 * until then, Silence stays at 00:00: it's the persona's turn.
 *
 * Self-contained on purpose: only React, Next.js and @anam-ai/js-sdk are imported. The
 * avatar part is a small copy of what the real call does (hooks/useSimulationVoiceSession.ts
 * and components/Avatar.tsx), not an import of it:
 * - POST /api/student/anam-session { attemptId, stage } for a session token (the only
 *   use of the attempt id; text mode works without it);
 * - createClient(token), then streamToVideoElement(videoId, micStream) to start;
 * - MESSAGE_HISTORY_UPDATED whose last message is the user's = the spoken turn is final
 *   (each Anam message id is handled once);
 * - talk(reply) makes the avatar speak, once SESSION_READY has fired;
 * - stopStreaming() plus stopping the mic tracks to stop.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnamEvent, MessageRole, createClient, type AnamClient, type Message } from "@anam-ai/js-sdk";

// ── Config ───

/** The tester brain (api/chat/route.ts in this folder). */
const CHAT_ENDPOINT = "/tester/ai-call/api/chat";

/** The two personas the tester brain has, and each one's Anam stage. */
const PERSONAS = [
  { key: "tempo_discovery", label: "tempo_discovery (Dana)", anamStage: "discovery" },
  { key: "tempo_objections", label: "tempo_objections (Dr. Kim)", anamStage: "objections" },
] as const;

type PersonaKey = (typeof PERSONAS)[number]["key"];

/** The models the tester brain accepts (the first is its default). */
const MODELS = ["gpt-6-luna", "gpt-4o"] as const;

type ModelKey = (typeof MODELS)[number];

/** The <video> the Anam SDK streams into (it looks the element up by id). */
const VIDEO_ELEMENT_ID = "tester-ai-call-video";

/** Call time colours (display only; nothing is enforced here): amber from 12:00, red from 15:00. */
const CALL_AMBER_SECONDS = 12 * 60;
const CALL_RED_SECONDS = 15 * 60;
/** "+30 sec" moves the call time forward by this much. */
const CALL_OFFSET_STEP_SECONDS = 30;
/** The auto silence turn fires when the Silence readout reaches this (the brain's settings say the same). */
const SILENCE_TURN_SECONDS = 20;
/** How often the readouts refresh. */
const CLOCK_TICK_MS = 250;
/** No end of speech from Anam this long after talk(): count the reply as finished (or stop after the goodbye) anyway. */
const SPEECH_END_FALLBACK_MS = 30_000;

// ── Types ───

/** One history turn, as the brain reads it (user and assistant turns only). */
type ChatTurn = { role: "user" | "assistant"; content: string };

/** The turns that carry the student's text. */
type StudentTurnSource = "typed" | "spoken";

type TurnSource = StudentTurnSource | "silence" | "start";

type TranscriptLine =
  | { id: number; kind: "user"; text: string; via: StudentTurnSource }
  | { id: number; kind: "reply"; text: string; ms: number; brainMs: number | null }
  | { id: number; kind: "error"; text: string; ms: number | null }
  | { id: number; kind: "note"; text: string };

/** Lines are added without an id; the component numbers them. */
type NewTranscriptLine =
  | { kind: "user"; text: string; via: StudentTurnSource }
  | { kind: "reply"; text: string; ms: number; brainMs: number | null }
  | { kind: "error"; text: string; ms: number | null }
  | { kind: "note"; text: string };

type AvatarPhase = "off" | "token" | "mic" | "connecting" | "live";

type AiCallTesterProps = {
  /** From ?attempt= (may be ""). */
  initialAttemptId: string;
  /** From ?simulationId= and ?classId= (may be ""): used only for the "open the simulation" link. */
  simulationId: string;
  classId: string;
};

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
  /** The auto silence turn may fire; firing disarms it until the next real student turn. */
  isSilenceTurnArmed: boolean;
};

/** A stopped clock at 00:00 (the page's start, and "Reset chat"). */
export function emptyCallClock(): CallClock {
  return { startedAt: null, endedAt: null, offsetSeconds: 0, silenceSince: null, isSilenceTurnArmed: true };
}

/** Starts the call at `now` (Silence counts from the start); no change once started. */
export function startCallClock(clock: CallClock, now: number): CallClock {
  return clock.startedAt === null ? { ...clock, startedAt: now, silenceSince: now } : clock;
}

/** "+30 sec": moves the call time forward; the Silence readout is untouched. */
export function addCallOffset(clock: CallClock): CallClock {
  return { ...clock, offsetSeconds: clock.offsetSeconds + CALL_OFFSET_STEP_SECONDS };
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

/**
 * A turn was sent at `now`: starts the call if needed, and holds Silence at 00:00 until the
 * reply finishes. A real turn (or Start call) re-arms the auto silence turn; the silence
 * turn disarms it.
 */
export function clockAfterTurnSent(clock: CallClock, now: number, isSilenceTurn: boolean): CallClock {
  return { ...startCallClock(clock, now), silenceSince: null, isSilenceTurnArmed: !isSilenceTurn };
}

/** The persona's reply finished at `now` (or the turn failed): Silence counts from here. No change once ended. */
export function clockAfterReplyFinished(clock: CallClock, now: number): CallClock {
  return clock.startedAt === null || clock.endedAt !== null ? clock : { ...clock, silenceSince: now };
}

/** endCall: freezes both readouts at `now`. */
export function endCallClock(clock: CallClock, now: number): CallClock {
  return clock.endedAt === null ? { ...clock, endedAt: now } : clock;
}

/** True when the auto silence turn should be sent now: on, armed, call running, nothing in flight, 20 s of silence. */
export function shouldSendSilenceTurn(clock: CallClock, now: number, isAutoSilenceOn: boolean, isBusy: boolean): boolean {
  return (
    isAutoSilenceOn &&
    clock.isSilenceTurnArmed &&
    clock.startedAt !== null &&
    clock.endedAt === null &&
    !isBusy &&
    clock.silenceSince !== null &&
    silenceSecondsAt(clock, now) >= SILENCE_TURN_SECONDS
  );
}

/** Whole seconds as mm:ss (minutes keep counting past 59). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

// ── Helpers ───

function anamStageFor(persona: PersonaKey): "discovery" | "objections" {
  return PERSONAS.find((entry) => entry.key === persona)?.anamStage ?? "discovery";
}

/** A JSON object body, or null when the body isn't one (the caller shows the body as-is). */
function parseJsonObject(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

const TURN_LABELS: Record<StudentTurnSource, string> = {
  typed: "You (typed)",
  spoken: "You (spoken)",
};

// ── Component ───

/**
 * The tester page body: inputs, call timer and test controls, transcript, text box and
 * the avatar switch.
 */
export function AiCallTester({ initialAttemptId, simulationId, classId }: AiCallTesterProps): React.ReactElement {
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [persona, setPersona] = useState<PersonaKey>("tempo_discovery");
  const [model, setModel] = useState<ModelKey>("gpt-6-luna");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [avatarPhase, setAvatarPhase] = useState<AvatarPhase>("off");
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [clock, setClock] = useState<CallClock>(emptyCallClock);
  const [now, setNow] = useState<number>(() => Date.now());
  const [isAutoSilenceOn, setIsAutoSilenceOn] = useState(false);
  const [isStartPending, setIsStartPending] = useState(false);

  // Refs: the Anam callbacks, the timer tick and async turns read the latest values without re-subscribing.
  const attemptIdRef = useRef(attemptId);
  const personaRef = useRef<PersonaKey>(persona);
  const modelRef = useRef<ModelKey>(model);
  const historyRef = useRef<ChatTurn[]>([]);
  const isBusyRef = useRef(false);
  /** Spoken turns that arrived while a reply was in flight; sent together next (as the real call does). */
  const pendingSpokenRef = useRef<string[]>([]);
  /** Bumped by Reset chat: replies to an older conversation are dropped. */
  const conversationEpochRef = useRef(0);
  const lineIdRef = useRef(0);
  const clientRef = useRef<AnamClient | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  /** Bumped on every avatar start and stop: a start that was overtaken stops itself. */
  const avatarRunRef = useRef(0);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  /** SESSION_READY has fired: the real call speaks only after it, so this page does too. */
  const isSessionReadyRef = useRef(false);
  const clockRef = useRef<CallClock>(clock);
  const isAutoSilenceOnRef = useRef(isAutoSilenceOn);
  /** The avatar is speaking a reply: Silence waits for Anam's end of speech (or the fallback). */
  const isAwaitingSpeechEndRef = useRef(false);
  const speechSentAtRef = useRef(0);
  /** Start call was clicked while the avatar was still connecting: the opening is asked for on SESSION_READY. */
  const pendingStartRef = useRef(false);
  /** The persona ended the call and the avatar is saying the goodbye: stop it at the end of speech. */
  const stopAvatarAfterSpeechRef = useRef(false);
  const goodbyeTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const sendTurnRef = useRef<(text: string, via: TurnSource) => Promise<void>>(async () => undefined);

  attemptIdRef.current = attemptId;
  personaRef.current = persona;
  modelRef.current = model;
  isAutoSilenceOnRef.current = isAutoSilenceOn;

  const addLine = useCallback((line: NewTranscriptLine): void => {
    lineIdRef.current += 1;
    const id = lineIdRef.current;
    setLines((current) => [...current, { ...line, id }]);
  }, []);

  /** Applies a clock rule to the latest clock (the ref is the source of truth; state re-renders). */
  const updateClock = useCallback((rule: (current: CallClock) => CallClock): void => {
    clockRef.current = rule(clockRef.current);
    setClock(clockRef.current);
  }, []);

  const markReplyFinished = useCallback((): void => {
    updateClock((current) => clockAfterReplyFinished(current, Date.now()));
  }, [updateClock]);

  const setStartPending = useCallback((isPending: boolean): void => {
    pendingStartRef.current = isPending;
    setIsStartPending(isPending);
  }, []);

  const clearGoodbyeStop = useCallback((): void => {
    stopAvatarAfterSpeechRef.current = false;
    if (goodbyeTimerRef.current !== null) {
      window.clearTimeout(goodbyeTimerRef.current);
      goodbyeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const box = transcriptRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [lines]);

  // ── Avatar: speak / stop ───

  /**
   * Makes the avatar say the reply when its session is ready. True when the talk command
   * went out (Silence then waits for the end of speech); a failure is shown as a note.
   */
  const speakReply = useCallback(
    async (reply: string): Promise<boolean> => {
      const client = clientRef.current;
      if (!client) {
        return false;
      }
      if (!client.isStreaming() || !isSessionReadyRef.current) {
        addLine({ kind: "note", text: "Avatar session isn't ready yet: this reply wasn't spoken." });
        return false;
      }
      // Set before talk(): the end of speech may arrive before talk() resolves.
      isAwaitingSpeechEndRef.current = true;
      speechSentAtRef.current = Date.now();
      try {
        await client.talk(reply);
        return true;
      } catch (error) {
        isAwaitingSpeechEndRef.current = false;
        addLine({ kind: "note", text: `Avatar couldn't speak this reply: ${errorText(error)}` });
        return false;
      }
    },
    [addLine]
  );

  /** Stops the Anam stream and the mic; safe to call at any time, any number of times. */
  const stopAvatar = useCallback((): void => {
    avatarRunRef.current += 1;
    const client = clientRef.current;
    // Cleared first, so the CONNECTION_CLOSED that stopStreaming() emits is ignored below.
    clientRef.current = null;
    if (client) {
      void client.stopStreaming().catch(() => undefined);
    }
    stopTracks(micRef.current);
    micRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    processedMessageIdsRef.current.clear();
    pendingSpokenRef.current = [];
    isSessionReadyRef.current = false;
    clearGoodbyeStop();
    setStartPending(false);
    // A reply cut off by the stop counts as finished now.
    if (isAwaitingSpeechEndRef.current) {
      isAwaitingSpeechEndRef.current = false;
      markReplyFinished();
    }
    setAvatarPhase("off");
    setIsSessionReady(false);
  }, [clearGoodbyeStop, markReplyFinished, setStartPending]);

  /**
   * endCall: true from the brain: freeze the timer and stop sending now. With the avatar
   * on, it says the goodbye first and stops at the end of speech (or after the fallback);
   * otherwise it stops straight away.
   */
  const endCall = useCallback(
    async (goodbye: string | null): Promise<void> => {
      updateClock((current) => endCallClock(current, Date.now()));
      setNow(Date.now());
      pendingSpokenRef.current = [];
      if (!goodbye || !clientRef.current) {
        stopAvatar();
        return;
      }
      stopAvatarAfterSpeechRef.current = true;
      const isSpeaking = await speakReply(goodbye);
      // Reset chat during the goodbye cancels the stop (the avatar stays on).
      if (!stopAvatarAfterSpeechRef.current) {
        return;
      }
      if (!isSpeaking) {
        stopAvatar();
        return;
      }
      goodbyeTimerRef.current = window.setTimeout(() => stopAvatar(), SPEECH_END_FALLBACK_MS);
    },
    [updateClock, stopAvatar, speakReply]
  );

  // ── Turns ───

  /** Sends the queued spoken turns as one, once nothing is in flight. */
  const flushPendingSpoken = useCallback((): void => {
    if (isBusyRef.current || pendingSpokenRef.current.length === 0) {
      return;
    }
    const joined = pendingSpokenRef.current.join(" ");
    pendingSpokenRef.current = [];
    void sendTurnRef.current(joined, "spoken");
  }, []);

  /**
   * One turn to the tester brain: the history so far, the student's text (typed or
   * spoken) or start: true / silent: true, and the call time fields. Shows the reply with
   * its round-trip and brain times (and speaks it when the avatar is on). An error shows
   * the HTTP status and the body as-is; a failed turn adds nothing to the history.
   * Nothing is sent once the call has ended; Start call only opens a call not yet started.
   */
  const sendTurn = useCallback(
    async (text: string, via: TurnSource): Promise<void> => {
      const isStudentText = via === "typed" || via === "spoken";
      const trimmed = text.trim();
      if ((isStudentText && !trimmed) || clockRef.current.endedAt !== null) {
        return;
      }
      if (isBusyRef.current) {
        if (via === "spoken") {
          pendingSpokenRef.current.push(trimmed);
        }
        return;
      }
      if (via === "start" && clockRef.current.startedAt !== null) {
        return;
      }

      isBusyRef.current = true;
      setIsBusy(true);
      // Any turn settles a waiting Start call (the call has started now).
      setStartPending(false);
      const epoch = conversationEpochRef.current;
      const prior = historyRef.current;
      // The readouts at send time: Silence before this turn resets it; the call time after
      // this turn starts the call (so the first turn sends 0 plus any +30 sec).
      const sentAt = Date.now();
      const silenceSeconds = silenceSecondsAt(clockRef.current, sentAt);
      updateClock((current) => clockAfterTurnSent(current, sentAt, via === "silence"));
      const callSeconds = callSecondsAt(clockRef.current, sentAt);
      setNow(sentAt);
      // A new turn: an older reply's end of speech no longer moves the Silence readout.
      isAwaitingSpeechEndRef.current = false;
      if (isStudentText) {
        addLine({ kind: "user", text: trimmed, via });
      } else {
        addLine({
          kind: "note",
          text: via === "start" ? "Start call: asking for the opening (start: true)." : "Auto silence turn (silent: true).",
        });
      }
      const startedAt = performance.now();

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: personaRef.current,
            model: modelRef.current,
            messages: prior,
            ...(isStudentText ? { newMessage: trimmed } : {}),
            callSeconds,
            silenceSeconds,
            ...(via === "silence" ? { silent: true } : {}),
            ...(via === "start" ? { start: true } : {}),
          }),
        });
        const bodyText = await response.text();
        const ms = Math.round(performance.now() - startedAt);
        if (epoch !== conversationEpochRef.current) {
          return;
        }
        const body = parseJsonObject(bodyText);
        const reply = typeof body?.reply === "string" && body.reply.trim() ? body.reply : null;
        const isEndCall = body?.endCall === true;
        const brainMs = typeof body?.ms === "number" ? body.ms : null;

        if (!response.ok) {
          addLine({ kind: "error", text: `HTTP ${response.status}\n${bodyText}`, ms });
        } else if (reply !== null) {
          // A start or silent turn adds only the persona's reply: no student text.
          const studentTurn: ChatTurn[] = isStudentText ? [{ role: "user", content: trimmed }] : [];
          historyRef.current = [...prior, ...studentTurn, { role: "assistant", content: reply }];
          addLine({ kind: "reply", text: reply, ms, brainMs });
        } else if (!isEndCall) {
          addLine({ kind: "error", text: `HTTP ${response.status}, but no reply in the body:\n${bodyText}`, ms });
        }

        if (isEndCall) {
          void endCall(response.ok ? reply : null);
          return;
        }
        if (!response.ok || reply === null) {
          markReplyFinished();
          return;
        }
        const isSpeaking = await speakReply(reply);
        if (epoch === conversationEpochRef.current && !isSpeaking) {
          markReplyFinished();
        }
      } catch (error) {
        if (epoch === conversationEpochRef.current) {
          addLine({ kind: "error", text: `Request failed: ${errorText(error)}`, ms: Math.round(performance.now() - startedAt) });
          markReplyFinished();
        }
      } finally {
        // Reset chat already cleared the busy flag for an older conversation.
        if (epoch === conversationEpochRef.current) {
          isBusyRef.current = false;
          setIsBusy(false);
          flushPendingSpoken();
        }
      }
    },
    [addLine, updateClock, markReplyFinished, setStartPending, speakReply, endCall, flushPendingSpoken]
  );

  sendTurnRef.current = sendTurn;

  // ── Timer tick ───

  const isCallEnded = clock.endedAt !== null;
  const isClockRunning = clock.startedAt !== null && !isCallEnded;

  // While the call runs: refresh the readouts, apply the end-of-speech fallback, and fire
  // the auto silence turn (once; a real turn re-arms it).
  useEffect(() => {
    if (!isClockRunning) {
      return undefined;
    }
    const tick = (): void => {
      const at = Date.now();
      setNow(at);
      if (isAwaitingSpeechEndRef.current && at - speechSentAtRef.current >= SPEECH_END_FALLBACK_MS) {
        isAwaitingSpeechEndRef.current = false;
        addLine({
          kind: "note",
          text: `No end of speech from Anam within ${SPEECH_END_FALLBACK_MS / 1000} s: Silence counts from now.`,
        });
        markReplyFinished();
      }
      if (shouldSendSilenceTurn(clockRef.current, at, isAutoSilenceOnRef.current, isBusyRef.current)) {
        void sendTurnRef.current("", "silence");
      }
    };
    tick();
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isClockRunning, addLine, markReplyFinished]);

  // ── Avatar: start ───

  /**
   * Token → mic → Anam client → stream into the video element. Spoken turns arrive as
   * MESSAGE_HISTORY_UPDATED and go through sendTurn like typed ones; the same event
   * ending on the persona marks the spoken reply finished (and, after an endCall, stops
   * the avatar). SESSION_READY sends a waiting Start call's opening request.
   */
  const startAvatar = useCallback(async (): Promise<void> => {
    const stage = anamStageFor(personaRef.current);
    const attempt = attemptIdRef.current.trim();
    if (!attempt) {
      addLine({ kind: "note", text: "Enter an attempt id before turning the avatar on (the Anam session needs it)." });
      return;
    }

    avatarRunRef.current += 1;
    const run = avatarRunRef.current;
    const isCurrentRun = (): boolean => run === avatarRunRef.current;
    isSessionReadyRef.current = false;
    setIsSessionReady(false);
    setAvatarPhase("token");

    try {
      const response = await fetch("/api/student/anam-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt, stage }),
      });
      const bodyText = await response.text();
      if (!isCurrentRun()) {
        return;
      }
      if (!response.ok) {
        addLine({ kind: "error", text: `Avatar session token: HTTP ${response.status}\n${bodyText}`, ms: null });
        stopAvatar();
        return;
      }
      const token = parseJsonObject(bodyText)?.sessionToken;
      const sessionToken = typeof token === "string" ? token.trim() : "";
      if (!sessionToken) {
        addLine({ kind: "error", text: `Avatar session token: HTTP ${response.status}, but no sessionToken in the body:\n${bodyText}`, ms: null });
        stopAvatar();
        return;
      }

      setAvatarPhase("mic");
      // Audio only, as the real call passes Anam an audio-only stream.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrentRun()) {
        stopTracks(mic);
        return;
      }
      micRef.current = mic;

      const client = createClient(sessionToken);
      clientRef.current = client;
      client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (history: Message[]): void => {
        if (clientRef.current !== client) {
          return;
        }
        const last = history[history.length - 1];
        if (!last) {
          return;
        }
        if (last.role === MessageRole.PERSONA) {
          // The avatar finished speaking the reply: Silence counts from here.
          if (isAwaitingSpeechEndRef.current) {
            isAwaitingSpeechEndRef.current = false;
            markReplyFinished();
          }
          // The goodbye is said: now the avatar stops.
          if (stopAvatarAfterSpeechRef.current) {
            stopAvatar();
          }
          return;
        }
        if (last.role !== MessageRole.USER || processedMessageIdsRef.current.has(last.id)) {
          return;
        }
        processedMessageIdsRef.current.add(last.id);
        void sendTurnRef.current(last.content, "spoken");
      });
      client.addListener(AnamEvent.SESSION_READY, (): void => {
        if (clientRef.current !== client) {
          return;
        }
        isSessionReadyRef.current = true;
        setIsSessionReady(true);
        if (pendingStartRef.current) {
          setStartPending(false);
          void sendTurnRef.current("", "start");
        }
      });
      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason: string, details?: string): void => {
        // Our own stopAvatar() clears clientRef first, so this only reports closes we didn't ask for.
        if (clientRef.current !== client) {
          return;
        }
        addLine({ kind: "note", text: `Avatar connection closed: ${reason}${details ? ` (${details})` : ""}` });
        stopAvatar();
      });

      setAvatarPhase("connecting");
      try {
        await client.streamToVideoElement(VIDEO_ELEMENT_ID, mic);
      } finally {
        // Switched off while connecting: stopStreaming() may have run before there was a
        // session to stop, so stop again now that the start has landed (or failed).
        if (!isCurrentRun()) {
          void client.stopStreaming().catch(() => undefined);
        }
      }
      if (!isCurrentRun()) {
        return;
      }
      // As the real call does: unmute and play (the switch click is the user gesture).
      const video = videoRef.current;
      if (video) {
        video.muted = false;
        void video.play().catch(() => undefined);
      }
      setAvatarPhase("live");
    } catch (error) {
      if (!isCurrentRun()) {
        return;
      }
      addLine({ kind: "error", text: `Avatar failed to start: ${errorText(error)}`, ms: null });
      stopAvatar();
    }
  }, [addLine, markReplyFinished, setStartPending, stopAvatar]);

  // Stop cleanly when the page closes or the component unmounts.
  useEffect(() => {
    const handlePageHide = (): void => stopAvatar();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      stopAvatar();
    };
  }, [stopAvatar]);

  // ── Controls ───

  /**
   * Reset chat: clears the transcript and history, sets the call time and Silence to
   * 00:00 and stops the timer until the next call start, and re-enables sending after an
   * endCall. The avatar stays connected (only what it is saying stops).
   */
  const resetChat = useCallback((): void => {
    conversationEpochRef.current += 1;
    historyRef.current = [];
    pendingSpokenRef.current = [];
    isBusyRef.current = false;
    setIsBusy(false);
    isAwaitingSpeechEndRef.current = false;
    clearGoodbyeStop();
    setStartPending(false);
    updateClock(() => emptyCallClock());
    setNow(Date.now());
    setLines([]);
    const client = clientRef.current;
    if (client?.isStreaming()) {
      try {
        client.interruptPersona();
      } catch {
        // Nothing was playing.
      }
    }
  }, [clearGoodbyeStop, setStartPending, updateClock]);

  const handlePersonaChange = (next: PersonaKey): void => {
    setPersona(next);
    personaRef.current = next;
    // Another persona is another conversation: don't send it this one's history.
    resetChat();
  };

  const handleAvatarSwitch = (isOn: boolean): void => {
    if (isOn) {
      void startAvatar();
    } else {
      stopAvatar();
    }
  };

  /** Start call: the opening now, or, with the avatar still connecting, once it's ready. */
  const handleStartCall = (): void => {
    if (clockRef.current.startedAt !== null || clockRef.current.endedAt !== null || isBusyRef.current) {
      return;
    }
    if (avatarPhase !== "off" && !isSessionReadyRef.current) {
      setStartPending(true);
      return;
    }
    void sendTurn("", "start");
  };

  const submitDraft = (): void => {
    if (isBusy || isCallEnded || !draft.trim()) {
      return;
    }
    const text = draft;
    setDraft("");
    void sendTurn(text, "typed");
  };

  const isAvatarOn = avatarPhase !== "off";
  const avatarStatus: Record<AvatarPhase, string> = {
    off: "Avatar off.",
    token: "Getting a session token…",
    mic: "Asking for the microphone…",
    connecting: "Connecting the avatar…",
    live: isSessionReady ? "Avatar ready: speak or type." : "Streaming; waiting for the session to be ready…",
  };
  const simulationHref =
    simulationId && classId ? `/student/simulation/${encodeURIComponent(simulationId)}?classId=${encodeURIComponent(classId)}` : "";
  const callSeconds = callSecondsAt(clock, now);
  const silenceSeconds = silenceSecondsAt(clock, now);
  const callTimeTone =
    callSeconds >= CALL_RED_SECONDS ? "text-red-600" : callSeconds >= CALL_AMBER_SECONDS ? "text-amber-600" : "text-gray-900";
  const canStartCall = clock.startedAt === null && !isCallEnded && !isBusy && !isStartPending;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-white p-4 text-sm text-gray-900">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">AI call tester</h1>
        <p className="text-gray-600">
          Tester-only page. Turns go to the tester call brain (POST {CHAT_ENDPOINT}); the avatar switch adds Anam voice
          and video. Nothing here is saved.
        </p>
      </header>

      <section className="grid gap-3 rounded border border-gray-300 p-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Persona</span>
          <select
            className="rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100"
            value={persona}
            onChange={(event) => handlePersonaChange(event.target.value as PersonaKey)}
            disabled={isAvatarOn}
          >
            {PERSONAS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-600">Changing it resets the chat. Turn the avatar off to change it.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Model</span>
          <select
            className="rounded border border-gray-300 px-2 py-1"
            value={model}
            onChange={(event) => setModel(event.target.value as ModelKey)}
          >
            {MODELS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-600">Applies from the next turn.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Attempt id (avatar only)</span>
          <input
            className="rounded border border-gray-300 px-2 py-1 font-mono disabled:bg-gray-100"
            value={attemptId}
            onChange={(event) => setAttemptId(event.target.value)}
            disabled={isAvatarOn}
            spellCheck={false}
            aria-describedby="attempt-hint"
          />
          <span id="attempt-hint" className="text-xs text-gray-600">
            Needed only for the avatar. In the simulation page&apos;s address, the value after attempt= (there once you
            continue an in-progress run from its start screen, or move to the next stage); the signed-in student&apos;s
            attempt.
            {simulationHref ? (
              <>
                {" "}
                <Link className="text-blue-700 underline" href={simulationHref} target="_blank" rel="noreferrer">
                  Open the simulation
                </Link>
              </>
            ) : null}
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isAvatarOn}
              onChange={(event) => handleAvatarSwitch(event.target.checked)}
              disabled={isCallEnded}
            />
            <span className="font-semibold">Avatar and voice</span>
          </label>
          <span className="text-gray-600">{avatarStatus[avatarPhase]}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded border border-gray-300 bg-gray-50 px-3 py-2" aria-label="Call timer">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className={`font-bold ${callTimeTone}`}>
            <span className="text-xs uppercase tracking-wide">Call time </span>
            <span className="font-mono text-3xl tabular-nums">{formatClock(callSeconds)}</span>
          </div>
          <div className="text-gray-700">
            <span className="text-xs uppercase tracking-wide">Silence </span>
            <span className="font-mono text-xl tabular-nums">{formatClock(silenceSeconds)}</span>
          </div>
          <span className="text-xs text-gray-500">
            {isCallEnded
              ? null
              : clock.startedAt === null
                ? "Starts with Start call or the first turn."
                : "Amber from 12:00, red from 15:00 (display only)."}
          </span>
        </div>
        {isCallEnded ? (
          <p className="rounded bg-red-100 px-2 py-1 font-semibold text-red-800" role="status">
            Call ended by the persona
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded bg-green-700 px-3 py-1 font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
            onClick={handleStartCall}
            disabled={!canStartCall}
          >
            {isStartPending ? "Start call (waiting for the avatar…)" : "Start call"}
          </button>
          <button
            type="button"
            className="rounded border border-gray-400 px-3 py-1 font-semibold hover:bg-gray-100"
            onClick={() => updateClock(addCallOffset)}
          >
            +30 sec
          </button>
          <button
            type="button"
            className="rounded border border-gray-400 px-3 py-1 font-semibold hover:bg-gray-100"
            onClick={resetChat}
          >
            Reset chat
          </button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isAutoSilenceOn}
              onChange={(event) => {
                isAutoSilenceOnRef.current = event.target.checked;
                setIsAutoSilenceOn(event.target.checked);
              }}
            />
            <span>Auto silence turn at {SILENCE_TURN_SECONDS} s</span>
          </label>
        </div>
      </section>

      <div className={isAvatarOn ? "overflow-hidden rounded bg-black" : "hidden"}>
        <video ref={videoRef} id={VIDEO_ELEMENT_ID} className="aspect-video w-full" autoPlay playsInline />
      </div>

      <div
        ref={transcriptRef}
        className="flex min-h-[16rem] flex-1 flex-col gap-2 overflow-y-auto rounded border border-gray-300 p-3"
        aria-live="polite"
      >
        {lines.length === 0 ? <p className="text-gray-500">No turns yet. Click Start call, or speak or type first.</p> : null}
        {lines.map((line) => {
          if (line.kind === "user") {
            return (
              <div key={line.id} className="self-end rounded bg-blue-50 px-3 py-2">
                <div className="text-xs font-semibold text-blue-800">{TURN_LABELS[line.via]}</div>
                <div className="whitespace-pre-wrap">{line.text}</div>
              </div>
            );
          }
          if (line.kind === "reply") {
            return (
              <div key={line.id} className="self-start rounded bg-gray-100 px-3 py-2">
                <div className="text-xs font-semibold text-gray-700">{persona}</div>
                <div className="whitespace-pre-wrap">{line.text}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Round trip: {line.ms} ms{line.brainMs !== null ? ` · brain: ${line.brainMs} ms` : ""}
                </div>
              </div>
            );
          }
          if (line.kind === "error") {
            return (
              <div key={line.id} className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">{line.text}</pre>
                {line.ms !== null ? <div className="mt-1 text-xs">Round trip: {line.ms} ms</div> : null}
              </div>
            );
          }
          return (
            <div key={line.id} className="text-xs italic text-gray-600">
              {line.text}
            </div>
          );
        })}
        {isBusy ? <p className="text-xs text-gray-500">Waiting for the reply…</p> : null}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <textarea
          className="min-h-[3rem] flex-1 rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder="Type a message"
          aria-label="Message"
          disabled={isCallEnded}
        />
        <button
          type="submit"
          className="rounded bg-blue-700 px-4 py-1 font-semibold text-white disabled:bg-gray-400"
          disabled={isBusy || isCallEnded || !draft.trim()}
        >
          Send
        </button>
      </form>
    </main>
  );
}
