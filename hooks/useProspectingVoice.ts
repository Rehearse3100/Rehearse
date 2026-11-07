/**
 * useProspectingVoice.ts
 * Voice-only prospecting: Deepgram + GPT + ElevenLabs (no avatar video).
 * Audio services start only after Join Call; stream supplied by useVideoCall.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playBase64Speech, resumePlaybackContext, stopBase64Speech } from "@/lib/audio-playback";
import { pickMediaRecorderMimeType } from "@/lib/audio";
import { buildDefaultOpeningGreeting } from "@/lib/persona";
import {
  MEDIA_RECORDER_TIMESLICE_MS,
  POST_SPEAK_COOLDOWN_MS,
  VOICE_ENDPOINTING_MS,
  VOICE_UTTERANCE_END_MS,
} from "@/lib/constants";
import type { ChatPersona, LegacyChatStage } from "@/lib/chat-personas";
import { createDeepgramConnection } from "@/lib/deepgram";
import { createUtteranceBuffer } from "@/lib/voice-utterance-buffer";
import type { ChatMessage, TtsResponseBody } from "@/types";

export type ProspectingVoiceConfig = {
  /** The attempt this call is part of (/api/chat checks it is the student's). */
  attemptId: string;
  /** Who the persona is; /api/chat builds its system prompt from this key on the server. */
  persona: ChatPersona;
  /** For persona "simulation": the legacy call stage whose hint the server appends. */
  chatStage?: LegacyChatStage;
  openingGreeting?: string;
  personaName: string;
  isMutedRef?: React.MutableRefObject<boolean>;
};

export type ProspectingVoiceReturn = {
  isActive: boolean;
  statusText: string;
  userTranscripts: string;
  personaTranscripts: string;
  getFullTranscript: () => string;
  startCall: (audioStream: MediaStream) => Promise<void>;
  stopListening: () => void;
  endCall: () => void;
};

/**
 * Prospecting phone-call hook — plays TTS through Web Audio decode.
 */
export function useProspectingVoice(config: ProspectingVoiceConfig): ProspectingVoiceReturn {
  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [userTranscripts, setUserTranscripts] = useState("");
  const [personaTranscripts, setPersonaTranscripts] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const deepgramConnectionRef = useRef<ReturnType<typeof createDeepgramConnection> | null>(null);
  const utteranceBufferRef = useRef<ReturnType<typeof createUtteranceBuffer> | null>(null);
  const isSpeakingRef = useRef(false);
  const isProcessingUserRef = useRef(false);
  const canListenAfterRef = useRef(0);
  const playbackEpochRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const transcriptLinesRef = useRef<string[]>([]);
  const configRef = useRef(config);
  const isActiveRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const appendLine = useCallback((speaker: string, text: string): void => {
    transcriptLinesRef.current.push(`${speaker}: ${text}`);
  }, []);

  const canAcceptStudentSpeech = (): boolean => {
    return (
      !isSpeakingRef.current &&
      !isProcessingUserRef.current &&
      Date.now() >= canListenAfterRef.current
    );
  };

  const playTts = useCallback(
    async (text: string): Promise<void> => {
      setPersonaTranscripts(text);
      appendLine(configRef.current.personaName, text);
      isSpeakingRef.current = true;
      utteranceBufferRef.current?.cancel();
      const epoch = playbackEpochRef.current;

      try {
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (epoch !== playbackEpochRef.current) return;
        if (!ttsRes.ok) throw new Error("TTS failed");

        const data = (await ttsRes.json()) as TtsResponseBody;
        if (!data.audioBase64) {
          setStatusText("No audio returned from voice service.");
          return;
        }

        await playBase64Speech(data.audioBase64);
      } catch (err) {
        console.error(err);
        setStatusText(err instanceof Error ? err.message : "Voice playback failed.");
      } finally {
        if (epoch === playbackEpochRef.current) {
          isSpeakingRef.current = false;
          canListenAfterRef.current = Date.now() + POST_SPEAK_COOLDOWN_MS;
          if (isActiveRef.current) {
            setStatusText("Your turn — speak when ready.");
          }
        }
      }
    },
    [appendLine]
  );

  const handleUserSentence = useCallback(
    async (text: string): Promise<void> => {
      if (!canAcceptStudentSpeech()) return;

      isProcessingUserRef.current = true;
      setUserTranscripts(text);
      appendLine("Student", text);
      setStatusText("Thinking...");

      try {
        // The persona key only: the server builds the system prompt.
        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId: configRef.current.attemptId,
            persona: configRef.current.persona,
            stage: configRef.current.chatStage,
            messages: messagesRef.current,
            newMessage: text,
          }),
        });
        if (!chatRes.ok) throw new Error("Chat failed");
        const { reply } = (await chatRes.json()) as { reply: string };
        const next: ChatMessage[] = [
          ...messagesRef.current,
          { role: "user", content: text },
          { role: "assistant", content: reply },
        ];
        setMessages(next);
        messagesRef.current = next;
        await playTts(reply);
      } catch (err) {
        setStatusText(err instanceof Error ? err.message : "Chat error.");
      } finally {
        isProcessingUserRef.current = false;
      }
    },
    [playTts, appendLine]
  );

  const stopListening = useCallback((): void => {
    utteranceBufferRef.current?.cancel();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    deepgramConnectionRef.current?.close();
    deepgramConnectionRef.current = null;
    setIsActive(false);
  }, []);

  const startCall = useCallback(
    async (audioStream: MediaStream): Promise<void> => {
      if (audioStream.getAudioTracks().length === 0) {
        throw new Error("No microphone audio track available.");
      }
      try {
        await resumePlaybackContext();
        setIsActive(true);
        setStatusText(`Connected to ${configRef.current.personaName}`);
        setMessages([]);
        messagesRef.current = [];
        transcriptLinesRef.current = [];
        canListenAfterRef.current = Date.now() + POST_SPEAK_COOLDOWN_MS;

        utteranceBufferRef.current = createUtteranceBuffer({
          onLivePreview: (preview) => setUserTranscripts(preview),
          onCommit: (full) => void handleUserSentence(full),
        });

        const connection = createDeepgramConnection({
          endpointing: VOICE_ENDPOINTING_MS,
          utterance_end_ms: VOICE_UTTERANCE_END_MS,
        });
        deepgramConnectionRef.current = connection;

        const mimeType = pickMediaRecorderMimeType();
        const mediaRecorder = mimeType
          ? new MediaRecorder(audioStream, { mimeType })
          : new MediaRecorder(audioStream);

        mediaRecorder.ondataavailable = (e: BlobEvent): void => {
          if (configRef.current.isMutedRef?.current) return;
          if (e.data.size > 0) connection.send(e.data);
        };
        mediaRecorderRef.current = mediaRecorder;

        const greeting =
          configRef.current.openingGreeting ??
          buildDefaultOpeningGreeting(configRef.current.personaName);

        connection.onTranscript((sentence: string, meta): void => {
          if (!canAcceptStudentSpeech()) return;

          if (!meta.isFinal && !meta.isSpeechFinal) {
            setUserTranscripts(sentence);
            return;
          }

          if (meta.isFinal || meta.isSpeechFinal) {
            utteranceBufferRef.current?.pushFragment(sentence, meta.isSpeechFinal);
          }
        });

        connection.onError(() => {
          setStatusText("Speech service error — check Deepgram API key.");
        });

        connection.onOpen(() => {
          if (mediaRecorder.state === "inactive") {
            mediaRecorder.start(MEDIA_RECORDER_TIMESLICE_MS);
          }
          setStatusText("Connected — listen, then speak.");
          void playTts(greeting);
        });
      } catch (err) {
        setStatusText("Could not start call.");
        setIsActive(false);
        throw err;
      }
    },
    [handleUserSentence, playTts]
  );

  const endCall = useCallback((): void => {
    playbackEpochRef.current += 1;
    isSpeakingRef.current = false;
    isProcessingUserRef.current = false;
    stopBase64Speech();
    stopListening();
  }, [stopListening]);

  return {
    isActive,
    statusText,
    userTranscripts,
    personaTranscripts,
    getFullTranscript: () => transcriptLinesRef.current.join("\n"),
    startCall,
    stopListening,
    endCall,
  };
}
