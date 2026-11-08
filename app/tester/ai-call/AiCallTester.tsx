/**
 * AiCallTester.tsx
 * The client half of the throwaway /tester/ai-call page (see page.tsx for how to remove
 * it). A text chat with the call brain, POST /api/chat with the same body the real call
 * sends ({ attemptId, persona, messages, newMessage }), and an optional Anam avatar for
 * tempo_discovery and tempo_objections.
 *
 * Self-contained on purpose: only React, Next.js and @anam-ai/js-sdk are imported. The
 * avatar part is a small copy of what the real call does (hooks/useSimulationVoiceSession.ts
 * and components/Avatar.tsx), not an import of it:
 * - POST /api/student/anam-session { attemptId, stage } for a session token;
 * - createClient(token), then streamToVideoElement(videoId, micStream) to start;
 * - MESSAGE_HISTORY_UPDATED whose last message is the user's = the spoken turn is final
 *   (each Anam message id is handled once);
 * - talk(reply) makes the avatar speak, once SESSION_READY has fired;
 * - stopStreaming() plus stopping the mic tracks to stop.
 * No opening greeting: the tester speaks or types first. No persona text lives here; the
 * server builds every prompt from the persona key.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnamEvent, MessageRole, createClient, type AnamClient, type Message } from "@anam-ai/js-sdk";

// ── Config ───

/** The persona keys POST /api/chat accepts for Tempo, and the Anam stage each has (if any). */
const PERSONAS = [
  { key: "tempo_discovery", label: "tempo_discovery (Dana)", anamStage: "discovery" },
  { key: "tempo_objections", label: "tempo_objections (Dr. Kim)", anamStage: "objections" },
  { key: "tempo_negotiation_a", label: "tempo_negotiation_a", anamStage: null },
  { key: "tempo_negotiation_b", label: "tempo_negotiation_b", anamStage: null },
] as const;

type PersonaKey = (typeof PERSONAS)[number]["key"];

/** The <video> the Anam SDK streams into (it looks the element up by id). */
const VIDEO_ELEMENT_ID = "tester-ai-call-video";

// ── Types ───

/** One history turn, as /api/chat reads it (user and assistant turns only). */
type ChatTurn = { role: "user" | "assistant"; content: string };

type TurnSource = "typed" | "spoken";

type TranscriptLine =
  | { id: number; kind: "user"; text: string; via: TurnSource }
  | { id: number; kind: "reply"; text: string; ms: number }
  | { id: number; kind: "error"; text: string; ms: number | null }
  | { id: number; kind: "note"; text: string };

/** Lines are added without an id; the component numbers them. */
type NewTranscriptLine =
  | { kind: "user"; text: string; via: TurnSource }
  | { kind: "reply"; text: string; ms: number }
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

// ── Helpers ───

function anamStageFor(persona: PersonaKey): "discovery" | "objections" | null {
  return PERSONAS.find((entry) => entry.key === persona)?.anamStage ?? null;
}

/** A string field of a JSON body, or null when the body isn't JSON or the field isn't a string. */
function readStringField(bodyText: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object") {
      const value = (parsed as Record<string, unknown>)[field];
      return typeof value === "string" ? value : null;
    }
  } catch {
    // Not JSON: the caller shows the body as-is.
  }
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

// ── Component ───

/**
 * The tester page body: inputs, transcript, text box and the avatar switch.
 */
export function AiCallTester({ initialAttemptId, simulationId, classId }: AiCallTesterProps): React.ReactElement {
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [persona, setPersona] = useState<PersonaKey>("tempo_discovery");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [avatarPhase, setAvatarPhase] = useState<AvatarPhase>("off");
  const [isSessionReady, setIsSessionReady] = useState(false);

  // Refs: the Anam callbacks and async turns read the latest values without re-subscribing.
  const attemptIdRef = useRef(attemptId);
  const personaRef = useRef<PersonaKey>(persona);
  const historyRef = useRef<ChatTurn[]>([]);
  const isBusyRef = useRef(false);
  /** Spoken turns that arrived while a reply was in flight; sent together next (as the real call does). */
  const pendingSpokenRef = useRef<string[]>([]);
  /** Bumped by Reset: replies to an older conversation are dropped. */
  const conversationEpochRef = useRef(0);
  const lineIdRef = useRef(0);
  const clientRef = useRef<AnamClient | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  /** Bumped on every avatar start and stop: a start that was overtaken stops itself. */
  const avatarRunRef = useRef(0);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  /** SESSION_READY has fired: the real call speaks only after it, so this page does too. */
  const isSessionReadyRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const sendTurnRef = useRef<(text: string, via: TurnSource) => Promise<void>>(async () => undefined);

  attemptIdRef.current = attemptId;
  personaRef.current = persona;

  const addLine = useCallback((line: NewTranscriptLine): void => {
    lineIdRef.current += 1;
    const id = lineIdRef.current;
    setLines((current) => [...current, { ...line, id }]);
  }, []);

  useEffect(() => {
    const box = transcriptRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [lines]);

  // ── Avatar: speak / stop ───

  /** Makes the avatar say the reply when it's streaming; a failure is shown as a note. */
  const speakReply = useCallback(
    async (reply: string): Promise<void> => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      if (!client.isStreaming() || !isSessionReadyRef.current) {
        addLine({ kind: "note", text: "Avatar session isn't ready yet: this reply wasn't spoken." });
        return;
      }
      try {
        await client.talk(reply);
      } catch (error) {
        addLine({ kind: "note", text: `Avatar couldn't speak this reply: ${errorText(error)}` });
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
    setAvatarPhase("off");
    setIsSessionReady(false);
  }, []);

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
   * One turn: POST /api/chat with the history so far and the new message, then show the
   * reply with its round-trip time (and speak it when the avatar is on). An error shows
   * the HTTP status and the body as-is; a failed turn isn't added to the history.
   */
  const sendTurn = useCallback(
    async (text: string, via: TurnSource): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      if (isBusyRef.current) {
        if (via === "spoken") {
          pendingSpokenRef.current.push(trimmed);
        }
        return;
      }

      isBusyRef.current = true;
      setIsBusy(true);
      const epoch = conversationEpochRef.current;
      const prior = historyRef.current;
      addLine({ kind: "user", text: trimmed, via });
      const startedAt = performance.now();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId: attemptIdRef.current.trim(),
            persona: personaRef.current,
            messages: prior,
            newMessage: trimmed,
          }),
        });
        const bodyText = await response.text();
        const ms = Math.round(performance.now() - startedAt);
        if (epoch !== conversationEpochRef.current) {
          return;
        }
        if (!response.ok) {
          addLine({ kind: "error", text: `HTTP ${response.status}\n${bodyText}`, ms });
          return;
        }
        const reply = readStringField(bodyText, "reply");
        if (reply === null) {
          addLine({ kind: "error", text: `HTTP ${response.status}, but no reply in the body:\n${bodyText}`, ms });
          return;
        }
        historyRef.current = [...prior, { role: "user", content: trimmed }, { role: "assistant", content: reply }];
        addLine({ kind: "reply", text: reply, ms });
        await speakReply(reply);
      } catch (error) {
        if (epoch === conversationEpochRef.current) {
          addLine({ kind: "error", text: `Request failed: ${errorText(error)}`, ms: Math.round(performance.now() - startedAt) });
        }
      } finally {
        // Reset already cleared the busy flag for an older conversation.
        if (epoch === conversationEpochRef.current) {
          isBusyRef.current = false;
          setIsBusy(false);
          flushPendingSpoken();
        }
      }
    },
    [addLine, speakReply, flushPendingSpoken]
  );

  sendTurnRef.current = sendTurn;

  // ── Avatar: start ───

  /**
   * Token → mic → Anam client → stream into the video element. Spoken turns arrive as
   * MESSAGE_HISTORY_UPDATED and go through sendTurn like typed ones.
   */
  const startAvatar = useCallback(async (): Promise<void> => {
    const stage = anamStageFor(personaRef.current);
    const attempt = attemptIdRef.current.trim();
    if (!stage) {
      return;
    }
    if (!attempt) {
      addLine({ kind: "note", text: "Enter an attempt id before turning the avatar on." });
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
      const sessionToken = readStringField(bodyText, "sessionToken")?.trim() ?? "";
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
        if (!last || last.role !== MessageRole.USER || processedMessageIdsRef.current.has(last.id)) {
          return;
        }
        processedMessageIdsRef.current.add(last.id);
        void sendTurnRef.current(last.content, "spoken");
      });
      client.addListener(AnamEvent.SESSION_READY, (): void => {
        if (clientRef.current === client) {
          isSessionReadyRef.current = true;
          setIsSessionReady(true);
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
  }, [addLine, stopAvatar]);

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

  const resetConversation = useCallback((): void => {
    conversationEpochRef.current += 1;
    historyRef.current = [];
    pendingSpokenRef.current = [];
    isBusyRef.current = false;
    setIsBusy(false);
    setLines([]);
    // The avatar stays on; just stop whatever it is saying.
    const client = clientRef.current;
    if (client?.isStreaming()) {
      try {
        client.interruptPersona();
      } catch {
        // Nothing was playing.
      }
    }
  }, []);

  const handlePersonaChange = (next: PersonaKey): void => {
    setPersona(next);
    personaRef.current = next;
    // Another persona is another conversation: don't send it this one's history.
    resetConversation();
  };

  const handleAvatarSwitch = (isOn: boolean): void => {
    if (isOn) {
      void startAvatar();
    } else {
      stopAvatar();
    }
  };

  const submitDraft = (): void => {
    if (isBusy || !draft.trim()) {
      return;
    }
    const text = draft;
    setDraft("");
    void sendTurn(text, "typed");
  };

  const stage = anamStageFor(persona);
  const isAvatarOn = avatarPhase !== "off";
  const avatarStatus: Record<AvatarPhase, string> = {
    off: stage ? "Avatar off." : "No avatar for this persona (text only).",
    token: "Getting a session token…",
    mic: "Asking for the microphone…",
    connecting: "Connecting the avatar…",
    live: isSessionReady ? "Avatar ready: speak or type." : "Streaming; waiting for the session to be ready…",
  };
  const simulationHref =
    simulationId && classId ? `/student/simulation/${encodeURIComponent(simulationId)}?classId=${encodeURIComponent(classId)}` : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-white p-4 text-sm text-gray-900">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">AI call tester</h1>
        <p className="text-gray-600">
          Tester-only page. Text goes to POST /api/chat; the avatar switch adds Anam voice and video. Nothing here is saved.
        </p>
      </header>

      <section className="grid gap-3 rounded border border-gray-300 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Attempt id</span>
          <input
            className="rounded border border-gray-300 px-2 py-1 font-mono disabled:bg-gray-100"
            value={attemptId}
            onChange={(event) => setAttemptId(event.target.value)}
            disabled={isAvatarOn}
            spellCheck={false}
            aria-describedby="attempt-hint"
          />
          <span id="attempt-hint" className="text-xs text-gray-600">
            In the simulation page&apos;s address, the value after attempt= (it&apos;s there once you continue an
            in-progress run from its start screen, or move to the next stage). It must be the signed-in student&apos;s
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
          <span className="text-xs text-gray-600">Changing it starts a new conversation. Turn the avatar off to change it.</span>
        </label>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isAvatarOn}
              onChange={(event) => handleAvatarSwitch(event.target.checked)}
              disabled={!stage}
            />
            <span className="font-semibold">Avatar and voice</span>
          </label>
          <span className="text-gray-600">{avatarStatus[avatarPhase]}</span>
          <button
            type="button"
            className="ml-auto rounded border border-gray-400 px-3 py-1 font-semibold hover:bg-gray-100"
            onClick={resetConversation}
          >
            Reset conversation
          </button>
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
        {lines.length === 0 ? <p className="text-gray-500">No turns yet. You speak or type first.</p> : null}
        {lines.map((line) => {
          if (line.kind === "user") {
            return (
              <div key={line.id} className="self-end rounded bg-blue-50 px-3 py-2">
                <div className="text-xs font-semibold text-blue-800">You ({line.via})</div>
                <div className="whitespace-pre-wrap">{line.text}</div>
              </div>
            );
          }
          if (line.kind === "reply") {
            return (
              <div key={line.id} className="self-start rounded bg-gray-100 px-3 py-2">
                <div className="text-xs font-semibold text-gray-700">{persona}</div>
                <div className="whitespace-pre-wrap">{line.text}</div>
                <div className="mt-1 text-xs text-gray-500">/api/chat round trip: {line.ms} ms</div>
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
          className="min-h-[3rem] flex-1 rounded border border-gray-300 px-2 py-1"
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
        />
        <button
          type="submit"
          className="rounded bg-blue-700 px-4 py-1 font-semibold text-white disabled:bg-gray-400"
          disabled={isBusy || !draft.trim()}
        >
          Send
        </button>
      </form>
    </main>
  );
}
