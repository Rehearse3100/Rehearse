# In-Call UI & Simli Cleanup Audit (Post-Anam Migration)

**Date:** 2026-08-28  
**Scope:** Read-only audit of (1) active in-call UI for Tempo Discovery and Objection Handling, and (2) every remaining `simli` reference after the Anam migration.  
**Out of scope:** Pre-call lobby, post-call/summary screens, scoring flows.

---

## Part 1: In-Call Screen UI (Discovery + Objection Handling)

### 1. Components rendering the active call state

**Plain-language answer:** Tempo Discovery and Objection Handling use **different center-panel call components**, each wrapped by a **different 3-column stage layout**. The active call is shown when the parent stage sets `phase === "active"` (and the call session sets `connected === true`). A **legacy non-Tempo path** still exists via `SimliCallStage` + `CallLayout` for `SimulationRunner`; it is documented here for completeness but is not what Tempo students see.

| Flow | Parent orchestrator | Stage layout (side panels) | Active call center component |
|------|---------------------|----------------------------|------------------------------|
| **Tempo Discovery** | `components/tempo/stages/DiscoveryStage.tsx` | `components/tempo/stages/DiscoveryStageLayout.tsx` | `components/tempo/stages/DiscoveryCallSession.tsx` |
| **Tempo Objection Handling** | `components/tempo/stages/ObjectionHandlingStage.tsx` | `components/tempo/stages/ObjectionHandlingStageLayout.tsx` | `components/tempo/stages/ObjectionHandlingCallSession.tsx` |
| **Legacy SimulationRunner** | `components/stages/DiscoveryStage.tsx` / `ObjectionsStage.tsx` | *(none — full-screen call)* | `components/call/SimliCallStage.tsx` → `components/call/CallLayout.tsx` when `phase === "active"` |

Shared video/avatar primitive for all paths: `components/Avatar.tsx` (Anam WebRTC `<video>`).

**Evidence — Tempo mounts call session when phase is connecting or active:**

```229:244:components/tempo/stages/DiscoveryStage.tsx
            callSlot={
              (phase === "connecting" || phase === "active") && audioStream ? (
                <DiscoveryCallSession
                  attemptId={attemptId}
                  faceId={faceId}
                  audioStream={audioStream}
                  onActive={handleCallActive}
                  onError={handleCallError}
                  onTranscriptChange={setTranscript}
                  onSecondsChange={setCallSeconds}
                  onEnded={(text, seconds, entries) => {
                    void handleCallEnded(text, seconds, entries);
                  }}
                />
              ) : null
            }
```

**Evidence — active UI renders only when `connected` is true inside `DiscoveryCallSession`:**

```225:240:components/tempo/stages/DiscoveryCallSession.tsx
        {connected && (
          <>
            <div className="absolute bottom-4 left-4 z-10 rounded-lg bg-black/45 backdrop-blur-md px-3 py-2">
              <p className="text-white font-headline-md text-sm">Dana Reyes</p>
              <p className="text-white/60 font-label-sm text-[11px]">
                Director of Operations · Summit Dental
              </p>
            </div>
            <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 bg-black/45 backdrop-blur-md px-3 py-1.5 rounded-full">
              <MaterialIcon name="timer" className="text-white/70 text-[16px]" />
              <span className="font-code-md text-white/85 text-sm">
                {formatDiscoveryTime(seconds)}
              </span>
            </div>
          </>
        )}
```

---

### 2. What is visible during an active call

#### Tempo Discovery (phase `active`, `DiscoveryCallSession` `connected === true`)

**Center panel (`DiscoveryCallSession`):**
- **Persona video:** Anam stream on `<video id="anam-persona-video">` inside `Avatar`, full-bleed in a card (`max-w-xl`, `aspect-video`, `rounded-2xl`, `border border-white/15`, `bg-black`).
- **Persona label:** Bottom-left overlay — "Dana Reyes" + "Director of Operations · Summit Dental".
- **Call timer:** Bottom-right overlay on the video card (local timer in `DiscoveryCallSession`).
- **Status text:** Optional line below the video (`voice.statusText`, e.g. "Persona is greeting you…").
- **Controls:** Fixed bottom-center dock — mic toggle (`mic` / `mic_off`, red when muted) and red end-call button (`call_end`).
- **Recording notice:** Bottom-center fine print — "This call is being recorded for scoring purposes".
- **No student camera/PiP** in Discovery (audio-only call; lobby does not enable camera).
- **No inline live transcript/captions** in the center panel.

**Surrounding chrome (`DiscoveryStageLayout` + `DiscoveryTopBar`):**
- **Top bar:** `DiscoveryTopBar` → `TempoStageTopBar` (stage progress, simulation title, handoff/exit) — fixed above the 3-column layout (`pt-16`).
- **Left panel (lg+):** Mission briefing, Dana persona card, Discovery Tips, and (when `phase === "active"`) a duplicate **Call Duration** timer with target "15-20 minutes".
- **Right panel (lg+):** Collapsible "Reference: Tempo Product" + **Live Transcript** with red "LIVE" badge; transcript entries show speaker ("Dana Reyes" / "You"), timestamp, and content.

**Background/layout:** `fixed inset-0 z-[45] bg-surface` shell; center call area uses `bg-[#0a0a0a]`.

#### Tempo Objection Handling (phase `active`, `ObjectionHandlingCallSession` `connected === true`)

**Center panel (`ObjectionHandlingCallSession`):**
- **Objection tracker chips (top):** Three pills — Price, Adoption, Status Quo — with state styling (unraised / raised-amber / handled-green) and pulse dot when raised.
- **Persona video:** Anam `Avatar` in a larger frame (`max-w-4xl`, `aspect-video`, `max-h-[min(56vh,…)]`, `rounded-3xl`). Gold `speaking-ring-gold` border when Dr. Kim is speaking.
- **Persona label:** Bottom-left `glass-panel` — "Dr. Saul Kim" / "Founder & Owner".
- **Student PiP:** Bottom-right `w-48 aspect-video` muted `<video>` (mirrored `scale-x-[-1]`), blue `speaking-ring-blue` when student speaks; placeholder person icon when camera off.
- **Controls (bottom dock):** Mic, camera, end-call (wider red pill), and timer — all in a `border-t border-white/10 bg-black/30 backdrop-blur-md` bar. Controls disabled until `connected`.
- **No inline caption strip** in the center; transcript lives in the right panel.

**Surrounding chrome (`ObjectionHandlingStageLayout` + `ObjectionHandlingTopBar`):**
- **Left panel (lg+):** Mission briefing, Dr. Kim card, "Mission Critical" warning, Objection Tips, "NO AI ASSISTANCE" badge, Call Duration when active.
- **Right panel (lg+):** Tabbed **Transcript** / **Playbook**. During active call: live transcript (chat-bubble layout), red "LIVE" badge, and a **Strategy Hint** box at the bottom that changes based on objection tracker state.

**Background/layout:** Same `fixed inset-0 z-[45] bg-surface` shell; center uses `bg-[#0a0a0a]`.

#### Legacy path (`SimliCallStage` `phase === "active"`)

Uses `CallLayout` overlay on full-bleed `Avatar`: stage badge + "Live" pill, timer top-right, student PiP top-right, bottom transcript strip (toggleable via subtitles button), mic/camera/subtitles/end controls. **Not used by Tempo** but still reachable via `components/stages/DiscoveryStage.tsx` and `ObjectionsStage.tsx`.

**Evidence — `Avatar` video element (shared by all paths):**

```500:508:components/Avatar.tsx
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
```

**Evidence — Anam video is NOT muted (old Simli dual-audio workaround removed):**

```196:196:components/Avatar.tsx
  video.muted = false;
```

---

### 3. Do Discovery and Objection Handling share the same in-call layout?

**No — they use meaningfully different center call components and differ in several UI features.**

| Aspect | Discovery | Objection Handling |
|--------|-----------|-------------------|
| Center component | `DiscoveryCallSession` | `ObjectionHandlingCallSession` |
| Stage layout | `DiscoveryStageLayout` | `ObjectionHandlingStageLayout` |
| Video frame size | `max-w-xl` | `max-w-4xl` |
| Student camera/PiP | None | Yes (bottom-right) |
| Objection tracker chips | No | Yes (top center) |
| Speaking indicators | No | Gold/blue rings on persona/PiP |
| Camera control | No | Yes |
| Right panel | Reference + transcript | Transcript/Playbook tabs + strategy hint |
| Control dock position | Floating absolute bottom-center | Fixed bottom bar with border |

They **do** share the same architectural pattern: parent stage → 3-column layout → `callSlot` injects a `*CallSession` component that owns `Avatar` + `useSimulationVoiceSession`. Both keep a **single `Avatar` mount** for the whole call (connecting through active).

**Evidence — different components, same single-mount pattern:**

```210:211:components/tempo/stages/DiscoveryCallSession.tsx
        {/* Single Avatar mount for the whole call — do not remount when connected flips. */}
        <Avatar ref={voice.avatarRef} faceId={faceId} />
```

```348:351:components/tempo/stages/ObjectionHandlingCallSession.tsx
          {/* Single Avatar mount for the whole call — do not remount when connected flips. */}
          <div className="absolute inset-0">
            <Avatar ref={voice.avatarRef} faceId={faceId} />
          </div>
```

Neither Tempo stage uses `CallLayout.tsx` or `SimliCallStage.tsx`.

---

### 4. Leftover / stale Simli-era elements in the in-call UI

These are **naming/comment/prop leftovers** — no Simli SDK calls remain in the active Tempo call path, but several strings and props still reference Simli:

| Location | Stale item | Notes |
|----------|-----------|-------|
| `DiscoveryCallSession.tsx` file header | "Audio **Simli** voice call", "tears down the **Simli** WebRTC session" | Comments only; code uses Anam |
| `ObjectionHandlingStage.tsx` file header | "live **Simli** video call" | Comment only; `ObjectionHandlingCallSession` header correctly says "Anam" |
| `DiscoveryStage.tsx` / `ObjectionHandlingStage.tsx` | `simliFaceId` prop, `SIMLI_FACE_ID` fallback, `faceId` passed to `Avatar` | `faceId` is **deprecated** on `Avatar` — Anam IDs come from `/api/student/anam-session` |
| `Avatar.tsx` | Imports `SIMLI_CONNECT_TIMEOUT_MS` for Anam timeouts | Constant name is Simli-branded but used for Anam |
| `SimliCallStage.tsx` | File name, type `SimliCallStageProps`, comment "Simli-powered" | **Runtime code is Anam** — uses `mountAvatar`, no `simli-client` import |
| `CallLayout.tsx` | Comment "Active **Simli** video-call overlay" | Shared CSS class exports used by Anam `Avatar`; overlay only used by legacy path |
| `lib/constants.ts` | `SIMLI_*` constants, `SIMLI_VIDEO_STAGES` | Several constants appear **unused** in runtime code after migration (`SIMLI_MAX_SESSION_LENGTH_SEC`, `SIMLI_MAX_IDLE_TIME_SEC`, `SIMLI_VIDEO_STAGES` — defined only in `lib/constants.ts`) |

**No Simli-branded loading/error strings** were found in the Tempo active-call UI (connecting overlays say "Connecting to Dana Reyes…" / "Connecting to Dr. Saul Kim…"). The old muted-audio-track workaround is gone (`video.muted = false` in `Avatar.tsx`).

---

### 5. Design tokens and styling (in-call screens)

**CSS utility classes (global):**
- `call-persona-video-frame`, `call-persona-video`, `call-persona-video-gradient` — full-bleed persona video with vignette (`app/globals.css` lines 287–300)
- `speaking-ring-gold`, `speaking-ring-blue` — animated speaking borders (`app/globals.css`)
- `glass-panel` — frosted control surfaces (`app/globals.css`)
- `tempo-pulse-green` — availability indicator pulse in side panels

**Tailwind / semantic tokens used on in-call UI:**
- Backgrounds: `bg-[#0a0a0a]`, `bg-surface`, `bg-primary-container`, `bg-surface-container-low`, `bg-call-background` (legacy)
- Text: `font-headline-md`, `font-label-sm`, `font-body-md`, `font-code-md`, `font-code-lg`, `text-on-primary`, `text-on-surface-variant`, `text-tertiary-fixed`
- Colors: `bg-error` / `text-error` (mute/end call), `bg-tertiary-container` (spinner accent), `border-white/10`, `border-white/15`
- Effects: `backdrop-blur-md`, `backdrop-blur-xl`, `backdrop-blur-lg`, `shadow-2xl`
- Layout: `rounded-2xl`, `rounded-3xl`, `rounded-full`, `aspect-video`, `max-w-xl` (Discovery) vs `max-w-4xl` (Objections)
- Icons: `MaterialIcon` (mic, videocam, timer, call_end, etc.)

**Exported layout constants from `CallLayout.tsx`** (used by `Avatar`, legacy `SimliCallStage`):
- `CALL_PERSONA_VIDEO_FRAME_CLASS`, `CALL_PERSONA_VIDEO_CLASS`, `CALL_PERSONA_VIDEO_GRADIENT_CLASS`
- `CALL_VIDEO_BOTTOM_DOCK_PX` (0 — full-bleed video)

---

## Part 2: Remaining Simli References (Post-Anam Migration)

### 1. Full codebase search for `simli` (case-insensitive)

Below is every match outside `node_modules` as of this audit. Line numbers refer to the current workspace.

#### Environment & dependencies

| File | Line(s) | Match |
|------|---------|-------|
| `.env.example` | 11–13 | `# Simli (browser WebRTC)`, `NEXT_PUBLIC_SIMLI_API_KEY=`, `NEXT_PUBLIC_SIMLI_FACE_ID=` |
| `package.json` | 21 | `"simli-client": "^3.0.1"` |
| `package-lock.json` | 20, 4912, 4914 | `simli-client` dependency entries |

#### Runtime source (TypeScript/TSX)

| File | Line(s) | Match |
|------|---------|-------|
| `components/Avatar.tsx` | 25, 257, 326–327, 396, 439–440, 459 | `SIMLI_CONNECT_TIMEOUT_MS` (used for Anam timeouts) |
| `components/call/CallLayout.tsx` | 3 | Comment: "Active Simli video-call overlay" |
| `components/call/SimliCallStage.tsx` | 2, 26, 64–66, 79 | File name, `SimliCallStageProps`, comment "Simli-powered", export `SimliCallStage` |
| `components/call/PhoneCallStage.tsx` | 3 | Comment: "no Simli" |
| `components/SimulationForm.tsx` | 33, 42, 56, 141, 143–144 | `simliFaceId` state, `simli_face_id` field, "Simli face ID" placeholder |
| `components/shared/Sidebar.tsx` | 30, 1290–1291, 1307, 1322, 1465, 1469, 1471, 1474 | `SIMLI_FACE_ID`, `simliFaceId`, "Simli Face ID" label/placeholder |
| `components/stages/DiscoveryStage.tsx` | 3, 8, 28 | Comment "Simli video-call", import/usage of `SimliCallStage` |
| `components/stages/ObjectionsStage.tsx` | 3, 8, 31 | Comment "Simli video-call", import/usage of `SimliCallStage` |
| `components/stages/ProspectingStage.tsx` | 3 | Comment: "no Simli" |
| `components/tempo/stages/DiscoveryCallSession.tsx` | 3, 9 | Comments: "Simli voice call", "Simli WebRTC session" |
| `components/tempo/stages/DiscoveryStage.tsx` | 23, 43, 58, 81 | `SIMLI_FACE_ID`, `simliFaceId` prop |
| `components/tempo/stages/ObjectionHandlingStage.tsx` | 3, 26, 45, 57, 74 | Comment "Simli video call", `SIMLI_FACE_ID`, `simliFaceId` |
| `hooks/useProspectingVoice.ts` | 3 | Comment: "no Simli" |
| `lib/constants.ts` | 3, 8, 29, 46, 48–49, 52–53, 55–56, 106–107, 109, 186 | Section headers and `SIMLI_*` exports |
| `lib/student-class-data.ts` | 143 | SQL select includes `simli_face_id` |
| `types/index.ts` | 45, 165 | `simli_face_id` on `Simulation`; AvatarRef comment "Starts Simli WebRTC" |
| `app/student/simulation/[id]/page.tsx` | 269, 292 | `simliFaceId={simulation.simli_face_id}` |

#### Database / SQL

| File | Line(s) | Match |
|------|---------|-------|
| `supabase/archive/schema.sql` | 21 | `simli_face_id text not null` |
| `supabase/FULL-SETUP.sql` | 51, 410 | `simli_face_id` column and seed |
| `supabase/default-class-migration.sql` | 70 | `simli_face_id` in insert |
| `supabase/archive/tempo-simulation-seed.sql` | 19 | `simli_face_id` in insert |

#### Documentation

| File | Notes |
|------|-------|
| `docs/simli-integration-audit.md` | Entire pre-migration audit (~675 lines) |
| `docs/structure-audit.md` | Multiple `SimliCallStage` references |
| `docs/tempo-backend-audit.md` | 359: `SimliCallStage` in legacy stage list |
| `docs/student-class-detail-audit.md` | 111: `simli_face_id` in select |
| `CODE_GUIDELINES.md` | 21, 82: Simli mentions |
| `README.md` | 3, 7, 9, 20, 27, 31: Simli stack description, `version-simli/` paths |

**Notable absence:** No `import` from `simli-client` remains in any `.ts`/`.tsx` source file. The npm package is listed in `package.json` but is **dead code** at runtime.

---

### 2. `components/call/SimliCallStage.tsx` — conversion status

**Fully converted at runtime; not renamed.** The file still uses Simli naming in comments, types, and the exported function name, but the implementation uses the Anam pipeline:

- Imports `Avatar` (Anam) and `useSimulationVoiceSession` (Anam event loop)
- State variable is `mountAvatar` (not `mountSimli`)
- Passes `attemptId` and `anamStage: scoreStage` to the voice hook
- Does **not** import `simli-client`, `generateSimliSessionToken`, or `SimliClient`
- Does **not** pass `faceId={simulation.simli_face_id}` to `Avatar` (line 321: `<Avatar ref={voice.avatarRef} />`)

**Evidence — file header and mount flag already say Anam:**

```1:5:components/call/SimliCallStage.tsx
/**
 * SimliCallStage.tsx
 * Orchestrates lobby → Anam connect → active call → score for Discovery and Objections.
 * Avatar mounts once after Join Call and is not remounted until the call ends.
 */
```

```319:322:components/call/SimliCallStage.tsx
      {mountAvatar && (
        <div className="absolute inset-0 z-0" style={{ "--call-video-dock-h": `${CALL_VIDEO_BOTTOM_DOCK_PX}px` } as React.CSSProperties}>
          <Avatar ref={voice.avatarRef} />
        </div>
```

Stale: lines 64–66 still say "Simli-powered simulation stages."

---

### 3. `docs/simli-integration-audit.md` — historical reference

**File exists** at `docs/simli-integration-audit.md` (dated 2026-08-28, purpose: "Document the end-to-end audio/video pipeline **before** a planned Anam migration").

**It accurately describes the OLD pre-migration system** (Deepgram → GPT → ElevenLabs → Simli lip-sync, `simli-client`, `NEXT_PUBLIC_SIMLI_*`, muted Simli audio, `mountSimli`, etc.). Several details are now **out of date** relative to production code:

- `Avatar.tsx` no longer uses `simli-client` or PCM upload
- `useSimulationVoiceSession` no longer uses Deepgram/ElevenLabs for Tempo calls
- Objection Handling double-mount issue was fixed (single Avatar mount)
- `SimliCallStage` uses `mountAvatar` and Anam session config

**Recommendation for readers:** Treat `docs/simli-integration-audit.md` as a **historical baseline**, not current architecture. This document (`in-call-and-simli-cleanup-audit.md`) reflects post-migration state.

---

### 4. Files that would need changes to fully remove Simli

Grouped by category for a future cleanup task. **Do not perform these changes as part of this audit.**

#### npm / env

- `package.json` — remove `simli-client` dependency
- `package-lock.json` — regenerated on `npm install` after removal
- `.env.example` — remove `NEXT_PUBLIC_SIMLI_API_KEY`, `NEXT_PUBLIC_SIMLI_FACE_ID` (and section comment); ensure `ANAM_API_KEY` is documented if not already

#### Rename / rewire (Simli-branded names → neutral or Anam)

- `components/call/SimliCallStage.tsx` — rename file/export (e.g. `VideoCallStage`); update imports in `components/stages/DiscoveryStage.tsx`, `components/stages/ObjectionsStage.tsx`
- `lib/constants.ts` — rename `SIMLI_CONNECT_TIMEOUT_MS` → e.g. `ANAM_CONNECT_TIMEOUT_MS`; remove or repurpose unused `SIMLI_MAX_SESSION_LENGTH_SEC`, `SIMLI_MAX_IDLE_TIME_SEC`, `SIMLI_VIDEO_STAGES`, `SIMLI_FACE_ID`; update comment blocks
- `components/Avatar.tsx` — update constant import after rename
- `types/index.ts` — update AvatarRef JSDoc ("Starts Simli WebRTC" → Anam)

#### Remove dead props / DB field semantics (larger migration)

- `simulations.simli_face_id` column — superseded by `anam_avatar_ids` / `anam_voice_ids`; would need SQL migration + type updates
- `components/tempo/stages/DiscoveryStage.tsx`, `ObjectionHandlingStage.tsx` — remove `simliFaceId` prop chain
- `app/student/simulation/[id]/page.tsx` — stop passing `simliFaceId`
- `components/SimulationForm.tsx`, `components/shared/Sidebar.tsx` — replace "Simli Face ID" with Anam avatar/voice ID fields (or remove if teacher UI moves elsewhere)
- `components/tempo/stages/DiscoveryCallSession.tsx`, `ObjectionHandlingCallSession.tsx` — remove unused `faceId` prop to `Avatar`
- `lib/student-class-data.ts` — update selects if column dropped

#### Comments / docs only (low risk)

- `components/call/CallLayout.tsx` — comment update
- `components/tempo/stages/DiscoveryCallSession.tsx` — header comments
- `components/tempo/stages/ObjectionHandlingStage.tsx` — header comment
- `components/stages/DiscoveryStage.tsx`, `ObjectionsStage.tsx` — header comments
- `CODE_GUIDELINES.md`, `README.md` — architecture description
- `docs/simli-integration-audit.md` — add banner "SUPERSEDED" or archive; optional
- `docs/structure-audit.md`, `docs/tempo-backend-audit.md`, `docs/student-class-detail-audit.md` — update references if renaming files

#### SQL seeds (if column removed)

- `supabase/archive/schema.sql`, `supabase/FULL-SETUP.sql`, `supabase/default-class-migration.sql`, `supabase/archive/tempo-simulation-seed.sql`

**Estimated minimum for "no Simli at runtime":** remove `simli-client` from `package.json`, delete env vars, rename constants/comments — **without** DB column removal, teachers would still see `simli_face_id` in forms but it would be unused for Tempo/legacy video calls (Anam IDs drive avatars).

---

## Summary

| Area | Finding |
|------|---------|
| **Tempo active call components** | `DiscoveryCallSession` vs `ObjectionHandlingCallSession` — different UIs, shared `Avatar` + voice hook pattern |
| **Side panels** | `DiscoveryStageLayout` vs `ObjectionHandlingStageLayout` — both show live transcript; Objections adds playbook tab and strategy hints |
| **Simli at runtime** | **Removed** from call pipeline; `simli-client` is an unused npm dependency |
| **Simli naming** | Extensive leftovers in file names, constants, props, comments, DB column, teacher forms, and README |
| **Historical doc** | `docs/simli-integration-audit.md` exists and correctly documents the **old** system; partially stale post-migration |
