# Legacy (Non-Tempo) Simulation Path — Status Audit

**Date:** 2026-10-03  
**Scope:** Read-only audit of the `SimulationRunner` pipeline and its call stages. No code changes.

**Entry points traced:**

- `components/SimulationRunner.tsx`
- `components/stages/*` (legacy, not `components/tempo/stages/*`)
- `components/call/AvatarCallStage.tsx`
- `components/call/PhoneCallStage.tsx`
- `app/student/simulation/[id]/page.tsx` (fall-through to `SimulationRunner`)

---

## Executive summary

| Area | Status |
|------|--------|
| **Build / imports** | **Working** — no missing modules; `@/` imports resolve. |
| **Lead gen + presentation (text)** | **Working** — depends on `OPENAI_API_KEY` and `/api/score`. |
| **Prospecting + close (phone voice)** | **Partial** — Deepgram + ElevenLabs + GPT paths exist; needs env + browser mic. |
| **Discovery + objections (video)** | **Partial** — uses **Anam** (not Simli); needs `ANAM_API_KEY`, DB `anam_avatar_ids` / `anam_voice_ids`, camera/mic. |
| **Removed Simli stack** | **Not referenced** by legacy runner code; `simli_face_id` remains on DB/types only. |
| **`useVoiceSession`** | **Removed** — not imported anywhere in this path; stale comments only. |

---

## 1. Stale or removed references (SimulationRunner + legacy stages)

### Simli

- **Not used** in the legacy path. `SimliCallStage.tsx` and `simli-client` are **gone** from the repo.
- Legacy discovery/objections use `AvatarCallStage` → `Avatar` + `useSimulationVoiceSession` (**Anam**).
- `types/index.ts` still defines `Simulation.simli_face_id`; it is **not** read by `SimulationRunner`, legacy stages, or `Avatar.tsx` (no `faceId` prop).
- Docs and older audits may still describe Simli; runtime code does not.

### Deepgram

- **Still used** for voice-only stages via `PhoneCallStage` → `useProspectingVoice` → `lib/deepgram.ts`.
- Requires **`NEXT_PUBLIC_DEEPGRAM_API_KEY`** in the browser (WebSocket to Deepgram).
- Comments in `lib/deepgram.ts` and `lib/audio.ts` mention removed `useVoiceSession.ts`; **not** a runtime dependency.

### ElevenLabs

- **Still used** for prospecting/close TTS: `useProspectingVoice` → `POST /api/tts` → `app/api/tts/route.ts`.
- Server env: **`ELEVENLABS_API_KEY`**, **`ELEVENLABS_VOICE_ID`** (see `.env.example`).
- `lib/elevenLabsTimings.ts` is used by `/api/tts` only; lip-sync timings are **not** consumed by the phone path.

### `/api/tts`

- **Exists** at `app/api/tts/route.ts`. **Not** used by Anam video stages (Anam handles TTS on discovery/objections).

### `useVoiceSession`

- **No file** `hooks/useVoiceSession.ts` in the repo.
- Legacy path uses:
  - `hooks/useSimulationVoiceSession.ts` (Anam + `/api/chat`)
  - `hooks/useProspectingVoice.ts` (Deepgram + `/api/chat` + `/api/tts`)
- `components/CallControls.tsx` is **orphaned** (comment references `useVoiceSession`; **not** imported by `SimulationRunner` or call stages).

### `/api/chat`

- **Used** by both voice hooks above. Requires **`OPENAI_API_KEY`**.

### Other removed modules

- No imports of `SimliCallStage`, `simli-client`, or `useVoiceSession` from the traced legacy tree.
- **`RestartSimulationButton`** pulls in Tempo **localStorage clear helpers** (`lib/tempo-discovery`, `lib/tempo-negotiation`, etc.) and `lib/tempo-simulation` via `lib/simulation-restart.ts` — modules exist; behavior is shared with Tempo restart, not Simli.

### Env vars referenced by this path

| Variable | Where | Stage impact |
|----------|--------|----------------|
| `OPENAI_API_KEY` | `/api/chat`, `/api/score` | All scored stages |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | `lib/deepgram.ts` | Prospecting, close |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | `/api/tts` | Prospecting, close |
| `ANAM_API_KEY` | `/api/student/anam-session` | Discovery, objections |
| `TEMPO_TEST_BYPASS_GATES` | Student page (server only) | **Not** used when `SimulationRunner` renders (Tempo branches false) |

Legacy Simli env vars (`NEXT_PUBLIC_SIMLI_*`) are **not** in `.env.example` and **not** read by current `Avatar.tsx`.

---

## 2. AvatarCallStage and PhoneCallStage — Anam vs removed stack

### AvatarCallStage (discovery + objections)

- **Uses Anam**, not Simli.
- Flow: `useVideoCall({ withVideo: true })` + `useSimulationVoiceSession({ anamStage: "discovery" \| "objections" })` + `<Avatar ref={voice.avatarRef} />`.
- `Avatar` uses `@anam-ai/js-sdk`, mints tokens via **`POST /api/student/anam-session`** with `{ attemptId, stage }`.
- Persona speech: Anam `talk()` after **`POST /api/chat`** (custom LLM mode).
- Student speech: Anam STT → message history → hook processes user lines.

### PhoneCallStage (prospecting + close)

- **Does not use Anam or Simli.**
- Flow: `useVideoCall({ withVideo: false })` + `useProspectingVoice` → **Deepgram WebSocket** + **`/api/chat`** + **`/api/tts`** + `lib/audio-playback.ts` (Web Audio).

---

## 3. Runtime trace — non-Tempo simulation, stage by stage

### How the student page reaches SimulationRunner

File: `app/student/simulation/[id]/page.tsx`

1. Requires student session + `classId` query param; loads published simulation assigned to class.
2. Resumes or creates attempt (`current_stage` starts at **`lead_gen`**).
3. Computes `isTempoDefault = (classId === DEFAULT_CLASS_ID) && isTempoDefaultSimulation(id, title)` (ID match or title contains `"tempo"`).
4. If **not** Tempo, none of `showTempoProspectingWizard`, `showTempoDiscovery`, etc. are true → **`stageView = <SimulationRunner … />`**.
5. If **not** Tempo, page returns **`stageView` directly** (no `CrmAccess` wrapper). Tempo-only CRM overlay is skipped.

### SimulationRunner routing

- Reads `attempt.current_stage` and renders one legacy stage component.
- **Call stages** (`prospecting`, `discovery`, `objections`, `close`): content inside `CallContainer` + pipeline bar.
- **Non-call stages** (`lead_gen`, `presentation`): padded layout with header.
- On final advance from close, `handleSimulationComplete` → **`/student/simulation/{id}/complete?attempt={attemptId}`**.

### Stage 1 — `lead_gen` (`LeadGenStage`)

1. Student fills three textareas; submits.
2. `fetchStageScore({ stage: "lead_gen", studentAnswers, simulationContext })` → **`POST /api/score`**.
3. `completeStage(...)` → **`POST /api/student/complete-stage`** (student cookie auth).
4. UI shows score; advance → client sets stage to **`prospecting`** + `router.refresh()` (server attempt row updated by API).

**Likely failures:** missing `OPENAI_API_KEY`; network/auth on complete-stage.

### Stage 2 — `prospecting` (`ProspectingStage` → `PhoneCallStage`)

1. Lobby: mic permission via `useVideoCall` (audio only).
2. Join: `useProspectingVoice.startCall(audioStream)` — Deepgram WS + greeting via `/api/tts`.
3. Loop: Deepgram finals → debounce → `/api/chat` → `/api/tts` → local playback.
4. End call → `fetchStageScore` + `completeStage` for **`prospecting`** → advance to **`discovery`**.

**Likely failures:**

- Missing **`NEXT_PUBLIC_DEEPGRAM_API_KEY`** (throws at connection create).
- Missing ElevenLabs or OpenAI (TTS/chat errors in UI).
- Mic denied (`canJoin` false).

**Note:** `complete-stage` may log Tempo CRM auto-convert warnings if no `crm_leads` row; **legacy attempts still save scores** (non-fatal).

### Stage 3 — `discovery` (`DiscoveryStage` → `AvatarCallStage`)

1. Lobby: camera + mic (`useVideoCall` with video).
2. Join: mount `Avatar`, `avatar.startSession()` → **`/api/student/anam-session`**, Anam WebRTC.
3. `voice.startCall(audioStream)` — opening greeting via Anam TTS + `/api/chat` history.
4. End call → score with transcript → `completeStage("discovery")` → **`presentation`**.

**Likely failures:**

- Missing **`ANAM_API_KEY`** on server (token route 500).
- Empty **`simulations.anam_avatar_ids['discovery']`** / **`anam_voice_ids['discovery']`** (400 from anam-session) — **common for old simulations configured only for Simli**.
- Anam connect timeout (15s) — misconfigured IDs or network.
- Camera/mic blocked for video lobby.

### Stage 4 — `presentation` (`PresentationStage`)

1. Text pitch + discovery notes panel; min word count `PRESENTATION_MIN_WORDS`.
2. `fetchStageScore` with `pitchText` + discovery transcript → **`/api/score`**.
3. `completeStage("presentation")` → **`objections`**.

**Likely failures:** OpenAI/score API; empty discovery transcript still allows submit but weak scoring context.

### Stage 5 — `objections` (`ObjectionsStage` → `AvatarCallStage`)

Same as discovery with `anamStage: "objections"` and pitch injected into `stageHint` / `scoreTranscriptExtra`.

**Likely failures:** same Anam DB/env requirements for **`objections`** keys in `anam_avatar_ids` / `anam_voice_ids`.

### Stage 6 — `close` (`CloseStage` → `PhoneCallStage`)

Same phone stack as prospecting; scores **`close`**, then advance triggers **`handleSimulationComplete`** redirect.

**Likely failures:** Deepgram/ElevenLabs/OpenAI (same as prospecting).

### Results — `complete` page (legacy branch)

When simulation is **not** Tempo default, `app/student/simulation/[id]/complete/page.tsx` renders the **600-point legacy results table** + `StudentLeaderboard` (not `TempoSimulationResultsView`).

**Likely failures:** missing `attempt` query param; attempt not owned by student.

---

## 4. Dependency file list (do not delete)

Below is the **union** of:

1. All `@/` modules imported **transitively** from the nine legacy component entry files, and  
2. `@/` modules imported by **HTTP routes** invoked at runtime from that path, and  
3. `@/` modules for the **legacy results** page reached after close.

Tracing method: static `@/` import graph from repo root (TypeScript/TSX only).  
**Not listed:** `node_modules` (e.g. `@anam-ai/js-sdk`, `openai`, `next/*`), CSS, or SQL.

### 4.1 Components

```
components/Avatar.tsx
components/BackButton.tsx
components/ConfirmModal.tsx
components/ErrorBoundary.tsx
components/PipelineProgress.tsx
components/SimulationRunner.tsx
components/StageCard.tsx
components/StageScoreReveal.tsx
components/StageShell.tsx
components/StudentLeaderboard.tsx
components/call/AvatarCallStage.tsx
components/call/CallContainer.tsx
components/call/CallLayout.tsx
components/call/CallLobby.tsx
components/call/CallTranscript.tsx
components/call/EndCallModal.tsx
components/call/PhoneCallLayout.tsx
components/call/PhoneCallLobby.tsx
components/call/PhoneCallStage.tsx
components/professor/ProfessorSpinner.tsx
components/simulation/RestartSimulationButton.tsx
components/stages/CloseStage.tsx
components/stages/DiscoveryStage.tsx
components/stages/LeadGenStage.tsx
components/stages/ObjectionsStage.tsx
components/stages/PresentationStage.tsx
components/stages/ProspectingStage.tsx
components/tempo/AchievementProgress.tsx
components/tempo/TempoCompetencyBreakdown.tsx
components/tempo/TempoSimulationResultsView.tsx
components/ui/CallControlPill.tsx
components/ui/CallIcons.tsx
components/ui/MaterialIcon.tsx
components/ui/PersonaInitials.tsx
```

Note: Tempo result components appear only because `complete/page.tsx` imports `TempoSimulationResultsView` for the Tempo branch; the **legacy** results UI uses `PipelineProgress`, `StudentLeaderboard`, and score helpers. Keep them while `complete/page.tsx` is shared.

### 4.2 App routes

```
app/api/chat/route.ts
app/api/score/route.ts
app/api/student/anam-session/route.ts
app/api/student/complete-stage/route.ts
app/api/student/simulation/restart/route.ts
app/api/tts/route.ts
app/student/simulation/[id]/complete/page.tsx
```

Student session **loader** for starting the run (not imported by `SimulationRunner`, but required to reach it for non-Tempo classes):

```
app/student/simulation/[id]/page.tsx
```

### 4.3 Hooks

```
hooks/useAudioWaveform.ts
hooks/useProspectingVoice.ts
hooks/useSimulationVoiceSession.ts
hooks/useToast.tsx
hooks/useVideoCall.ts
```

### 4.4 Lib

```
lib/api-auth.ts
lib/attempt-actions.ts
lib/audio-playback.ts
lib/audio.ts
lib/constants.ts
lib/deepgram.ts
lib/elevenLabsTimings.ts
lib/grades.ts
lib/leaderboard.ts
lib/persona-voice.ts
lib/persona.ts
lib/score-display.ts
lib/scoring.ts
lib/simulation-restart.ts
lib/stages.ts
lib/string-similarity.ts
lib/student-session-crypto.ts
lib/student-session.ts
lib/supabase/server.ts
lib/tempo-anam-config.ts
lib/tempo-badges.ts
lib/tempo-discovery.ts
lib/tempo-icp-criteria.ts
lib/tempo-lead-conversion.ts
lib/tempo-negotiation.ts
lib/tempo-objections.ts
lib/tempo-presentation.ts
lib/tempo-prospecting.ts
lib/tempo-results.ts
lib/tempo-simulation.ts
lib/voice-utterance-buffer.ts
```

Tempo-named libs in §4.4 are pulled in by **`RestartSimulationButton`**, **`complete-stage`** (badges/CRM side effects), or **`complete/page.tsx`**, not by core stage UI alone.

### 4.5 Types

```
types/index.ts
```

### 4.6 Full sorted union (78 paths)

```
app/api/chat/route.ts
app/api/score/route.ts
app/api/student/anam-session/route.ts
app/api/student/complete-stage/route.ts
app/api/student/simulation/restart/route.ts
app/api/tts/route.ts
app/student/simulation/[id]/complete/page.tsx
components/Avatar.tsx
components/BackButton.tsx
components/ConfirmModal.tsx
components/ErrorBoundary.tsx
components/PipelineProgress.tsx
components/SimulationRunner.tsx
components/StageCard.tsx
components/StageScoreReveal.tsx
components/StageShell.tsx
components/StudentLeaderboard.tsx
components/call/AvatarCallStage.tsx
components/call/CallContainer.tsx
components/call/CallLayout.tsx
components/call/CallLobby.tsx
components/call/CallTranscript.tsx
components/call/EndCallModal.tsx
components/call/PhoneCallLayout.tsx
components/call/PhoneCallLobby.tsx
components/call/PhoneCallStage.tsx
components/professor/ProfessorSpinner.tsx
components/simulation/RestartSimulationButton.tsx
components/stages/CloseStage.tsx
components/stages/DiscoveryStage.tsx
components/stages/LeadGenStage.tsx
components/stages/ObjectionsStage.tsx
components/stages/PresentationStage.tsx
components/stages/ProspectingStage.tsx
components/tempo/AchievementProgress.tsx
components/tempo/TempoCompetencyBreakdown.tsx
components/tempo/TempoSimulationResultsView.tsx
components/ui/CallControlPill.tsx
components/ui/CallIcons.tsx
components/ui/MaterialIcon.tsx
components/ui/PersonaInitials.tsx
hooks/useAudioWaveform.ts
hooks/useProspectingVoice.ts
hooks/useSimulationVoiceSession.ts
hooks/useToast.tsx
hooks/useVideoCall.ts
lib/api-auth.ts
lib/attempt-actions.ts
lib/audio-playback.ts
lib/audio.ts
lib/constants.ts
lib/deepgram.ts
lib/elevenLabsTimings.ts
lib/grades.ts
lib/leaderboard.ts
lib/persona-voice.ts
lib/persona.ts
lib/score-display.ts
lib/scoring.ts
lib/simulation-restart.ts
lib/stages.ts
lib/string-similarity.ts
lib/student-session-crypto.ts
lib/student-session.ts
lib/supabase/server.ts
lib/tempo-anam-config.ts
lib/tempo-badges.ts
lib/tempo-discovery.ts
lib/tempo-icp-criteria.ts
lib/tempo-lead-conversion.ts
lib/tempo-negotiation.ts
lib/tempo-objections.ts
lib/tempo-presentation.ts
lib/tempo-prospecting.ts
lib/tempo-results.ts
lib/tempo-simulation.ts
lib/voice-utterance-buffer.ts
types/index.ts
```

### 4.7 Server loader-only (non-Tempo routing on `[id]/page.tsx`)

These are **not** imported by `SimulationRunner` but are required to **enter** the legacy run from the student URL:

- `app/student/simulation/[id]/page.tsx`
- `lib/attempt-progress.ts`
- Plus shared server/auth/Supabase modules already listed (`lib/student-session.ts`, `lib/supabase/server.ts`, `lib/constants.ts`, `lib/tempo-simulation.ts`, and Tempo parse helpers used only when `isTempoDefault` is true).

---

## 5. Operational checklist for a non-Tempo class simulation

1. Class has simulation assigned; student opens `?classId=…` (not default Tempo class **or** simulation title/ID not flagged as Tempo).
2. **OpenAI** configured for scoring and chat.
3. **Deepgram + ElevenLabs** for prospecting/close phone calls.
4. **Anam** server key + per-simulation **`anam_avatar_ids` / `anam_voice_ids`** for discovery and objections (migrating off Simli face IDs alone is insufficient).
5. Supabase tables: `attempts`, `stage_scores`, student session cookies for API routes.

---

## 6. Related docs (may be outdated on Simli)

- `docs/archive/simli-integration-audit.md` — pre-Anam Simli architecture.
- `docs/archive/simli-info.md` — historical reference.
- `docs/archive/in-call-and-simli-cleanup-audit.md` — cleanup notes; verify against this file for current Anam behavior.
