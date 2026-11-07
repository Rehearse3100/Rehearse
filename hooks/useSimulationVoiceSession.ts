/**
 * useSimulationVoiceSession.ts
 * Anam custom-LLM voice stages: Anam STT/TTS/avatar + GPT via /api/chat (the call
 * sends a persona key and the attempt id; the server builds the system prompt).
 * Does not acquire media — caller supplies the lobby MediaStream on join.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageRole, type Message } from "@anam-ai/js-sdk";
import type { ChatPersona, LegacyChatStage } from "@/lib/chat-personas";
import { SIMULATION_POST_SPEAK_COOLDOWN_MS } from "@/lib/constants";
import { buildDefaultOpeningGreeting } from "@/lib/persona";
import {
  getAvatarInitError,
  setAvatarSessionConfig,
  setAvatarVoiceCallbacks,
  type AnamSessionStage,
  type ExtendedAvatarRef,
} from "@/components/Avatar";
import type { AvatarRef, ChatMessage } from "@/types";

export type SimulationVoiceConfig = {
  /** Who the persona is; /api/chat builds its system prompt from this key on the server. */
  persona: ChatPersona;
  /** For persona "simulation": the legacy call stage whose hint the server appends. */
  chatStage?: LegacyChatStage;
  openingGreeting?: string;
  isMutedRef?: React.MutableRefObject<boolean>;
  attemptId?: string;
  anamStage?: AnamSessionStage;
};

export type SimulationVoiceReturn = {
  avatarRef: React.RefObject<AvatarRef>;
  isActive: boolean;
  statusText: string;
  userTranscripts: string;
  personaTranscripts: string;
  getFullTranscript: () => string;
  /** Starts Anam streaming using an audio-only MediaStream (not the PiP video stream). */
  startCall: (audioStream: MediaStream) => Promise<void>;
  stopListening: () => void;
  endCall: () => void;
  /** Swap mic input after unmute. */
  replaceAudioStream: (audioStream: MediaStream) => void;
  /** Mutes Anam mic input without ending the call. */
  pauseMic: () => void;
  /** Resumes Anam mic input on a (usually fresh) mic stream. */
  resumeMic: (audioStream: MediaStream) => void;
};

function resolveAttemptId(configAttemptId?: string): string {
  if (configAttemptId?.trim()) {
    return configAttemptId.trim();
  }
  if (typeof window !== "undefined") {
    const param = new URLSearchParams(window.location.search).get("attempt");
    if (param?.trim()) {
      return param.trim();
    }
  }
  return "";
}

function resolveAnamStage(
  persona: ChatPersona,
  configStage?: AnamSessionStage
): AnamSessionStage | null {
  if (configStage) {
    return configStage;
  }
  if (persona === "tempo_discovery") {
    return "discovery";
  }
  if (persona === "tempo_objections") {
    return "objections";
  }
  return null;
}

function getExtendedAvatar(ref: AvatarRef | null): ExtendedAvatarRef | null {
  return ref as ExtendedAvatarRef | null;
}

/**
 * Voice hook with Anam playback and turn-taking for discovery / objections.
 */
export function useSimulationVoiceSession(
  config: SimulationVoiceConfig
): SimulationVoiceReturn {
  // Synchronous — must be set before any connect effect calls startSession.
  const initialAttemptId = resolveAttemptId(config.attemptId);
  const initialStage = resolveAnamStage(config.persona, config.anamStage);
  if (initialAttemptId && initialStage) {
    setAvatarSessionConfig({ attemptId: initialAttemptId, stage: initialStage });
  }

  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [userTranscripts, setUserTranscripts] = useState("");
  const [personaTranscripts, setPersonaTranscripts] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

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

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // ── Anam session config (attemptId from prop or ?attempt= URL param) ───────

  useEffect(() => {
    const attemptId = resolveAttemptId(config.attemptId);
    const stage = resolveAnamStage(config.persona, config.anamStage);
    if (!attemptId || !stage) {
      return;
    }

    setAvatarSessionConfig({ attemptId, stage });
    const avatar = getExtendedAvatar(avatarRef.current);
    avatar?.configureSession({ attemptId, stage });
  }, [config.attemptId, config.anamStage, config.persona]);

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
            attemptId: resolveAttemptId(configRef.current.attemptId),
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
    [speakPersona, appendTranscript, scheduleFlushPending, canProcessStudentSpeech]
  );

  handleUserSentenceRef.current = handleUserSentence;

  const handleMessageHistoryUpdated = useCallback(
    (history: Message[]): void => {
      if (!isActiveRef.current || history.length === 0) {
        return;
      }

      const last = history[history.length - 1];
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

      // Ignore mic/STT until the scripted opening greeting has been delivered.
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
    [handleUserSentence, canProcessStudentSpeech]
  );

  const handleTalkStreamInterrupted = useCallback((): void => {
    playbackEpochRef.current += 1;
    llmEpochRef.current += 1;
    isSpeakingRef.current = false;
    isProcessingUserRef.current = false;
    getExtendedAvatar(avatarRef.current)?.stopSpeaking();
    if (isActiveRef.current) {
      setStatusText("Your turn — speak when ready.");
    }
    scheduleFlushPending();
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
    });

    return () => {
      setAvatarVoiceCallbacks({});
    };
  }, [handleMessageHistoryUpdated, handleTalkStreamInterrupted, handleConnectionClosed]);

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

      const attemptId = resolveAttemptId(configRef.current.attemptId);
      const stage = resolveAnamStage(
        configRef.current.persona,
        configRef.current.anamStage
      );
      if (!attemptId || !stage) {
        throw new Error("Missing attempt ID or stage for Anam session.");
      }

      try {
        const avatar = getExtendedAvatar(avatarRef.current);
        avatar?.configureSession({ attemptId, stage });
        setAvatarSessionConfig({ attemptId, stage });

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
    [speakPersona]
  );

  const endCall = useCallback((): void => {
    playbackEpochRef.current += 1;
    llmEpochRef.current += 1;
    isSpeakingRef.current = false;
    isProcessingUserRef.current = false;
    getExtendedAvatar(avatarRef.current)?.stopSpeaking();
    stopListening();
    void getExtendedAvatar(avatarRef.current)?.endSession();
  }, [stopListening]);

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

  const resumeMic = useCallback(
    (audioStream: MediaStream): void => {
      if (configRef.current.isMutedRef) {
        configRef.current.isMutedRef.current = false;
      }
      getExtendedAvatar(avatarRef.current)?.setInputMuted(false);
      replaceAudioStream(audioStream);
    },
    [replaceAudioStream]
  );

  return {
    avatarRef,
    isActive,
    statusText,
    userTranscripts,
    personaTranscripts,
    getFullTranscript: () => transcriptLinesRef.current.join("\n"),
    startCall,
    stopListening,
    endCall,
    replaceAudioStream,
    pauseMic,
    resumeMic,
  };
}
