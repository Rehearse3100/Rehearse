# Simli Integration — Historical Reference

> **HISTORICAL — NOT CURRENT ARCHITECTURE**  
> Rehearse migrated Discovery and Objection Handling to **Anam** in August 2026. This document summarizes how the **old Simli-based system** worked, for reference or a possible future revert.  
> For the full pre-migration audit (with code citations), see [`simli-integration-audit.md`](./simli-integration-audit.md).  
> For post-migration cleanup notes, see [`in-call-and-simli-cleanup-audit.md`](./in-call-and-simli-cleanup-audit.md).

---

## What Simli Was

**Simli** was a WebRTC lip-sync video service. In Rehearse it was **not** the conversational brain — it was a **video layer only**.

Rehearse owned the full stack:

1. **Deepgram** — browser WebSocket STT from the student microphone  
2. **GPT-4o** — persona replies via `POST /api/chat`  
3. **ElevenLabs** — TTS via `POST /api/tts`  
4. **Local Web Audio** — student heard ElevenLabs output  
5. **Simli** — received decoded PCM16 audio for lip-sync; returned synced WebRTC **video**

Simli did **not** perform STT, LLM inference, or TTS in this integration.

---

## Audio-in / Video-out Architecture

```
Microphone → Deepgram STT
                ↓
         POST /api/chat (GPT-4o)
                ↓
         POST /api/tts (ElevenLabs)
                ↓
    ┌───────────┴───────────┐
    ↓                       ↓
Web Audio playback    Avatar.speakAudio()
(student hears TTS)         ↓
                      pcm-worker.js (PCM16)
                            ↓
                   SimliClient.sendAudioData()
                            ↓
                   WebRTC <video> (persona)
```

**Critical detail:** Simli's remote **audio** track was **muted** in the DOM. The app played ElevenLabs via Web Audio to avoid double playback. Simli's `<audio>` element existed only as a transport companion to the video stream.

Transcripts were built in `useSimulationVoiceSession` from **Deepgram finals** (student) and **GPT reply text** (persona) — not from Simli.

---

## simli-client Integration Pattern

**npm package:** `simli-client@^3.0.1`

**Client-side auth** (no server proxy):

1. `generateSimliSessionToken({ apiKey, config: { faceId, … } })` → `POST https://api.simli.ai/compose/token` with header `x-simli-api-key`
2. `generateIceServers(apiKey)` → `GET https://api.simli.ai/compose/ice`
3. `new SimliClient(sessionToken, videoEl, audioEl, iceServers, …, "livekit", "websockets", "wss://api.simli.ai")`
4. `await client.start()` — 15s connect timeout (`SIMLI_CONNECT_TIMEOUT_MS`)
5. During TTS playback: PCM chunks via `client.sendAudioData(pcmU8)`

**Avatar lifecycle:** `components/Avatar.tsx` exposed `AvatarRef` (`startSession`, `speakAudio`, `stopSpeaking`, etc.) consumed by `useSimulationVoiceSession`.

**Orchestrator:** `components/call/SimliCallStage.tsx` (later renamed to `AvatarCallStage.tsx` for Anam) managed lobby → connect → active → score for legacy `SimulationRunner` Discovery/Objections paths.

---

## face_id Concept

Simli identified avatars by a **face ID** string.

| Source | Purpose |
|--------|---------|
| `simulations.simli_face_id` (DB column) | Per-simulation override, passed as `faceId` to `Avatar` |
| `NEXT_PUBLIC_SIMLI_FACE_ID` env | Fallback when DB field was empty |
| Resolution | `faceId?.trim() \|\| SIMLI_FACE_ID` in `Avatar.tsx` |

**Tempo default simulation** seeded `simli_face_id` as `''`; both Dana and Dr. Kim shared the **same** face ID (persona switching was via GPT system prompts only, not different Simli faces).

Teachers configured face IDs via `SimulationForm` / professor Sidebar ("Simli Face ID" field).

---

## Environment Variables (Historical)

| Variable | Where used |
|----------|------------|
| `NEXT_PUBLIC_SIMLI_API_KEY` | Browser — Simli token + ICE requests in `Avatar.startSession()` |
| `NEXT_PUBLIC_SIMLI_FACE_ID` | `lib/constants.ts` → `SIMLI_FACE_ID` fallback |

These were **public** (browser-exposed) keys. Remove from Vercel/hosting env when fully decommissioning Simli.

---

## Related Constants (Historical)

Defined in `lib/constants.ts` before Anam migration:

| Constant | Value | Purpose |
|----------|-------|---------|
| `SIMLI_CONNECT_TIMEOUT_MS` | 15000 | WebRTC connect timeout |
| `SIMLI_MAX_SESSION_LENGTH_SEC` | 3600 | Token config |
| `SIMLI_MAX_IDLE_TIME_SEC` | 300 | Token config |
| `SIMLI_FACE_ID` | env fallback | Default avatar face |
| `SIMLI_VIDEO_STAGES` | `["discovery", "objections"]` | Stages with camera + avatar |

---

## Database

`public.simulations.simli_face_id` (`text NOT NULL DEFAULT ''`) stored the per-simulation Simli face ID.

Post-Anam migration, avatar/voice configuration moved to JSONB columns:

- `anam_avatar_ids` — e.g. `{"discovery":"…","objections":"…"}`
- `anam_voice_ids` — e.g. `{"discovery":"…","objections":"…"}`

The `simli_face_id` column may still exist in the database as an unused legacy field until a future migration drops it.

---

## Supporting Files (Still in Repo)

These files supported the old pipeline and remain for **other stages** (e.g. Prospecting phone calls) or historical reference:

- `lib/deepgram.ts` — Deepgram WebSocket STT  
- `lib/elevenLabsTimings.ts` — TTS alignment metadata (unused by Simli lip-sync path)  
- `lib/audio.ts` — audio utilities  
- `public/pcm-worker.js` — PCM16 conversion for Simli `sendAudioData`  
- `app/api/tts/` — ElevenLabs TTS route  

---

## What Replaced Simli (Current System)

As of the Anam migration:

- **Anam** handles STT, TTS, and avatar video via `@anam-ai/js-sdk`
- **GPT-4o** remains the brain via `/api/chat` (unchanged)
- Session tokens minted server-side at `POST /api/student/anam-session` using `ANAM_API_KEY`
- Per-stage avatar/voice IDs from `simulations.anam_avatar_ids` / `anam_voice_ids`

See `components/Avatar.tsx` and `hooks/useSimulationVoiceSession.ts` for the current implementation.

---

## Revert Checklist (If Ever Needed)

1. Restore `simli-client` dependency and `NEXT_PUBLIC_SIMLI_*` env vars  
2. Revert `Avatar.tsx` to Simli WebRTC + PCM upload path  
3. Revert `useSimulationVoiceSession.ts` to Deepgram + ElevenLabs orchestration for video stages  
4. Re-enable teacher `simli_face_id` configuration  
5. Consult [`simli-integration-audit.md`](./simli-integration-audit.md) for file-level detail and code citations from the pre-migration codebase
