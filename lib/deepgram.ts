/**
 * deepgram.ts
 * Custom WebSocket client for Deepgram streaming STT.
 * Avoids the @deepgram/sdk npm package which has Node.js
 * dependencies that break in the browser.
 * Used by hooks/useProspectingVoice.ts.
 */

import {
  DEEPGRAM_LANGUAGE,
  DEEPGRAM_MODEL,
  ENDPOINTING_MS,
  UTTERANCE_END_MS,
} from "@/lib/constants";
import type { DeepgramConnection, DeepgramStreamOptions, DeepgramTranscriptMeta } from "@/types";

/** Default query params for browser streaming STT. */
export const DEEPGRAM_STREAM_DEFAULTS = {
  model: DEEPGRAM_MODEL,
  language: DEEPGRAM_LANGUAGE,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: UTTERANCE_END_MS,
  vad_events: true,
  endpointing: ENDPOINTING_MS,
} as const;

/**
 * Builds the Deepgram listen WebSocket URL with merged options.
 * @param apiKey - NEXT_PUBLIC_DEEPGRAM_API_KEY
 * @param options - Optional overrides for stream parameters
 */
function buildDeepgramListenUrl(apiKey: string, options: DeepgramStreamOptions): string {
  const merged = { ...DEEPGRAM_STREAM_DEFAULTS, ...options };
  const params = new URLSearchParams();
  params.set("model", merged.model);
  params.set("language", merged.language);
  if (merged.smart_format) params.set("smart_format", "true");
  if (merged.interim_results) params.set("interim_results", "true");
  if (merged.utterance_end_ms) params.set("utterance_end_ms", String(merged.utterance_end_ms));
  if (merged.vad_events) params.set("vad_events", "true");
  params.set("endpointing", String(merged.endpointing ?? ENDPOINTING_MS));
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

/**
 * Opens a browser WebSocket to Deepgram and returns a small connection API.
 * @param options - Optional Deepgram stream overrides
 * @returns DeepgramConnection for send/onTranscript/close
 */
export function createDeepgramConnection(options: DeepgramStreamOptions = {}): DeepgramConnection {
  const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY");
  }

  const ws = new WebSocket(buildDeepgramListenUrl(apiKey, options), ["token", apiKey]);

  let transcriptCallback: ((transcript: string, meta: DeepgramTranscriptMeta) => void) | null =
    null;
  let openCallback: (() => void) | null = null;
  let closeCallback: (() => void) | null = null;
  let errorCallback: ((error: Event) => void) | null = null;

  ws.onopen = () => {
    openCallback?.();
  };

  ws.onclose = () => {
    closeCallback?.();
  };

  ws.onerror = (event) => {
    errorCallback?.(event);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string) as {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      if (data.type === "Results") {
        const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";
        const meta: DeepgramTranscriptMeta = {
          isFinal: data.is_final === true,
          isSpeechFinal: data.speech_final === true,
        };
        if (transcript.trim().length > 0) {
          transcriptCallback?.(transcript, meta);
        }
      }
    } catch (parseError) {
      console.error("Deepgram message parse error:", parseError);
    }
  };

  return {
    send: (data: Blob | ArrayBuffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    close: () => {
      ws.close();
    },
    getReadyState: () => ws.readyState,
    onTranscript: (callback) => {
      transcriptCallback = callback;
    },
    onOpen: (callback) => {
      openCallback = callback;
      if (ws.readyState === WebSocket.OPEN) {
        callback();
      }
    },
    onClose: (callback) => {
      closeCallback = callback;
    },
    onError: (callback) => {
      errorCallback = callback;
    },
  };
}
