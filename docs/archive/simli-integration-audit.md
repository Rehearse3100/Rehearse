# Simli Integration Audit (Discovery & Objection Handling)

**Date:** 2026-08-28  
**Scope:** Read-only audit of the current Simli avatar integration for live Discovery and Objection Handling call flows (Tempo default simulation and legacy `SimliCallStage` paths).  
**Purpose:** Document the end-to-end audio/video pipeline before a planned Anam migration.

---

## Executive summary

Rehearse owns the full conversational stack: **Deepgram STT → GPT-4o (`/api/chat`) → ElevenLabs TTS (`/api/tts`) → local Web Audio playback**. **Simli is a lip-sync video layer only.** The app sends **already-synthesized ElevenLabs audio** (decoded to PCM16) into Simli via `SimliClient.sendAudioData()`; Simli returns a **synced WebRTC video stream** (and a remote audio track that the app **mutes**). Simli does **not** perform STT, LLM inference, or TTS in this integration.

Transcripts are captured entirely in `useSimulationVoiceSession` from **Deepgram final transcripts** (student) and **GPT reply text** (persona)—not from Simli.

---

## 1. Full pipeline map

### Plain-language flow

For both Discovery and Objection Handling, the live call follows the same core voice pipeline:

1. **Microphone** → `MediaRecorder` chunks → **Deepgram WebSocket** (browser, `lib/deepgram.ts`).
2. Final student utterances → **`POST /api/chat`** with a assembled system prompt → **GPT-4o** reply text.
3. Reply text → **`POST /api/tts`** → **ElevenLabs** returns base64 audio.
4. **Student hears audio** via `playBase64Speech()` (Web Audio API, `lib/audio-playback.ts`).
5. **In parallel**, the same ElevenLabs buffer is decoded in `Avatar.speakAudio()`, converted to PCM16 in `pcm-worker.js`, and pushed to Simli via `client.sendAudioData()` for **lip-sync video**.
6. **Simli WebRTC** renders the persona on an `<video>` element; Simli's `<audio>` element is muted to avoid double playback.

Simli enters **after** TTS synthesis, as a **video/lip-sync consumer of PCM audio**. It does not call OpenAI, ElevenLabs, or Deepgram.

### STT — Deepgram (browser)

`useSimulationVoiceSession` opens a Deepgram connection and pipes `MediaRecorder` blobs to it:

```323:337:hooks/useSimulationVoiceSession.ts
        const connection = createDeepgramConnection({
          endpointing: SIMULATION_VOICE_ENDPOINTING_MS,
          utterance_end_ms: SIMULATION_VOICE_UTTERANCE_END_MS,
        });
        deepgramConnectionRef.current = connection;

        const mimeType = pickMediaRecorderMimeType();
        const mediaRecorder = mimeType
          ? new MediaRecorder(audioStream, { mimeType })
          : new MediaRecorder(audioStream);

        mediaRecorder.ondataavailable = (event: BlobEvent): void => {
          if (configRef.current.isMutedRef?.current) return;
          if (event.data.size > 0) connection.send(event.data);
        };
```

`createDeepgramConnection` in `lib/deepgram.ts` opens a browser WebSocket to `wss://api.deepgram.com/v1/listen` using `NEXT_PUBLIC_DEEPGRAM_API_KEY`:

```51:57:lib/deepgram.ts
export function createDeepgramConnection(options: DeepgramStreamOptions = {}): DeepgramConnection {
  const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY");
  }

  const ws = new WebSocket(buildDeepgramListenUrl(apiKey, options), ["token", apiKey]);
```

Transcript callbacks feed an utterance buffer; committed sentences invoke `handleUserSentence`.

### LLM — GPT-4o via `/api/chat`

On each committed student utterance, the hook builds the system prompt and calls `/api/chat`:

```236:248:hooks/useSimulationVoiceSession.ts
        const systemPrompt = buildVoiceSystemPrompt(
          configRef.current.systemPrompt,
          configRef.current.stageHint
        );
        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: prior,
            newMessage: trimmed,
            systemPrompt,
          }),
        });
```

`buildVoiceSystemPrompt` (`lib/persona-voice.ts`) concatenates the persona prompt, listening rules, and optional stage hint:

```13:18:lib/persona-voice.ts
export function buildVoiceSystemPrompt(basePrompt: string, stageHint?: string): string {
  const parts = [basePrompt.trim(), PERSONA_LISTENING_RULES];
  if (stageHint?.trim()) {
    parts.push(stageHint.trim());
  }
  return parts.join("\n\n");
}
```

The server route uses **GPT-4o** with the client-supplied `systemPrompt`:

```36:47:app/api/chat/route.ts
    const conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...prior.map((m) => ({ role: m.role, content: m.content }),
      { role: "user", content: newMessage },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: MAX_TOKENS,
      messages: conversationHistory,
    });
```

**Dana Reyes / Dr. Kim prompts** are wired at the call-session layer:

| Flow | System prompt source | Stage hint / greeting |
|------|---------------------|------------------------|
| Tempo Discovery | `DANA_REYES_SYSTEM_PROMPT` | `TEMPO_DISCOVERY_STAGE_HINT`, `TEMPO_DISCOVERY_OPENING_GREETING` |
| Tempo Objections | `DR_KIM_SYSTEM_PROMPT` | `TEMPO_OBJECTIONS_STAGE_HINT`, `TEMPO_OBJECTIONS_OPENING_GREETING` |
| Legacy `SimliCallStage` | `simulation.persona_system_prompt` (DB) | Per-stage `stageHint` / `openingGreeting` props |

Tempo Discovery example:

```87:92:components/tempo/stages/DiscoveryCallSession.tsx
  const voice = useSimulationVoiceSession({
    systemPrompt: DANA_REYES_SYSTEM_PROMPT,
    stageHint: TEMPO_DISCOVERY_STAGE_HINT,
    openingGreeting: TEMPO_DISCOVERY_OPENING_GREETING,
    isMutedRef,
  });
```

Tempo Objections example:

```99:104:components/tempo/stages/ObjectionHandlingCallSession.tsx
  const voice = useSimulationVoiceSession({
    systemPrompt: DR_KIM_SYSTEM_PROMPT,
    stageHint: TEMPO_OBJECTIONS_STAGE_HINT,
    openingGreeting: TEMPO_OBJECTIONS_OPENING_GREETING,
    isMutedRef,
  });
```

Prompt constants live in `lib/constants.ts` (e.g. `DANA_REYES_SYSTEM_PROMPT` lines 207–232, `DR_KIM_SYSTEM_PROMPT` lines 240–264).

### TTS — ElevenLabs via `/api/tts`

After GPT returns `reply`, `speakFromApi` requests TTS:

```155:171:hooks/useSimulationVoiceSession.ts
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        // ...
        const data = (await ttsRes.json()) as TtsResponseBody;
        if (!data.audioBase64 || epoch !== playbackEpochRef.current) {
          throw new Error("TTS returned no audio — check ElevenLabs credits and ELEVENLABS_* env vars.");
        }
```

Server-side ElevenLabs call (`app/api/tts/route.ts`):

```69:86:app/api/tts/route.ts
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: trimmedText,
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: ELEVENLABS_STABILITY,
            similarity_boost: ELEVENLABS_SIMILARITY_BOOST,
          },
        }),
      }
    );
```

Uses server-only `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Alignment timings are computed via `lib/elevenLabsTimings.ts` but **are not consumed** by the Simli path (`speakFromApi` only uses `audioBase64`).

### Local playback (what the student hears)

```184:199:hooks/useSimulationVoiceSession.ts
        // Hear TTS locally (reliable). Simli still gets PCM for lip-sync; its
        // remote <audio> is muted in Avatar to avoid double playback.
        await resumePlaybackContext();
        const hearPromise = playBase64Speech(data.audioBase64);

        if (avatarRef.current && epoch === playbackEpochRef.current) {
          try {
            await avatarRef.current.speakAudio({ audio: buffer });
          } catch (simliErr) {
            console.error("[voice] Simli lip-sync failed:", simliErr);
          }
```

### Simli boundary — audio IN, video OUT

**Input to Simli:** PCM16 chunks via `sendAudioData`, derived from ElevenLabs audio:

```447:479:components/Avatar.tsx
      speakAudio: async ({ audio }: SpeakAudioPayload): Promise<void> => {
        const client = simliRef.current;
        const worker = pcmWorkerRef.current;
        // ...
        const samples = await decodeToMonoFloat16k(arrayBuffer, ctx);
        // ...
          const pcmBuf = await convertFloatChunkInWorker(worker, slice);
          const pcmU8 = new Uint8Array(pcmBuf);

          sendPcmToSimli(client, pcmU8, () => speakAbortRef.current);
```

```140:151:components/Avatar.tsx
function sendPcmToSimli(
  client: SimliClient,
  pcmU8: Uint8Array,
  shouldAbort: () => boolean
): void {
  for (let i = 0; i < pcmU8.length; i += PCM_CHUNK_SIZE) {
    if (shouldAbort()) {
      return;
    }
    const end = Math.min(i + PCM_CHUNK_SIZE, pcmU8.length);
    client.sendAudioData(pcmU8.subarray(i, end));
  }
}
```

**Output from Simli:** WebRTC media attached to DOM elements passed into `SimliClient` constructor (`video`, `audio`). Remote audio is explicitly muted; video is shown:

```168:177:components/Avatar.tsx
function kickMediaPlayback(video: HTMLVideoElement, audio: HTMLAudioElement | null): void {
  video.muted = true;
  void video.play().catch(() => {});
  if (audio) {
    // App plays ElevenLabs via Web Audio; Simli <audio> is lips-only accompaniment.
    // Keep muted so a working Simli remote track does not double the voice.
    audio.muted = true;
    audio.volume = 0;
    void audio.play().catch(() => {});
  }
}
```

```498:513:components/Avatar.tsx
      <div className={CALL_PERSONA_VIDEO_FRAME_CLASS}>
        <video
          ref={videoRef}
          className={CALL_PERSONA_VIDEO_CLASS}
          autoPlay
          playsInline
          muted
        />
        <div className={CALL_PERSONA_VIDEO_GRADIENT_CLASS} aria-hidden />
      </div>
      <audio
        ref={audioRef}
        className="absolute left-0 top-0 h-px w-px opacity-0"
        autoPlay
        playsInline
      />
```

**Confirmed:** Simli does not call TTS or STT in this app. The `simli-client` SDK exposes `sendAudioData` (upload PCM) and binds remote tracks to `<video>`/`<audio>`—no LLM or speech synthesis APIs in the integration path.

### End-to-end diagram

```
Student mic
    → MediaRecorder
    → Deepgram WS (STT)
    → utterance buffer
    → POST /api/chat (GPT-4o + persona system prompt)
    → reply text
    → POST /api/tts (ElevenLabs)
    → audioBase64
         ├→ playBase64Speech() ──────────→ student hears voice
         └→ Avatar.speakAudio()
                → decode → pcm-worker (PCM16)
                → SimliClient.sendAudioData()
                → WebRTC video track → <video> (lip sync)
```

---

## 2. File-by-file roles

### `components/call/SimliCallStage.tsx`

**Role:** Legacy/non-Tempo orchestrator for Simli video calls (Discovery and Objections in `SimulationRunner`). Manages phases: `lobby` → `connecting` → `active` → `scoring` → `scored`.

**Connections:**
- `useVideoCall` — camera/mic, PiP, timer, mute
- `useSimulationVoiceSession` — Deepgram/GPT/TTS/Simli lip-sync
- `Avatar` — Simli WebRTC (mounted once after Join, `mountSimli` flag)
- `CallLobby` / `CallLayout` / `EndCallModal` — UI shells
- On end: `getFullTranscript()` → `fetchStageScore` + `completeStage`

```99:104:components/call/SimliCallStage.tsx
  const voice = useSimulationVoiceSession({
    systemPrompt: simulation.persona_system_prompt,
    stageHint,
    openingGreeting,
    isMutedRef: videoCall.isMutedRef,
  });
```

```317:320:components/call/SimliCallStage.tsx
      {mountSimli && (
        <div className="absolute inset-0 z-0" style={{ "--call-video-dock-h": `${CALL_VIDEO_BOTTOM_DOCK_PX}px` } as React.CSSProperties}>
          <Avatar ref={voice.avatarRef} faceId={simulation.simli_face_id} />
```

### `components/call/CallLayout.tsx`

**Role:** In-call overlay UI on top of the Simli video: stage badge, live timer, status text, student PiP `<video>`, live transcript strip, mute/camera/subtitles/end controls.

Does not talk to Simli directly; receives transcript strings and callbacks from `SimliCallStage`.

```137:141:components/call/CallLayout.tsx
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-white"
      style={callStyle}
    >
```

Exports shared CSS class names used by `Avatar.tsx` (`CALL_PERSONA_VIDEO_CLASS`, etc.).

### `components/call/CallLobby.tsx`

**Role:** Pre-call waiting room: persona card, student camera preview, mic/camera toggles, **Join Call** button. No Simli connection yet—only `getUserMedia` via parent `useVideoCall`.

### `components/call/EndCallModal.tsx`

**Role:** Confirmation dialog before ending call and triggering scoring. Used by `SimliCallStage` (and `PhoneCallStage`).

### `components/Avatar.tsx`

**Role:** Simli WebRTC session lifecycle and lip-sync PCM upload. Exposes `AvatarRef` imperative API (`startSession`, `speakAudio`, `stopSpeaking`, etc.) consumed by `useSimulationVoiceSession`.

**Connections:**
- `simli-client`: `generateSimliSessionToken`, `generateIceServers`, `SimliClient`
- `public/pcm-worker.js`: Float32 → PCM16 conversion
- `lib/constants`: PCM chunk size, sample rate, timeouts, face ID fallback
- `CallLayout` CSS classes for video framing

### `hooks/useVideoCall.ts`

**Role:** Browser media for video-call stages. Splits **audio-only** stream (for Deepgram) from **video-only** stream (student PiP). Provides mute/camera toggles, call timer, `primeUserGesture()` for Safari autoplay, and `stopAllTracks()` on teardown.

**Not used by Tempo Discovery** (audio-only lobby). **Used by** Tempo Objections (via `ObjectionHandlingLobby`) and legacy `SimliCallStage`.

### `hooks/useSimulationVoiceSession.ts`

**Role:** Core voice pipeline for all Simli stages. Owns Deepgram, `/api/chat`, `/api/tts`, transcript accumulation, turn-taking (speak cooldown, utterance debounce), and `AvatarRef.speakAudio()` for lip sync.

**Note:** `hooks/useVoiceSession.ts` is referenced in comments elsewhere but is **not** imported by Simli call paths; Simli uses `useSimulationVoiceSession` exclusively.

### `lib/audio.ts`

**Role:** `pickMediaRecorderMimeType()` for Deepgram ingestion; `base64ToArrayBuffer()` for TTS decode (used by voice hook and Avatar).

### `lib/elevenLabsTimings.ts`

**Role:** Converts ElevenLabs alignment JSON to word/char timing arrays in `/api/tts`. **Not used** by `Avatar` or Simli lip-sync in the current integration (Simli is driven by raw PCM, not timing metadata).

### `lib/deepgram.ts`

**Role:** Browser-native Deepgram streaming STT WebSocket client (no `@deepgram/sdk` in browser bundle).

### `public/pcm-worker.js`

**Role:** Web Worker offloading Float32 → Int16 PCM conversion before `sendAudioData`:

```7:22:public/pcm-worker.js
self.onmessage = function (e) {
  var ab = e.data;
  if (!(ab instanceof ArrayBuffer)) {
    self.postMessage(null);
    return;
  }
  var input = new Float32Array(ab);
  var n = input.length;
  var out = new Int16Array(n);
  for (var i = 0; i < n; i++) {
    var v = Math.round(input[i] * 32767);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i] = v;
  }
  self.postMessage(out.buffer, [out.buffer]);
};
```

---

## 3. Simli-specific authentication

### API key — client-exposed

Simli authentication uses **`NEXT_PUBLIC_SIMLI_API_KEY`** read in the browser inside `Avatar.startSession()`:

```266:274:components/Avatar.tsx
      const apiKey = process.env.NEXT_PUBLIC_SIMLI_API_KEY;
      const resolvedFaceId = faceId?.trim() || SIMLI_FACE_ID;

      if (!apiKey || !resolvedFaceId) {
        setInitError(
          "Add NEXT_PUBLIC_SIMLI_API_KEY and a Simli face ID on this simulation (or NEXT_PUBLIC_SIMLI_FACE_ID in .env.local)."
        );
        return false;
      }
```

There is **no server-side proxy** for Simli auth in this codebase. The key is sent from the client to Simli's HTTP APIs.

### Session token exchange

1. `generateSimliSessionToken({ apiKey, config: { faceId, handleSilence, maxSessionLength, maxIdleTime } })` → `POST https://api.simli.ai/compose/token` with header `x-simli-api-key`.
2. Response provides `session_token` used to construct `SimliClient`.
3. `generateIceServers(apiKey)` → `GET https://api.simli.ai/compose/ice` (ICE servers for WebRTC; app uses **livekit** transport, so ICE may be less critical than token).

```278:306:components/Avatar.tsx
      const tokenRes = await generateSimliSessionToken({
        apiKey,
        config: {
          faceId: resolvedFaceId,
          handleSilence: true,
          maxSessionLength: SIMLI_MAX_SESSION_LENGTH_SEC,
          maxIdleTime: SIMLI_MAX_IDLE_TIME_SEC,
        },
      });
      // ...
      const iceServers = await generateIceServers(apiKey);

      const client = new SimliClient(
        sessionToken,
        video,
        audio,
        iceServers,
        LogLevel.ERROR,
        "livekit",
        "websockets",
        "wss://api.simli.ai"
      );
```

### `face_id` configuration

- **Per-simulation DB field:** `simulations.simli_face_id` (passed as `faceId` prop to `Avatar`).
- **Env fallback:** `NEXT_PUBLIC_SIMLI_FACE_ID` → `SIMLI_FACE_ID` in `lib/constants.ts`.
- **Resolution:** `faceId?.trim() || SIMLI_FACE_ID` in `Avatar.tsx`.

**Dana vs. Dr. Kim:** The Tempo default simulation seed stores **`simli_face_id` as empty string** (`''`). Both Discovery and Objection Handling receive the same `simulation.simli_face_id` from `app/student/simulation/[id]/page.tsx` and fall back to **`NEXT_PUBLIC_SIMLI_FACE_ID`**. There is **no separate face ID per persona** in code—persona switching is done via **GPT system prompts only**, not different Simli faces.

```81:81:components/tempo/stages/DiscoveryStage.tsx
  const faceId = simliFaceId?.trim() || SIMLI_FACE_ID;
```

```74:74:components/tempo/stages/ObjectionHandlingStage.tsx
  const faceId = simliFaceId?.trim() || SIMLI_FACE_ID;
```

Teachers can set `simli_face_id` per simulation via `SimulationForm` / Sidebar editor.

---

## 4. Where Discovery and Objection Handling differ

### Shared core

Both stages use:
- `useSimulationVoiceSession` (same STT / LLM / TTS / Simli lip-sync pipeline)
- `Avatar` + `simli-client`
- Same `faceId` source for Tempo (`simulation.simli_face_id` or env fallback)

### Tempo paths (primary for Rehearse Essentials)

| Aspect | Discovery | Objection Handling |
|--------|-----------|-------------------|
| Stage component | `components/tempo/stages/DiscoveryStage.tsx` | `components/tempo/stages/ObjectionHandlingStage.tsx` |
| Call session | `DiscoveryCallSession.tsx` | `ObjectionHandlingCallSession.tsx` |
| Lobby | `DiscoveryLobby.tsx` (audio only) | `ObjectionHandlingLobby.tsx` (audio + video) |
| System prompt | `DANA_REYES_SYSTEM_PROMPT` | `DR_KIM_SYSTEM_PROMPT` |
| Stage hint / greeting | `TEMPO_DISCOVERY_*` | `TEMPO_OBJECTIONS_*` |
| Student camera | No PiP in call UI | PiP + camera toggle |
| `useVideoCall` | Not used | Not used (lobby manages streams manually) |
| Post-call | `completeStage("discovery", …)` JSON payload | `completeStage("objections", …)` + objection tracker |
| Layout | `DiscoveryStageLayout` | `ObjectionHandlingStageLayout` + live objection chips |

### Legacy paths (`SimulationRunner`)

Both use the **same** `SimliCallStage` with different props (`components/stages/DiscoveryStage.tsx` vs `ObjectionsStage.tsx`): different `stageHint`, `openingGreeting`, `scoreStage`, and objections adds `scoreTranscriptExtra` (pitch text).

### Notable implementation difference (Tempo Objections)

`ObjectionHandlingCallSession` renders a **hidden** `Avatar` while connecting, then a **second** `Avatar` when `connected` is true (lines 348–360). `DiscoveryCallSession` keeps a **single** `Avatar` mount for the whole call (line 213). This may affect Simli session continuity on Objections; Discovery follows the documented "do not remount" pattern more strictly.

---

## 5. Transcript capture

Transcripts are **not** sourced from Simli. They are built in `useSimulationVoiceSession`:

```89:91:hooks/useSimulationVoiceSession.ts
  const appendTranscript = useCallback((speaker: string, text: string): void => {
    transcriptLinesRef.current.push(`${speaker}: ${text}`);
  }, []);
```

- **Student lines:** appended when Deepgram utterance is committed and `handleUserSentence` runs (`appendTranscript("Student", trimmed)`).
- **Persona lines:** appended from GPT `reply` text before TTS (`appendTranscript("Persona", text)` in `speakFromApi`).

```451:451:hooks/useSimulationVoiceSession.ts
    getFullTranscript: () => transcriptLinesRef.current.join("\n"),
```

### Where transcripts go

**Legacy `SimliCallStage`:** On end call → `getFullTranscript()` → `fetchStageScore` + `completeStage(attemptId, scoreStage, …, fullTranscript)` (stored in `stage_scores.transcript`).

**Tempo Discovery:** `DiscoveryCallSession` calls `getFullTranscript()` → `parseDiscoveryTranscript()` → parent `onEnded` → `completeStage` with JSON including `transcript` and `transcriptEntries`.

**Tempo Objections:** Same pattern via `parseObjectionTranscript()` and `deriveObjectionTracker()` for live chips; saved in `completeStage` payload.

Downstream consumers (badge detection, CRM fields, presentation summaries) read from **stored stage transcript JSON/text**, which originates from Deepgram + GPT text—not Simli.

---

## 6. WebRTC connection setup

### SDK

- Package: **`simli-client@^3.0.1`** (`package.json`)
- Imports: `SimliClient`, `generateSimliSessionToken`, `generateIceServers`, `LogLevel`

### Connection lifecycle

1. **User gesture:** Join Call → `avatar.startSession()` (must follow click for Safari/WebRTC).
2. **Token + ICE:** Client-side fetch to `api.simli.ai` with public API key.
3. **Client construct:** `new SimliClient(sessionToken, videoEl, audioEl, iceServers, …, "livekit", "websockets", "wss://api.simli.ai")`.
4. **Start:** `await client.start()` with 15s timeout (`SIMLI_CONNECT_TIMEOUT_MS`).
5. **Ack wait:** Listens for `ack` event or `POST_CONNECT_ACK_WAIT_MS` (300ms) before marking ready.
6. **During call:** PCM pushed via `sendAudioData`; video plays on `<video>`.
7. **Stop:** `client.stop()` on unmount/end; `ClearBuffer()` on interrupt (`stopSpeaking`).

```315:334:components/Avatar.tsx
      await withTimeout(
        client.start(),
        SIMLI_CONNECT_TIMEOUT_MS,
        `Simli did not connect within ${SIMLI_CONNECT_TIMEOUT_MS / 1000}s. ...`
      );
      // ...
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        client.on("ack", done);
        setTimeout(done, POST_CONNECT_ACK_WAIT_MS);
      });
```

### Reconnection / error handling

- **Avatar:** On connect failure, `stopSession()`, surface `initError`, return `false` from `startSession`. No automatic retry in app code.
- **simli-client SDK:** `SimliClient.start()` internally retries up to `MAX_RETRY_ATTEMPTS` (10), switches to `livekit` transport after 2 failures, 2s delay between attempts.
- **Runtime errors:** `client.on("error", …)` logs to console; no user-facing reconnect UI.

```220:228:components/Avatar.tsx
  const stopSession = useCallback(async (): Promise<void> => {
    setIsReady(false);
    isReadyRef.current = false;
    setIsConnecting(false);

    const client = simliRef.current;
    simliRef.current = null;
    await client?.stop().catch(() => {});
  }, []);
```

---

## 7. UI rendering

### Simli video

Rendered as a standard **HTML `<video>`** element inside `Avatar` (full-bleed, `object-cover` via `CALL_PERSONA_VIDEO_CLASS`). Not canvas-based. Simli remote audio uses a hidden **`<audio>`** element (muted).

### Surrounding UI

**Legacy `SimliCallStage` + `CallLayout`:**
- Full-screen persona video (background)
- Top: stage label, LIVE badge, status text, **timer**
- PiP: student camera (top-right)
- Bottom: transcript panel, **mute**, **camera**, **subtitles toggle**, **End call**
- Lobby: `CallLobby` two-column layout with Join Call

**Tempo Discovery (`DiscoveryCallSession`):**
- Avatar in aspect-video card
- Bottom overlay: Dana name/role, timer
- Floating control bar: mute, end call
- No student video PiP

**Tempo Objections (`ObjectionHandlingCallSession`):**
- Full-width avatar video with objection tracker chips at top
- Student PiP bottom-right
- Bottom bar: mic, camera, end call, timer

---

## 8. Environment variables / config

| Variable | Where read | Purpose |
|----------|------------|---------|
| `NEXT_PUBLIC_SIMLI_API_KEY` | `components/Avatar.tsx` | Simli token + ICE requests (browser) |
| `NEXT_PUBLIC_SIMLI_FACE_ID` | `lib/constants.ts` → `SIMLI_FACE_ID`; `Avatar.tsx` fallback | Default face when `simli_face_id` empty |
| `simulations.simli_face_id` | DB → page props → `Avatar faceId` | Per-simulation face override |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | `lib/deepgram.ts` | STT WebSocket (browser) |
| `OPENAI_API_KEY` | `app/api/chat/route.ts` | GPT-4o (server) |
| `ELEVENLABS_API_KEY` | `app/api/tts/route.ts` | TTS (server) |
| `ELEVENLABS_VOICE_ID` | `app/api/tts/route.ts` | ElevenLabs voice (server) |

**Simli-related constants** (`lib/constants.ts`):

| Constant | Value | Use |
|----------|-------|-----|
| `SIMLI_CONNECT_TIMEOUT_MS` | 15000 | Connect timeout |
| `POST_CONNECT_ACK_WAIT_MS` | 300 | Post-connect ack wait |
| `SIMLI_MAX_SESSION_LENGTH_SEC` | 3600 | Token config |
| `SIMLI_MAX_IDLE_TIME_SEC` | 300 | Token config |
| `PCM_CHUNK_SIZE` | 8192 | PCM upload chunk size |
| `SAMPLE_RATE_HZ` | 16000 | Decode/resample target |
| `SIMLI_VIDEO_STAGES` | `["discovery", "objections"]` | Stage classification |

**External URLs (hardcoded):**
- `https://api.simli.ai/compose/token`
- `https://api.simli.ai/compose/ice`
- `wss://api.simli.ai` (WebSocket signaling / LiveKit transport)

Documented in `.env.example` lines 11–13.

---

## Uncertainties / gaps

1. **Separate Dana vs. Kim Simli faces:** Not implemented in repo; both stages share one `simli_face_id` / env fallback unless changed manually in DB.
2. **ElevenLabs timings:** Returned by `/api/tts` but unused for Simli; lip sync is PCM-stream-based, not alignment-driven.
3. **Objection Handling Avatar double-mount:** May create two Simli sessions during connect→active transition; behavior should be validated at runtime.
4. **`simli-client` remote audio:** The SDK can play audio on `audioElement`; the app mutes it and uses ElevenLabs for audible output—intentional per comments in `Avatar.tsx`.

---

## Migration implications (informational)

Any Anam (or other avatar) replacement must preserve:
- `useSimulationVoiceSession` contract (Deepgram → chat → TTS unchanged)
- `AvatarRef` imperative API (`startSession`, `speakAudio`, `stopSpeaking`, …) OR update all call sessions in tandem
- Transcript capture via text layers (independent of avatar vendor)
- Client-side PCM or equivalent lip-sync input if video sync remains drive-by-audio

Simli-specific pieces to swap: `Avatar.tsx`, `simli-client` dependency, `NEXT_PUBLIC_SIMLI_*` env vars, and `simli_face_id` simulation field semantics.
