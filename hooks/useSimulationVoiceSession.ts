/**
 * useSimulationVoiceSession.ts
 * Anam custom-LLM voice stages: Anam STT/TTS/avatar, with the persona's lines from the
 * server (the browser sends a persona key and the attempt id, never a prompt). Does not
 * acquire media — caller supplies the lobby MediaStream on join. Two paths, by persona:
 *
 * ── Dana (tempo_discovery) and Dr. Kim (tempo_objections): CALL_PERSONAS ───
 * Every turn goes to the shared call brain, POST /api/student/call-turn (CallTurnRequest
 * in lib/call-config.ts), as the /tester/ai-call page sends it:
 * - the opening: a start turn (start: true, localTime from the browser's clock), spoken
 *   when it comes back; the student's speech is ignored, and the mic stays muted, until
 *   that opening has been spoken;
 * - the student's spoken turns (newMessage), with the call time, the Silence readout,
 *   the strikes (rude and break_character labels so far, counted from each turn's label)
 *   and the turn type;
 * - the time marks (wrap-up start, final stretch, time up: timeMark: true) and the two
 *   silent turns (the check-in, then afterCheckIn), from CALL_TIMINGS and the clock rules
 *   in lib/call-clock.ts, checked every CLOCK_TICK_MS on the student's turn.
 * A reply is "spoken" at Anam's real end of speech: MESSAGE_HISTORY_UPDATED ending on the
 * persona (talk() calls are counted against those events), or SPEECH_END_FALLBACK_MS after
 * talk() if none comes. Silence counts from there. While the student is speaking (Anam's
 * USER_SPEECH_STARTED until USER_SPEECH_ENDED, or USER_SPEECH_DROPPED_MS with no end, as
 * Anam's events reference advises) Silence holds, so a long answer never gets the check-in.
 * endCall from the route: the mic is muted (the Avatar API), the reply is spoken in full,
 * the avatar stops, and onCallEnd(endReason) ends the call the way the end-call button
 * does. The hook exposes callSeconds from the clock. pauseMic / resumeMic are Anam's own
 * input mute (the Avatar's setInputMuted) on the stream startCall was given.
 *
 * ── Every other persona (legacy "simulation" calls): unchanged ───
 * GPT via POST /api/chat; the opening is openingGreeting (or the default greeting);
 * "speaking" ends when talk() resolves; no clock (callSeconds stays 0).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageRole, type Message } from "@anam-ai/js-sdk";
import {
  CALL_END_REASONS,
  CALL_TIMINGS,
  isCallPersona,
  type CallEndReason,
  type CallTurnRequest,
} from "@/lib/call-config";
import {
  CLOCK_TICK_MS,
  SPEECH_END_FALLBACK_MS,
  USER_SPEECH_DROPPED_MS,
  callSecondsAt,
  clockAfterReplyFinished,
  clockAfterStudentSpeechStarted,
  clockAfterTurnSent,
  dueSilenceTurn,
  dueTimeMark,
  emptyCallClock,
  endCallClock,
  isStudentsTurn,
  localTimeAt,
  silenceSecondsAt,
  type CallClock,
  type TurnSource,
} from "@/lib/call-clock";
import type { ChatPersona, LegacyChatStage } from "@/lib/chat-personas";
import { SIMULATION_POST_SPEAK_COOLDOWN_MS } from "@/lib/constants";
import { buildDefaultOpeningGreeting } from "@/lib/persona";
import type { AnamSessionStage } from "@/lib/tempo-anam-config";
import {
  getAvatarInitError,
  setAvatarSessionConfig,
  setAvatarVoiceCallbacks,
  type ExtendedAvatarRef,
} from "@/components/Avatar";
import type { AvatarRef, ChatMessage } from "@/types";

export type SimulationVoiceConfig = {
  /** Who the persona is; the server builds its system prompt from this key. */
  persona: ChatPersona;
  /** For persona "simulation": the legacy call stage whose hint the server appends. */
  chatStage?: LegacyChatStage;
  /** Legacy personas only: the fixed opening line (call personas ask the brain for theirs). */
  openingGreeting?: string;
  isMutedRef?: React.MutableRefObject<boolean>;
  /** The student's attempt (the Anam session, /api/chat and the call brain are checked against it). */
  attemptId: string;
  /** Which Anam avatar and voice the session uses. */
  anamStage: AnamSessionStage;
  /**
   * Call personas only: the brain ended the call (endCall). Called once the reply has been
   * spoken and the avatar has stopped; end the call as the end-call button does.
   */
  onCallEnd?: (endReason: CallEndReason) => void;
};

export type SimulationVoiceReturn = {
  avatarRef: React.RefObject<AvatarRef>;
  statusText: string;
  userTranscripts: string;
  personaTranscripts: string;
  /** Call personas: the call time in whole seconds (frozen when the call ends); 0 otherwise. */
  callSeconds: number;
  getFullTranscript: () => string;
  /** Starts Anam streaming using an audio-only MediaStream (not the PiP video stream). */
  startCall: (audioStream: MediaStream) => Promise<void>;
  endCall: () => void;
  /** Legacy calls: swaps Anam's mic input (useVideoCall's new stream after unmute). */
  replaceAudioStream: (audioStream: MediaStream) => void;
  /** Mutes Anam's mic input (Anam's own input mute) without ending the call. */
  pauseMic: () => void;
  /** Unmutes Anam's mic input: the same stream (the lobby's) carries on. */
  resumeMic: () => void;
};

/** The shared call brain's route (call personas only). */
const CALL_TURN_ENDPOINT = "/api/student/call-turn";

/** The rude and break_character labels this call has had (sent with every call turn). */
type CallStrikes = { rude: number; breakCharacter: number };

function getExtendedAvatar(ref: AvatarRef | null): ExtendedAvatarRef | null {
  return ref as ExtendedAvatarRef | null;
}

/** The call-turn response's fields the hook uses, or null when the body isn't a reply. */
function readCallTurnResponse(
  body: unknown
): { reply: string; endReason: CallEndReason | null; label: string | null } | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const { reply, endCall, endReason, label } = body as Record<string, unknown>;
  if (typeof reply !== "string") {
    return null;
  }
  // endCall always comes with endReason; an unknown one still ends the call (as the backstop).
  const reason = endCall === true ? (CALL_END_REASONS.find((known) => known === endReason) ?? "backstop") : null;
  return { reply: reply.trim(), endReason: reason, label: typeof label === "string" ? label : null };
}

/**
 * Voice hook with Anam playback and turn-taking for discovery / objections.
 */
export function useSimulationVoiceSession(
  config: SimulationVoiceConfig
): SimulationVoiceReturn {
  // The Anam session config (attempt and stage), set here only: synchronous on every
  // render, so it is in place before any connect effect calls startSession.
  const sessionAttemptId = config.attemptId.trim();
  if (sessionAttemptId) {
    setAvatarSessionConfig({ attemptId: sessionAttemptId, stage: config.anamStage });
  }

  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [userTranscripts, setUserTranscripts] = useState("");
  const [personaTranscripts, setPersonaTranscripts] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callSeconds, setCallSeconds] = useState(0);

  const avatarRef = useRef<AvatarRef>(null);
  const isSpeakingRef = useRef(false);
  const isProcessingUserRef = useRef(false);
  const canListenAfterRef = useRef(0);
  const playbackEpochRef = useRef(0);
  const llmEpochRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const transcriptLinesRef = useRef<string[]>([]);
  const isActiveRef = useRef(false);
  const configRef = useRef(config);
  const pendingUtteranceRef = useRef("");
  const processedUserMessageIdsRef = useRef<Set<string>>(new Set());
  const greetingDeliveredRef = useRef(false);

  // ── Call personas only (the shared call brain) ───
  /** The call clock (lib/call-clock.ts): the ref is the source of truth; callSeconds re-renders. */
  const clockRef = useRef<CallClock>(emptyCallClock());
  const strikesRef = useRef<CallStrikes>({ rude: 0, breakCharacter: 0 });
  /** A reply is being spoken: Silence waits for Anam's end of speech (or the fallback). */
  const isAwaitingSpeechEndRef = useRef(false);
  const speechSentAtRef = useRef(0);
  /**
   * talk() commands sent this call whose end of speech hasn't come yet (one end of speech
   * per talk(), said in full or cut off, is assumed, as on the tester page). The ending
   * waits for 0, so an earlier reply still being spoken can't stop the goodbye.
   */
  const talksInFlightRef = useRef(0);
  /** The brain ended the call and the reply is being spoken: why (null otherwise). */
  const endingReasonRef = useRef<CallEndReason | null>(null);
  const endingTimerRef = useRef<number | null>(null);
  /** When Anam last said the student started speaking (null once they stopped). */
  const studentSpeechStartedAtRef = useRef<number | null>(null);
  /** Silence is held because the student started speaking on their turn. */
  const isSilenceHeldBySpeechRef = useRef(false);
  const sendCallTurnRef = useRef<(text: string, via: TurnSource) => Promise<boolean>>(async () => false);
  const runClockChecksRef = useRef<() => void>(() => undefined);
  const finishPersonaSpeechRef = useRef<(status?: string) => void>(() => undefined);
  const completePersonaEndingRef = useRef<() => void>(() => undefined);
  const releaseSilenceHoldRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const appendTranscript = useCallback((speaker: string, text: string): void => {
    transcriptLinesRef.current.push(`${speaker}: ${text}`);
  }, []);

  const isMicMuted = (): boolean => Boolean(configRef.current.isMutedRef?.current);

  const canIngestStudentSpeech = useCallback((): boolean => {
    return (
      !isMicMuted() &&
      !isSpeakingRef.current &&
      Date.now() >= canListenAfterRef.current
    );
  }, []);

  const canProcessStudentSpeech = useCallback((): boolean => {
    return canIngestStudentSpeech() && !isProcessingUserRef.current;
  }, [canIngestStudentSpeech]);

  const queuePendingUtterance = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const existing = pendingUtteranceRef.current.trim();
    pendingUtteranceRef.current = existing ? `${existing} ${trimmed}` : trimmed;
  };

  const flushPendingUtterance = useCallback((): void => {
    const pending = pendingUtteranceRef.current.trim();
    if (!pending || !canProcessStudentSpeech()) {
      return;
    }
    pendingUtteranceRef.current = "";
    void handleUserSentenceRef.current(pending);
  }, [canProcessStudentSpeech]);

  const scheduleFlushPending = useCallback((): void => {
    flushPendingUtterance();
    window.setTimeout(() => flushPendingUtterance(), 150);
    window.setTimeout(() => flushPendingUtterance(), 600);
  }, [flushPendingUtterance]);

  const handleUserSentenceRef = useRef<(text: string) => Promise<void>>(async () => {
    /* assigned after handleUserSentence is defined */
  });

  const speakPersona = useCallback(
    async (text: string): Promise<void> => {
      setPersonaTranscripts(text);
      appendTranscript("Persona", text);
      isSpeakingRef.current = true;
      const epoch = playbackEpochRef.current;
      let playbackFailed = false;

      try {
        const avatar = getExtendedAvatar(avatarRef.current);
        if (avatar && !avatar.isReady()) {
          const ready = await avatar.waitUntilReady();
          if (!ready || epoch !== playbackEpochRef.current) {
            setStatusText("Avatar not ready — reload and try again.");
            playbackFailed = true;
            return;
          }
        }

        if (epoch !== playbackEpochRef.current) {
          return;
        }

        await avatar?.talk(text);
        canListenAfterRef.current = Date.now() + SIMULATION_POST_SPEAK_COOLDOWN_MS;
      } catch (err) {
        console.error(err);
        setStatusText(err instanceof Error ? err.message : "Voice playback failed.");
        playbackFailed = true;
      } finally {
        if (epoch === playbackEpochRef.current) {
          isSpeakingRef.current = false;
          if (isActiveRef.current && !playbackFailed) {
            setStatusText("Your turn — speak when ready.");
          }
          scheduleFlushPending();
        }
      }
    },
    [appendTranscript, scheduleFlushPending]
  );

  // ── Call personas: clock, speech and turns ───

  /** Applies a clock rule to the latest clock and refreshes callSeconds. */
  const updateClock = useCallback((rule: (current: CallClock) => CallClock): void => {
    clockRef.current = rule(clockRef.current);
    setCallSeconds(callSecondsAt(clockRef.current, Date.now()));
  }, []);

  const clearEndingTimer = useCallback((): void => {
    if (endingTimerRef.current !== null) {
      window.clearTimeout(endingTimerRef.current);
      endingTimerRef.current = null;
    }
  }, []);

  /**
   * The persona's reply has been spoken (Anam's end of speech, the fallback, or it couldn't
   * be spoken): Silence counts from now, the opening gate opens (and the mic unmutes) after
   * the first reply, queued speech goes, then a due time mark or check-in.
   */
  const finishPersonaSpeech = useCallback(
    (status = "Your turn — speak when ready."): void => {
      isAwaitingSpeechEndRef.current = false;
      isSpeakingRef.current = false;
      canListenAfterRef.current = Date.now() + SIMULATION_POST_SPEAK_COOLDOWN_MS;
      updateClock((current) => clockAfterReplyFinished(current, Date.now()));
      // The student started speaking during the reply and hasn't stopped: Silence holds until they do.
      if (studentSpeechStartedAtRef.current !== null && isStudentsTurn(clockRef.current, false)) {
        updateClock((current) => clockAfterStudentSpeechStarted(current, false));
        isSilenceHeldBySpeechRef.current = true;
      }
      if (!greetingDeliveredRef.current) {
        // The opening has been spoken: the student's speech counts from here.
        greetingDeliveredRef.current = true;
        pendingUtteranceRef.current = "";
        if (!isMicMuted()) {
          getExtendedAvatar(avatarRef.current)?.setInputMuted(false);
        }
      }
      if (isActiveRef.current) {
        setStatusText(status);
      }
      scheduleFlushPending();
      runClockChecksRef.current();
    },
    [updateClock, scheduleFlushPending]
  );

  finishPersonaSpeechRef.current = finishPersonaSpeech;

  /**
   * Sends a call persona's reply to the avatar. True when the talk command went out (the
   * reply then counts as spoken at Anam's end of speech); false when it couldn't be spoken.
   */
  const speakCallReply = useCallback(
    async (text: string): Promise<boolean> => {
      setPersonaTranscripts(text);
      appendTranscript("Persona", text);
      isSpeakingRef.current = true;
      // Set before talk(): the end of speech may arrive before talk() resolves.
      isAwaitingSpeechEndRef.current = true;
      speechSentAtRef.current = Date.now();
      talksInFlightRef.current += 1;
      const epoch = playbackEpochRef.current;

      try {
        const avatar = getExtendedAvatar(avatarRef.current);
        if (!avatar) {
          throw new Error("Avatar not ready — reload and try again.");
        }
        if (!avatar.isReady()) {
          const ready = await avatar.waitUntilReady();
          if (!ready) {
            throw new Error("Avatar not ready — reload and try again.");
          }
        }
        if (epoch !== playbackEpochRef.current) {
          return false;
        }
        await avatar.talk(text);
        return true;
      } catch (err) {
        console.error(err);
        talksInFlightRef.current = Math.max(0, talksInFlightRef.current - 1);
        isAwaitingSpeechEndRef.current = false;
        return false;
      }
    },
    [appendTranscript]
  );

  /** (Re)starts the ending's fallback: the call ends this long from now even with no end of speech. */
  const armEndingFallback = useCallback((): void => {
    clearEndingTimer();
    endingTimerRef.current = window.setTimeout(() => completePersonaEndingRef.current(), SPEECH_END_FALLBACK_MS);
  }, [clearEndingTimer]);

  /**
   * endCall from the brain: the clock stops and nothing more is sent; the mic is muted so
   * the student can't cut the reply off; the reply is spoken in full (then, or after the
   * fallback, completePersonaEnding stops the avatar and calls onCallEnd).
   */
  const endCallByPersona = useCallback(
    async (reply: string, endReason: CallEndReason): Promise<void> => {
      endingReasonRef.current = endReason;
      updateClock((current) => endCallClock(current, Date.now()));
      pendingUtteranceRef.current = "";
      studentSpeechStartedAtRef.current = null;
      isSilenceHeldBySpeechRef.current = false;
      getExtendedAvatar(avatarRef.current)?.setInputMuted(true);
      const isSpeaking = reply ? await speakCallReply(reply) : false;
      // The end-call button during the reply already ended the call.
      if (endingReasonRef.current !== endReason) {
        return;
      }
      if (!isSpeaking) {
        completePersonaEndingRef.current();
        return;
      }
      armEndingFallback();
    },
    [updateClock, speakCallReply, armEndingFallback]
  );

  /** The student's queued words go before a time mark or check-in (they carry the time note too). */
  const runClockChecks = useCallback((): void => {
    const persona = configRef.current.persona;
    if (!isCallPersona(persona) || !isActiveRef.current || endingReasonRef.current !== null) {
      return;
    }
    if (pendingUtteranceRef.current.trim() && !isMicMuted()) {
      return;
    }
    const at = Date.now();
    const timings = CALL_TIMINGS[persona];
    if (dueTimeMark(clockRef.current, at, timings, isProcessingUserRef.current)) {
      void sendCallTurnRef.current("", "timeMark");
    } else if (dueSilenceTurn(clockRef.current, at, timings, isProcessingUserRef.current)) {
      void sendCallTurnRef.current("", "silence");
    }
  }, []);

  runClockChecksRef.current = runClockChecks;

  /**
   * One turn to the call brain: the history so far, the student's text or start / timeMark
   * / silent: true, and the clock, Silence and strikes. Speaks the reply; on endCall, ends
   * the call. True when a reply came back. A failed turn adds nothing to the history and
   * Silence counts from then. Nothing is sent once the call is ending or ended; spoken text
   * that arrives while a turn is in flight is queued.
   */
  const sendCallTurn = useCallback(
    async (text: string, via: TurnSource): Promise<boolean> => {
      const persona = configRef.current.persona;
      if (
        !isCallPersona(persona) ||
        !isActiveRef.current ||
        endingReasonRef.current !== null ||
        clockRef.current.endedAt !== null
      ) {
        return false;
      }
      const isStudentText = via === "typed" || via === "spoken";
      const trimmed = text.trim();
      if (isStudentText && !trimmed) {
        return false;
      }
      if (isProcessingUserRef.current) {
        if (isStudentText) {
          queuePendingUtterance(trimmed);
        }
        return false;
      }
      if (via === "start" && clockRef.current.startedAt !== null) {
        return false;
      }
      const timings = CALL_TIMINGS[persona];
      const sentAt = Date.now();
      if (via === "timeMark" && !dueTimeMark(clockRef.current, sentAt, timings, false)) {
        return false;
      }

      isProcessingUserRef.current = true;
      if (via === "start") {
        strikesRef.current = { rude: 0, breakCharacter: 0 };
      }
      const prior = messagesRef.current;
      const llmEpoch = llmEpochRef.current;
      // The readouts at send time: Silence before this turn resets it; the call time after
      // this turn starts the call (so the start turn sends 0).
      const silenceSeconds = silenceSecondsAt(clockRef.current, sentAt);
      const isAfterCheckIn = via === "silence" && clockRef.current.silenceTurnsSent >= 1;
      updateClock((current) => clockAfterTurnSent(current, sentAt, via, timings));
      const turnCallSeconds = callSecondsAt(clockRef.current, sentAt);
      // A new turn: an older reply's end of speech and the student's speech no longer move Silence.
      isAwaitingSpeechEndRef.current = false;
      isSilenceHeldBySpeechRef.current = false;
      if (isStudentText) {
        setUserTranscripts(trimmed);
        appendTranscript("Student", trimmed);
        setStatusText("Thinking...");
      }

      const body: CallTurnRequest = {
        attemptId: configRef.current.attemptId.trim(),
        persona,
        messages: prior,
        ...(isStudentText ? { newMessage: trimmed } : {}),
        callSeconds: turnCallSeconds,
        silenceSeconds,
        ...(via === "silence" ? { silent: true as const, ...(isAfterCheckIn ? { afterCheckIn: true as const } : {}) } : {}),
        ...(via === "start" ? { start: true as const, localTime: localTimeAt(new Date()) } : {}),
        ...(via === "timeMark" ? { timeMark: true as const } : {}),
        strikes: { ...strikesRef.current },
      };

      try {
        const response = await fetch(CALL_TURN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = response.ok ? readCallTurnResponse(await response.json().catch(() => null)) : null;
        if (llmEpoch !== llmEpochRef.current) {
          return false;
        }
        if (!data) {
          throw new Error(`Call turn failed (${response.status})`);
        }

        // rude and break_character count as strikes for the rest of the call (capped at 9, as the brain reads them).
        const strikeKey = data.label === "rude" ? "rude" : data.label === "break_character" ? "breakCharacter" : null;
        if (strikeKey) {
          strikesRef.current = { ...strikesRef.current, [strikeKey]: Math.min(9, strikesRef.current[strikeKey] + 1) };
        }
        if (data.reply) {
          // A start, time-mark or silent turn adds only the persona's reply: no student text.
          const studentTurn: ChatMessage[] = isStudentText ? [{ role: "user", content: trimmed }] : [];
          const next: ChatMessage[] = [...prior, ...studentTurn, { role: "assistant", content: data.reply }];
          setMessages(next);
          messagesRef.current = next;
        }

        if (data.endReason !== null) {
          void endCallByPersona(data.reply, data.endReason);
          return true;
        }
        if (!data.reply) {
          throw new Error("Call turn returned no reply.");
        }
        const isSpeaking = await speakCallReply(data.reply);
        if (!isSpeaking && llmEpoch === llmEpochRef.current) {
          finishPersonaSpeech("Voice playback failed — speak when ready.");
        }
        return true;
      } catch (err) {
        console.error(err);
        // A failed opening is handled by startCall.
        if (via !== "start" && llmEpoch === llmEpochRef.current) {
          finishPersonaSpeech("Could not get a reply — speak when ready.");
        }
        return false;
      } finally {
        if (llmEpoch === llmEpochRef.current) {
          isProcessingUserRef.current = false;
          scheduleFlushPending();
          runClockChecks();
        }
      }
    },
    [appendTranscript, updateClock, endCallByPersona, speakCallReply, finishPersonaSpeech, scheduleFlushPending, runClockChecks]
  );

  sendCallTurnRef.current = sendCallTurn;

  /**
   * The student stopped speaking (Anam's USER_SPEECH_ENDED), or their start had no end
   * within USER_SPEECH_DROPPED_MS (a dropped detection): on their turn, Silence counts
   * from now (a held one too). A late end after a dropped start still restarts it.
   */
  const releaseSilenceHold = useCallback((): void => {
    studentSpeechStartedAtRef.current = null;
    const wasHeld = isSilenceHeldBySpeechRef.current;
    isSilenceHeldBySpeechRef.current = false;
    if (!wasHeld && !isStudentsTurn(clockRef.current, isProcessingUserRef.current)) {
      return;
    }
    updateClock((current) => clockAfterReplyFinished(current, Date.now()));
    runClockChecks();
  }, [updateClock, runClockChecks]);

  releaseSilenceHoldRef.current = releaseSilenceHold;

  const handleUserSpeechStarted = useCallback((): void => {
    if (!isCallPersona(configRef.current.persona) || !isActiveRef.current || endingReasonRef.current !== null) {
      return;
    }
    studentSpeechStartedAtRef.current = Date.now();
    // Only on the student's turn: during the persona's turn Silence is already at 00:00.
    if (isStudentsTurn(clockRef.current, isProcessingUserRef.current)) {
      updateClock((current) => clockAfterStudentSpeechStarted(current, isProcessingUserRef.current));
      isSilenceHeldBySpeechRef.current = true;
    }
  }, [updateClock]);

  const handleUserSpeechEnded = useCallback((): void => {
    if (!isCallPersona(configRef.current.persona)) {
      return;
    }
    releaseSilenceHold();
  }, [releaseSilenceHold]);

  /** Anam's end of speech for a persona message (MESSAGE_HISTORY_UPDATED ending on the persona). */
  const handlePersonaSpeechEnded = useCallback((): void => {
    talksInFlightRef.current = Math.max(0, talksInFlightRef.current - 1);
    if (endingReasonRef.current !== null) {
      // The ending: stop once every talk() has ended; an earlier reply ending first restarts the fallback.
      if (talksInFlightRef.current === 0) {
        completePersonaEndingRef.current();
      } else {
        armEndingFallback();
      }
      return;
    }
    if (isAwaitingSpeechEndRef.current) {
      finishPersonaSpeech();
    }
  }, [armEndingFallback, finishPersonaSpeech]);

  const handleUserSentence = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      if (!canProcessStudentSpeech()) {
        queuePendingUtterance(trimmed);
        return;
      }

      // Call personas: the shared call brain (POST /api/student/call-turn).
      if (isCallPersona(configRef.current.persona)) {
        await sendCallTurn(trimmed, "spoken");
        return;
      }

      isProcessingUserRef.current = true;
      setUserTranscripts(trimmed);
      appendTranscript("Student", trimmed);
      setStatusText("Thinking...");

      const prior = messagesRef.current;
      const llmEpoch = llmEpochRef.current;

      try {
        // The persona key only: the server builds the system prompt.
        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId: configRef.current.attemptId.trim(),
            persona: configRef.current.persona,
            stage: configRef.current.chatStage,
            messages: prior,
            newMessage: trimmed,
          }),
        });

        if (llmEpoch !== llmEpochRef.current) {
          return;
        }

        if (!chatRes.ok) {
          const errBody = (await chatRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? `Chat failed (${chatRes.status})`);
        }

        const { reply } = (await chatRes.json()) as { reply: string };

        if (llmEpoch !== llmEpochRef.current) {
          return;
        }

        const next: ChatMessage[] = [
          ...prior,
          { role: "user", content: trimmed },
          { role: "assistant", content: reply },
        ];
        setMessages(next);
        messagesRef.current = next;
        await speakPersona(reply);
      } catch (err) {
        console.error(err);
        setStatusText(err instanceof Error ? err.message : "Could not get reply.");
      } finally {
        isProcessingUserRef.current = false;
        scheduleFlushPending();
      }
    },
    [speakPersona, appendTranscript, scheduleFlushPending, canProcessStudentSpeech, sendCallTurn]
  );

  handleUserSentenceRef.current = handleUserSentence;

  const handleMessageHistoryUpdated = useCallback(
    (history: Message[]): void => {
      if (!isActiveRef.current || history.length === 0) {
        return;
      }

      const last = history[history.length - 1];
      // Call personas: the persona finished speaking (or was cut off).
      if (last.role === MessageRole.PERSONA && isCallPersona(configRef.current.persona)) {
        handlePersonaSpeechEnded();
        return;
      }
      if (last.role !== MessageRole.USER) {
        return;
      }

      if (processedUserMessageIdsRef.current.has(last.id)) {
        return;
      }
      processedUserMessageIdsRef.current.add(last.id);

      const trimmed = last.content.trim();
      if (!trimmed) {
        return;
      }

      // Ignore mic/STT until the opening has been delivered (call personas: until it has been spoken).
      if (!greetingDeliveredRef.current) {
        return;
      }

      setUserTranscripts(trimmed);

      if (!canProcessStudentSpeech()) {
        queuePendingUtterance(trimmed);
        return;
      }

      void handleUserSentence(trimmed);
    },
    [handleUserSentence, canProcessStudentSpeech, handlePersonaSpeechEnded]
  );

  const handleTalkStreamInterrupted = useCallback((): void => {
    // Call personas: the closing reply was cut off, so the call ends now.
    if (isCallPersona(configRef.current.persona) && endingReasonRef.current !== null) {
      completePersonaEndingRef.current();
      return;
    }
    playbackEpochRef.current += 1;
    llmEpochRef.current += 1;
    isSpeakingRef.current = false;
    isProcessingUserRef.current = false;
    getExtendedAvatar(avatarRef.current)?.stopSpeaking();
    if (isActiveRef.current) {
      setStatusText("Your turn — speak when ready.");
    }
    scheduleFlushPending();
    // Call personas: the reply was cut off, so it counts as spoken (Silence counts from now).
    if (isCallPersona(configRef.current.persona) && isAwaitingSpeechEndRef.current) {
      finishPersonaSpeechRef.current();
    }
  }, [scheduleFlushPending]);

  const handleConnectionClosed = useCallback((reason: string, details?: string): void => {
    console.warn("[voice] Anam connection closed:", reason, details ?? "");
    setStatusText("Call connection ended.");
    setIsActive(false);
  }, []);

  // ── Anam event wiring ──────────────────────────────────────────────────────

  useEffect(() => {
    setAvatarVoiceCallbacks({
      onMessageHistoryUpdated: handleMessageHistoryUpdated,
      onTalkStreamInterrupted: handleTalkStreamInterrupted,
      onConnectionClosed: handleConnectionClosed,
      onUserSpeechStarted: handleUserSpeechStarted,
      onUserSpeechEnded: handleUserSpeechEnded,
    });

    return () => {
      setAvatarVoiceCallbacks({});
    };
  }, [
    handleMessageHistoryUpdated,
    handleTalkStreamInterrupted,
    handleConnectionClosed,
    handleUserSpeechStarted,
    handleUserSpeechEnded,
  ]);

  // ── Call personas: the clock tick ───
  // While the call runs: refresh callSeconds, apply the end-of-speech fallback and the
  // dropped-speech rule, and send a due time mark or check-in.
  const isCallClockRunning = isActive && isCallPersona(config.persona);
  useEffect(() => {
    if (!isCallClockRunning) {
      return undefined;
    }
    const tick = (): void => {
      const at = Date.now();
      setCallSeconds(callSecondsAt(clockRef.current, at));
      if (clockRef.current.startedAt === null || clockRef.current.endedAt !== null) {
        return;
      }
      if (isAwaitingSpeechEndRef.current && at - speechSentAtRef.current >= SPEECH_END_FALLBACK_MS) {
        finishPersonaSpeechRef.current();
      }
      const speechStartedAt = studentSpeechStartedAtRef.current;
      if (speechStartedAt !== null && at - speechStartedAt >= USER_SPEECH_DROPPED_MS) {
        releaseSilenceHoldRef.current();
      }
      runClockChecksRef.current();
    };
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [isCallClockRunning]);

  // The ending's fallback timer never outlives the component.
  useEffect(() => clearEndingTimer, [clearEndingTimer]);

  const stopListening = useCallback((): void => {
    pendingUtteranceRef.current = "";
    setIsActive(false);
  }, []);

  const startCall = useCallback(
    async (audioStream: MediaStream): Promise<void> => {
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error("No microphone audio track available.");
      }

      // The session config itself was set at render (the top of this hook).
      if (!configRef.current.attemptId.trim()) {
        throw new Error("Missing attempt ID or stage for Anam session.");
      }

      try {
        const avatar = getExtendedAvatar(avatarRef.current);
        avatar?.resumeAudioContext();
        setIsActive(true);
        setMessages([]);
        messagesRef.current = [];
        transcriptLinesRef.current = [];
        processedUserMessageIdsRef.current.clear();
        setUserTranscripts("");
        setPersonaTranscripts("");
        pendingUtteranceRef.current = "";
        greetingDeliveredRef.current = false;

        const sessionReady = await avatar?.waitUntilReady();
        if (!sessionReady) {
          throw new Error(
            getAvatarInitError() ??
              "Could not connect to persona in time. Check Anam configuration and try again."
          );
        }

        avatar?.setInputMuted(true);
        await avatar?.beginStreaming(audioStream);
        await avatar?.waitForSessionReady();

        // Call personas: the opening comes from the call brain (a start turn).
        if (isCallPersona(configRef.current.persona)) {
          clockRef.current = emptyCallClock();
          setCallSeconds(0);
          strikesRef.current = { rude: 0, breakCharacter: 0 };
          talksInFlightRef.current = 0;
          isAwaitingSpeechEndRef.current = false;
          endingReasonRef.current = null;
          clearEndingTimer();
          studentSpeechStartedAtRef.current = null;
          isSilenceHeldBySpeechRef.current = false;
          isActiveRef.current = true;
          setStatusText("Persona is greeting you…");
          const isOpened = await sendCallTurn("", "start");
          if (!isOpened) {
            // Nothing is left streaming when the call can't start.
            void avatar?.endSession();
            throw new Error("Could not start the call. Reload and try again.");
          }
          return;
        }

        const greeting =
          configRef.current.openingGreeting ?? buildDefaultOpeningGreeting();
        const greetingMessage: ChatMessage = { role: "assistant", content: greeting };

        setStatusText("Persona is greeting you…");
        await speakPersona(greeting);

        messagesRef.current = [greetingMessage];
        setMessages([greetingMessage]);
        greetingDeliveredRef.current = true;
        pendingUtteranceRef.current = "";
        canListenAfterRef.current = Date.now() + SIMULATION_POST_SPEAK_COOLDOWN_MS;

        if (!isMicMuted()) {
          avatar?.setInputMuted(false);
        }
      } catch (err) {
        console.error(err);
        setStatusText(
          err instanceof Error ? err.message : "Could not start voice session."
        );
        setIsActive(false);
        throw err;
      }
    },
    [speakPersona, sendCallTurn, clearEndingTimer]
  );

  const endCall = useCallback((): void => {
    // Call personas: the clock stops, and an ending in progress is settled.
    if (isCallPersona(configRef.current.persona)) {
      updateClock((current) => endCallClock(current, Date.now()));
      endingReasonRef.current = null;
      clearEndingTimer();
      isAwaitingSpeechEndRef.current = false;
      studentSpeechStartedAtRef.current = null;
      isSilenceHeldBySpeechRef.current = false;
    }
    playbackEpochRef.current += 1;
    llmEpochRef.current += 1;
    isSpeakingRef.current = false;
    isProcessingUserRef.current = false;
    getExtendedAvatar(avatarRef.current)?.stopSpeaking();
    stopListening();
    void getExtendedAvatar(avatarRef.current)?.endSession();
  }, [stopListening, updateClock, clearEndingTimer]);

  /** The persona's closing reply has been spoken: stop the avatar, then end the call with its reason. */
  const completePersonaEnding = useCallback((): void => {
    const endReason = endingReasonRef.current;
    if (endReason === null) {
      return;
    }
    endCall();
    configRef.current.onCallEnd?.(endReason);
  }, [endCall]);

  completePersonaEndingRef.current = completePersonaEnding;

  const replaceAudioStream = useCallback((audioStream: MediaStream): void => {
    if (audioStream.getAudioTracks().length === 0) {
      return;
    }
    void getExtendedAvatar(avatarRef.current)?.updateInputStream(audioStream);
  }, []);

  const pauseMic = useCallback((): void => {
    if (configRef.current.isMutedRef) {
      configRef.current.isMutedRef.current = true;
    }
    getExtendedAvatar(avatarRef.current)?.setInputMuted(true);
  }, []);

  // Anam's input mute on the current stream: no new stream, so the lobby's echo-cancelled mic carries on.
  const resumeMic = useCallback((): void => {
    if (configRef.current.isMutedRef) {
      configRef.current.isMutedRef.current = false;
    }
    getExtendedAvatar(avatarRef.current)?.setInputMuted(false);
  }, []);

  return {
    avatarRef,
    statusText,
    userTranscripts,
    personaTranscripts,
    callSeconds,
    getFullTranscript: () => transcriptLinesRef.current.join("\n"),
    startCall,
    endCall,
    replaceAudioStream,
    pauseMic,
    resumeMic,
  };
}
