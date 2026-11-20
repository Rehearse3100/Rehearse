/**
 * Avatar.tsx
 * Anam WebRTC video avatar for Tempo Discovery / Objection Handling calls.
 * Exposes AvatarRef via forwardRef; voice orchestration lives in useSimulationVoiceSession.
 * Module-level client survives remount (Objection Handling connect→active double-mount).
 */

"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AnamEvent, createClient, type AnamClient, type Message, type PersonaConfig } from "@anam-ai/js-sdk";
import {
  CALL_PERSONA_VIDEO_CLASS,
  CALL_PERSONA_VIDEO_FRAME_CLASS,
  CALL_PERSONA_VIDEO_GRADIENT_CLASS,
} from "@/components/call/CallLayout";
import { ANAM_CONNECT_TIMEOUT_MS } from "@/lib/constants";
import type { AvatarRef, SpeakAudioPayload } from "@/types";

export type { AvatarRef } from "@/types";

/** Fixed DOM id — streamToVideoElement targets this element across remounts. */
export const ANAM_PERSONA_VIDEO_ELEMENT_ID = "anam-persona-video";

export type AnamSessionStage = "discovery" | "objections";

export type AvatarSessionConfig = {
  attemptId: string;
  stage: AnamSessionStage;
};

export type AvatarVoiceCallbacks = {
  onMessageHistoryUpdated?: (messages: Message[]) => void;
  onTalkStreamInterrupted?: (correlationId: string) => void;
  onConnectionClosed?: (reason: string, details?: string) => void;
  /** Anam's USER_SPEECH_STARTED: the student started speaking (before any transcript). */
  onUserSpeechStarted?: (correlationId: string) => void;
  /** Anam's USER_SPEECH_ENDED: the student stopped speaking. */
  onUserSpeechEnded?: (correlationId: string) => void;
};

/** Extended imperative API used by useSimulationVoiceSession (not on AvatarRef). */
export type ExtendedAvatarRef = AvatarRef & {
  configureSession: (config: AvatarSessionConfig) => void;
  beginStreaming: (audioStream?: MediaStream) => Promise<void>;
  updateInputStream: (audioStream: MediaStream) => Promise<void>;
  waitForSessionReady: (maxMs?: number) => Promise<void>;
  talk: (text: string) => Promise<void>;
  setInputMuted: (muted: boolean) => void;
  endSession: () => Promise<void>;
};

// ── Module-level Anam session (survives Avatar remount) ─────────────────────

let sharedClient: AnamClient | null = null;
let clientSessionToken: string | null = null;
let isStreamingActive = false;
let inputStreamRef: MediaStream | null = null;
let sessionConfigRef: AvatarSessionConfig | null = null;
let voiceCallbacks: AvatarVoiceCallbacks = {};
let listenersRegistered = false;
let sessionEndRequested = false;
let lastInitError: string | null = null;
let activeSessionStageRef: AnamSessionStage | null = null;
let sessionReadyFired = false;
const sessionReadyWaiters: Array<() => void> = [];

function resetSessionReadyState(): void {
  sessionReadyFired = false;
  sessionReadyWaiters.length = 0;
}

function notifySessionReady(): void {
  sessionReadyFired = true;
  while (sessionReadyWaiters.length > 0) {
    sessionReadyWaiters.pop()?.();
  }
}

/**
 * Renames the ephemeral persona in Anam to the live session UUID for dashboard lookup.
 */
function applyAnamSessionPersonaName(sessionId: string): void {
  if (!sharedClient || !sessionId.trim()) {
    return;
  }

  const config = sharedClient.getPersonaConfig();
  if (!config) {
    return;
  }

  try {
    sharedClient.setPersonaConfig({ ...config, name: sessionId.trim() } as PersonaConfig);
  } catch (error) {
    console.warn("[Avatar] Could not set Anam persona name to session id:", error);
  }
}

/**
 * Last error from startSession / beginStreaming (for callers to surface in UI).
 */
export function getAvatarInitError(): string | null {
  return lastInitError;
}

/**
 * Sets attempt/stage before startSession (called from voice hook).
 */
export function setAvatarSessionConfig(config: AvatarSessionConfig): void {
  sessionConfigRef = config;
}

/**
 * Registers Anam event callbacks (called from voice hook).
 */
export function setAvatarVoiceCallbacks(callbacks: AvatarVoiceCallbacks): void {
  voiceCallbacks = callbacks;
}

function registerClientListeners(client: AnamClient): void {
  if (listenersRegistered) {
    return;
  }

  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages: Message[]) => {
    voiceCallbacks.onMessageHistoryUpdated?.(messages);
  });

  client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (correlationId: string) => {
    voiceCallbacks.onTalkStreamInterrupted?.(correlationId);
  });

  client.addListener(AnamEvent.CONNECTION_CLOSED, (reason: string, details?: string) => {
    isStreamingActive = false;
    resetSessionReadyState();
    voiceCallbacks.onConnectionClosed?.(reason, details);
  });

  client.addListener(AnamEvent.SESSION_READY, (sessionId: string) => {
    applyAnamSessionPersonaName(sessionId);
    notifySessionReady();
  });

  client.addListener(AnamEvent.USER_SPEECH_STARTED, (correlationId: string) => {
    voiceCallbacks.onUserSpeechStarted?.(correlationId);
  });

  client.addListener(AnamEvent.USER_SPEECH_ENDED, (correlationId: string) => {
    voiceCallbacks.onUserSpeechEnded?.(correlationId);
  });

  listenersRegistered = true;
}

async function endSharedSession(): Promise<void> {
  sessionEndRequested = true;
  const client = sharedClient;
  sharedClient = null;
  clientSessionToken = null;
  isStreamingActive = false;
  listenersRegistered = false;
  inputStreamRef = null;
  activeSessionStageRef = null;
  resetSessionReadyState();

  if (client) {
    await client.stopStreaming().catch(() => undefined);
  }
}

/**
 * Races a promise against a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
}

function waitForAnamSessionReady(maxMs: number): Promise<void> {
  if (sessionReadyFired) {
    return Promise.resolve();
  }
  return withTimeout(
    new Promise<void>((resolve) => {
      sessionReadyWaiters.push(resolve);
    }),
    maxMs,
    `Anam session did not become ready within ${maxMs / 1000}s.`
  );
}

/**
 * Best-effort autoplay for WebRTC video (Safari often needs a user gesture first).
 */
function kickVideoPlayback(video: HTMLVideoElement): void {
  video.muted = false;
  void video.play().catch(() => undefined);
}

async function beginStreamingInternal(stream?: MediaStream): Promise<void> {
  if (!sharedClient) {
    throw new Error("Anam client not initialized.");
  }

  if (stream) {
    inputStreamRef = stream;
  }

  await sharedClient.streamToVideoElement(
    ANAM_PERSONA_VIDEO_ELEMENT_ID,
    inputStreamRef ?? undefined
  );
  isStreamingActive = true;

  const video = document.getElementById(ANAM_PERSONA_VIDEO_ELEMENT_ID) as HTMLVideoElement | null;
  if (video) {
    kickVideoPlayback(video);
  }
}

export const Avatar = forwardRef<AvatarRef>(function Avatar(_props, ref) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isReadyRef = useRef(false);
  const sessionStartingRef = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const waitForMediaElements = useCallback(async (maxMs = 5000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (videoRef.current) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return videoRef.current !== null;
  }, []);

  const startSession = useCallback(async (): Promise<boolean> => {
    if (sessionEndRequested) {
      sessionEndRequested = false;
    }

    if (isReadyRef.current && sharedClient) {
      return true;
    }

    if (sessionStartingRef.current) {
      const start = Date.now();
      while (sessionStartingRef.current && Date.now() - start < ANAM_CONNECT_TIMEOUT_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
      return isReadyRef.current && sharedClient !== null;
    }

    const hasVideo = await waitForMediaElements();
    if (!hasVideo || !videoRef.current) {
      setInitError("Video element not ready. Try Join Call again.");
      return false;
    }

    const config = sessionConfigRef;
    if (!config?.attemptId || !config.stage) {
      setInitError("Missing attempt or stage for Anam session. Reload and try again.");
      return false;
    }

    if (
      activeSessionStageRef &&
      activeSessionStageRef !== config.stage &&
      sharedClient
    ) {
      await endSharedSession();
      sessionEndRequested = false;
    }

    sessionStartingRef.current = true;
    setIsConnecting(true);
    setInitError(null);
    lastInitError = null;

    try {
      const tokenRes = await fetch("/api/student/anam-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: config.attemptId, stage: config.stage }),
      });

      if (!tokenRes.ok) {
        const errBody = (await tokenRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Anam session failed (${tokenRes.status})`);
      }

      const { sessionToken } = (await tokenRes.json()) as { sessionToken?: string };
      if (!sessionToken?.trim()) {
        throw new Error("Anam session returned no token.");
      }

      if (sharedClient && clientSessionToken === sessionToken && isStreamingActive) {
        isReadyRef.current = true;
        setIsReady(true);
        return true;
      }

      if (sharedClient && clientSessionToken !== sessionToken) {
        await endSharedSession();
        sessionEndRequested = false;
      }

      if (!sharedClient) {
        sharedClient = createClient(sessionToken);
        clientSessionToken = sessionToken;
        registerClientListeners(sharedClient);
      }

      if (inputStreamRef) {
        await withTimeout(
          beginStreamingInternal(inputStreamRef),
          ANAM_CONNECT_TIMEOUT_MS,
          `Anam did not connect within ${ANAM_CONNECT_TIMEOUT_MS / 1000}s.`
        );
      }

      kickVideoPlayback(videoRef.current);
      isReadyRef.current = true;
      setIsReady(true);
      activeSessionStageRef = config.stage;
      return true;
    } catch (connectError) {
      console.error("Anam session failed:", connectError);
      const msg =
        connectError instanceof Error ? connectError.message : "Could not connect to Anam.";
      lastInitError = msg;
      setInitError(msg);
      return false;
    } finally {
      sessionStartingRef.current = false;
      setIsConnecting(false);
    }
  }, [waitForMediaElements]);

  // Reattach video when remounting with an active shared session (Objection double-mount).
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !sharedClient || !isStreamingActive) {
      return;
    }

    video.id = ANAM_PERSONA_VIDEO_ELEMENT_ID;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = false;

    void sharedClient
      .streamToVideoElement(ANAM_PERSONA_VIDEO_ELEMENT_ID, inputStreamRef ?? undefined)
      .then(() => kickVideoPlayback(video))
      .catch((err: unknown) => console.error("[Avatar] Reattach stream failed:", err));
  }, []);

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }
    el.id = ANAM_PERSONA_VIDEO_ELEMENT_ID;
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.muted = false;
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const video = videoRef.current;
    if (video) {
      kickVideoPlayback(video);
    }
  }, [isReady]);

  // Do not stop the shared Anam session on unmount — only on explicit endSession.

  useImperativeHandle(
    ref,
    (): ExtendedAvatarRef => ({
      startSession,
      waitForMediaElements,
      isReady: (): boolean => isReadyRef.current && sharedClient !== null,
      waitUntilReady: async (maxMs = ANAM_CONNECT_TIMEOUT_MS): Promise<boolean> => {
        if (isReadyRef.current && sharedClient) {
          return true;
        }
        const started = await startSession();
        if (started) {
          return true;
        }
        const start = Date.now();
        while (Date.now() - start < maxMs) {
          if (isReadyRef.current && sharedClient) {
            return true;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }
        return isReadyRef.current && sharedClient !== null;
      },
      resumeAudioContext: (): void => {
        const video = videoRef.current;
        if (video) {
          kickVideoPlayback(video);
        }
      },
      stopSpeaking: (): void => {
        sharedClient?.interruptPersona();
      },
      speakAudio: async (_payload: SpeakAudioPayload): Promise<void> => {
        /* Deprecated — Anam handles TTS via talk(). */
      },
      configureSession: (config: AvatarSessionConfig): void => {
        setAvatarSessionConfig(config);
      },
      beginStreaming: async (audioStream?: MediaStream): Promise<void> => {
        if (!sharedClient) {
          const ready = await startSession();
          if (!ready || !sharedClient) {
            throw new Error(
              lastInitError ?? "Anam client not ready — could not start session."
            );
          }
        }
        await withTimeout(
          beginStreamingInternal(audioStream),
          ANAM_CONNECT_TIMEOUT_MS,
          `Anam stream did not start within ${ANAM_CONNECT_TIMEOUT_MS / 1000}s.`
        );
        isReadyRef.current = true;
        setIsReady(true);
        const video = videoRef.current;
        if (video) {
          kickVideoPlayback(video);
        }
      },
      updateInputStream: async (audioStream: MediaStream): Promise<void> => {
        inputStreamRef = audioStream;
        if (!sharedClient || !isStreamingActive) {
          return;
        }
        await sharedClient.streamToVideoElement(
          ANAM_PERSONA_VIDEO_ELEMENT_ID,
          audioStream
        );
      },
      waitForSessionReady: async (maxMs = ANAM_CONNECT_TIMEOUT_MS): Promise<void> => {
        if (!sharedClient) {
          throw new Error("Anam client not ready — could not wait for session.");
        }
        await waitForAnamSessionReady(maxMs);
      },
      talk: async (text: string): Promise<void> => {
        if (!sharedClient?.isStreaming()) {
          throw new Error("Anam is not streaming — cannot speak.");
        }
        await sharedClient.talk(text);
      },
      setInputMuted: (muted: boolean): void => {
        if (!sharedClient) {
          return;
        }
        if (muted) {
          sharedClient.muteInputAudio();
        } else {
          sharedClient.unmuteInputAudio();
        }
      },
      endSession: async (): Promise<void> => {
        isReadyRef.current = false;
        setIsReady(false);
        await endSharedSession();
      },
    }),
    [startSession, waitForMediaElements]
  );

  const showOverlay = initError !== null || isConnecting;

  return (
    <div className="absolute inset-0 bg-call-background">
      {showOverlay && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 px-4 text-center text-sm text-gray-300">
          {initError ??
            (isConnecting ? "Connecting to persona…" : "Tap Join Call to connect the avatar.")}
        </div>
      )}
      <div className={CALL_PERSONA_VIDEO_FRAME_CLASS}>
        <video
          ref={videoRef}
          id={ANAM_PERSONA_VIDEO_ELEMENT_ID}
          className={CALL_PERSONA_VIDEO_CLASS}
          autoPlay
          playsInline
        />
        <div className={CALL_PERSONA_VIDEO_GRADIENT_CLASS} aria-hidden />
      </div>
    </div>
  );
});

Avatar.displayName = "Avatar";
