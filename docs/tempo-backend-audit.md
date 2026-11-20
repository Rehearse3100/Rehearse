# Tempo / Summit Dental Backend Audit

**Date:** 2026-07-11 (updated same day — §13 after negotiation localStorage clear fix)  
**Scope:** Read-only factual audit of current Tempo (Rehearse Essentials default class) backend behavior.  
**Method:** Direct inspection of source files. No recommendations.

---

## 1. Stage submission flow

All five Tempo stages submit through the same client helper and the same API route.

### Shared client helper

`completeStage()` POSTs `{ attemptId, stage, score, feedback, transcript }` to `/api/student/complete-stage`.

```11:22:lib/attempt-actions.ts
export async function completeStage(
  attemptId: string,
  stage: SimulationStage,
  score: number,
  feedback: string,
  transcript: string
): Promise<{ nextStage: SimulationStage | null; totalScore: number }> {
  const res = await fetch("/api/student/complete-stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId, stage, score, feedback, transcript }),
  });
```

### Shared API handler — database writes in order

`app/api/student/complete-stage/route.ts`:

1. Auth via `requireStudentApi()`.
2. Validate body fields (`attemptId`, `stage`, `score`, `feedback`, `transcript`).
3. Select attempt: `attempts` where `id = attemptId` and `student_id = session.studentId`.
4. **Upsert** into `stage_scores` with columns `attempt_id`, `stage`, `score`, `feedback`, `transcript` (`onConflict: "attempt_id,stage"`).
5. **Select** all `stage_scores.score` for the attempt; sum into `totalScore`.
6. Compute `next = getNextStage(stage)`.
7. If next is `"results"` or `null`: **update** `attempts` with `current_stage: "results"`, `status: "completed"`, `total_score`, `completed_at`.
8. Else: **update** `attempts` with `current_stage: next`, `total_score`.

```51:87:app/api/student/complete-stage/route.ts
    await supabase.from("stage_scores").upsert(
      {
        attempt_id: attemptId,
        stage,
        score,
        feedback,
        transcript,
      },
      { onConflict: "attempt_id,stage" }
    );
    // ... sum scores ...
    if (next === "results" || next === null) {
      await supabase
        .from("attempts")
        .update({
          current_stage: "results",
          status: "completed",
          total_score: totalScore,
          completed_at: new Date().toISOString(),
        })
        .eq("id", attemptId);
    }
    await supabase
      .from("attempts")
      .update({ current_stage: next, total_score: totalScore })
      .eq("id", attemptId);
```

`getNextStage` follows `STAGE_ORDER`: `lead_gen → prospecting → discovery → presentation → objections → close → results`.

```19:27:types/index.ts
export const STAGE_ORDER: SimulationStage[] = [
  "lead_gen",
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
  "results",
];
```

### Per-stage submission (Tempo)

| Stage | Trigger | `stage` key | `score` | `feedback` | `transcript` payload shape |
|---|---|---|---|---|---|
| Prospecting | `useProspectingWizard` `handleSubmit` | `"prospecting"` | `0` | `"Submitted — scoring coming soon"` | JSON of wizard fields (`icpField1/2`, `researchNotes`, `fitJustification`, `dmName`, opening fields, agent notes, `chatMessages`, `selfCheck`) |
| Discovery | `DiscoveryStage` `handleSubmitSummary` | `"discovery"` | `0` | `"Submitted — scoring coming soon"` | JSON: `callDurationSeconds`, `transcript`, `transcriptEntries`, `postCallSummary` |
| Presentation | `usePresentationStage` `handleSubmit` | `"presentation"` | `0` | `"Submitted — scoring coming soon"` | JSON: `{ form, submittedAt }` |
| Objection Handling | `ObjectionHandlingStage` `handleSubmitSummary` | `"objections"` | `0` | `"Submitted — scoring coming soon"` | JSON: `callDurationSeconds`, `transcript`, `transcriptEntries`, `postCallSummary`, `objectionTracker` |
| Negotiation | `useNegotiationStage` `handleSubmit` | `"close"` | `0` | `"Submitted — scoring coming soon"` | JSON: `scenarioA`, `scenarioB`, `aiWork`, `submittedAt` |

**Finding:** For all five Tempo stages today, `score` is hardcoded `0` and `feedback` is hardcoded `"Submitted — scoring coming soon"`. No Tempo stage differs.

Evidence — Prospecting:

```247:252:hooks/useProspectingWizard.ts
      await completeStage(
        attemptId,
        "prospecting",
        0,
        "Submitted — scoring coming soon",
        transcript
      );
```

Discovery:

```123:123:components/tempo/stages/DiscoveryStage.tsx
      await completeStage(attemptId, "discovery", 0, "Submitted — scoring coming soon", payload);
```

Presentation:

```137:142:hooks/usePresentationStage.ts
      await completeStage(
        attemptId,
        "presentation",
        0,
        "Submitted — scoring coming soon",
        payload
      );
```

Objections:

```156:156:components/tempo/stages/ObjectionHandlingStage.tsx
      await completeStage(attemptId, "objections", 0, "Submitted — scoring coming soon", payload);
```

Negotiation:

```278:278:hooks/useNegotiationStage.ts
      await completeStage(attemptId, "close", 0, "Submitted — scoring coming soon", payload);
```

Note: non-Tempo / legacy stages under `components/stages/` and `components/call/` *do* call `fetchStageScore` then pass a real score — but those paths are outside Tempo Stage 1–5.

---

## 2. `stage_scores` schema as referenced by code

**Finding:** Application code only reads/writes these columns on `stage_scores`: `id`, `attempt_id`, `stage`, `score`, `feedback`, `transcript`, `completed_at`. There is **no** reference to `substance_score`, `style_score`, or `badges_earned` anywhere in Tempo (or the shared `StageScore` type).

TypeScript type:

```63:71:types/index.ts
export type StageScore = {
  id: string;
  attempt_id: string;
  stage: SimulationStage;
  score: number;
  feedback: string | null;
  transcript: string | null;
  completed_at: string;
};
```

Columns used in upsert (write path): `attempt_id`, `stage`, `score`, `feedback`, `transcript` — see `app/api/student/complete-stage/route.ts` lines 51–58.

Columns used in selects: `"*"` or `"score"` / `"stage, score, completed_at"` depending on page.

`substance_score` / `style_score` / `badges_earned`: **NOT IMPLEMENTED** (no column references in codebase).

---

## 3. `attempts.stage_data` usage

**Finding:** `stage_data` is used for **draft persistence** for Prospecting and Presentation only. Discovery, Objection Handling, and Negotiation do **not** write drafts to `stage_data`. Negotiation drafts live in `localStorage` only.

### Prospecting

- API: `app/api/student/prospecting-wizard/route.ts`
- GET reads `attempts.stage_data` and treats the **entire** JSON blob as `ProspectingWizardState`.
- POST **overwrites** `stage_data` with the full wizard state object (not nested under a key).

```87:90:app/api/student/prospecting-wizard/route.ts
    const { error: updateError } = await supabase
      .from("attempts")
      .update({ stage_data: state })
      .eq("id", attemptId);
```

### Presentation

- API: `app/api/student/presentation-stage/route.ts`
- Stores under nested key `stage_data.presentation`.
- Merges with existing `stage_data` so other keys can coexist.

```88:91:app/api/student/presentation-stage/route.ts
    const existing = (attempt.stage_data ?? {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from("attempts")
      .update({ stage_data: { ...existing, presentation: form } })
```

### Restart clears `stage_data`

```87:93:app/api/student/simulation/restart/route.ts
    const resetPayload: Record<string, unknown> = {
      current_stage: "lead_gen",
      total_score: 0,
      status: ATTEMPT_STATUS.IN_PROGRESS,
      completed_at: null,
      stage_data: null,
    };
```

### Discovery / Objections / Negotiation drafts on `stage_data`

**NOT IMPLEMENTED** for those stages. Negotiation uses `localStorage` key `tempo-negotiation-${attemptId}` (`lib/tempo-negotiation.ts`).

---

## 4. Manager handoff notes

**Finding:** All five Tempo handoff messages are **100% static string constants**. They do not read previous-stage transcripts, scores, or form fields. `HandoffModal` renders the `message` prop as-is.

Constants live in `lib/tempo-prospecting.ts`:

```30:40:lib/tempo-prospecting.ts
export const TEMPO_HANDOFF_MESSAGES = {
  prospecting: `Your outreach landed. Dana Reyes...`,
  discovery: `Your outreach landed. Dana Reyes has agreed...`,
  presentation: `Nice work — Dana wants you back...`,
  objections: `You sent the proposal — Dr. Kim wants a call...`,
  negotiation: `You earned it — Kim is ready to talk terms...`,
} as const;
```

Usage pattern (example — Discovery stage):

```182:194:components/tempo/stages/DiscoveryStage.tsx
          message={TEMPO_HANDOFF_MESSAGES.presentation}
          // ...
          message={TEMPO_HANDOFF_MESSAGES.discovery}
```

Modal display (no transformation):

```79:79:components/tempo/HandoffModal.tsx
          <div className="bg-surface-container-low p-4 rounded-r-lg border-l-4 border-tertiary-container">
```

(The message text is rendered from the `message` prop in that card; no prior-stage lookup.)

---

## 5. GPT system prompts — prior-stage content?

**Finding:** Every Tempo GPT system prompt is a **fixed template constant**. No previous-stage transcript or submission is interpolated into the system prompt. Conversation history for chat/voice is only the **current** session’s messages.

| Stage / use | Prompt constant | Where assembled | Variables interpolated into system prompt |
|---|---|---|---|
| Prospecting research chat | `TEMPO_RESEARCH_SYSTEM_PROMPT` | `hooks/useProspectingWizard.ts` → `/api/chat` | **None** — fixed string |
| Discovery voice | Dana's card (`lib/server/tempo-call-cards.ts`) after the shared rules (`lib/server/call-prompt.ts`); the opening is the brain's start turn | Server: `lib/server/call-brain.ts` for `POST /api/student/call-turn` (the browser sends the persona key only: `DiscoveryCallSession.tsx` → `useTempoCallSession` → `useSimulationVoiceSession`) | **None** from earlier stages — fixed card |
| Objection voice | Dr. Kim's card (same files); the opening is the brain's start turn | Server: `lib/server/call-brain.ts` for `POST /api/student/call-turn` (`ObjectionHandlingCallSession.tsx` → `useTempoCallSession` → `useSimulationVoiceSession`) | **None** from earlier stages — fixed card |
| Negotiation Scenario A | `SCENARIO_A_SYSTEM_PROMPT` | `useNegotiationStage.ts` → `/api/chat` | **None** — fixed string |
| Negotiation Scenario B | `SCENARIO_B_SYSTEM_PROMPT` | `useNegotiationStage.ts` → `/api/chat` | **None** — fixed string |

Prospecting research:

```183:190:hooks/useProspectingWizard.ts
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(0, -1),
          newMessage: trimmed,
          systemPrompt: TEMPO_RESEARCH_SYSTEM_PROMPT,
        }),
```

Discovery and Objection Handling (updated after the call-brain port: the browser no longer holds a prompt, a stage hint or an opening line; it sends the persona key, and the opening is the brain's start turn):

```tsx
// components/tempo/stages/DiscoveryCallSession.tsx (ObjectionHandlingCallSession.tsx: "tempo_objections", "objections", "drKim")
const call = useTempoCallSession({
  persona: "tempo_discovery",
  anamStage: "discovery",
  personaRole: "dana",
  // …the lobby's streams and the session's callbacks
});
```

Negotiation turns:

```192:202:hooks/useNegotiationStage.ts
      const systemPrompt = scenario === "A" ? SCENARIO_A_SYSTEM_PROMPT : SCENARIO_B_SYSTEM_PROMPT;
      const messages = buildChatHistory(scenarioData.turns, turnIndex);
      // ...
        body: JSON.stringify({
          messages,
          newMessage: currentResponse.trim(),
          systemPrompt,
        }),
```

**UI-only prior context (not in GPT prompts):** Presentation / Objections / Negotiation stages receive parsed prior summaries as React props for display panels (`discoverySummary`, `presentationSummary`, `objectionSummary`). Negotiation builds a “Prior Context” UI via `buildNegotiationPriorContext()` in `lib/tempo-negotiation.ts`. That data is **not** passed into Scenario A/B system prompts.

---

## 6. Does any later stage read `stage_scores.transcript`?

**Finding:** Yes — for **UI / form prefill panels**, not for GPT scoring prompts.

In `app/student/simulation/[id]/page.tsx`:

```162:178:app/student/simulation/[id]/page.tsx
  const discoveryScore = scores.find((s) => s.stage === "discovery");
  const discoverySummary = parseDiscoverySummaryFromTranscript(discoveryScore?.transcript);
  // ...
  const presentationScore = scores.find((s) => s.stage === "presentation");
  const presentationSummary = parsePresentationFormFromTranscript(presentationScore?.transcript);
  // ...
  const objectionScore = scores.find((s) => s.stage === "objections");
  const objectionSummary = parseObjectionSummaryFromTranscript(objectionScore?.transcript);
```

These summaries are passed into:

- `PresentationStage` (`discoverySummary`)
- `ObjectionHandlingStage` (`presentationSummary`)
- `NegotiationStage` (`discoverySummary`, `presentationSummary`, `objectionSummary`)

There is **no** Tempo code path that reads a prior `stage_scores.transcript` and sends it into `/api/score` or into a later stage’s GPT system prompt. For F27-style “prior-stage context passed to scoring”: **NOT IMPLEMENTED**.

---

## 7. Scoring reality — `/api/score` vs Tempo

**Finding:** `/api/score` exists and calls GPT-4o to return `{ score, feedback }`. **No Tempo stage component or hook calls it.** Tempo always submits score `0` with placeholder feedback (Section 1).

`/api/score` behavior (`app/api/score/route.ts`):

1. Requires `OPENAI_API_KEY`, `stage`, `simulationContext`.
2. Builds prompt via `buildScoringPrompt(stage, context)` (`lib/scoring.ts`).
3. Calls GPT-4o with `response_format: json_object`.
4. Parses via `parseScoringResponse`; retries once on failure.
5. Returns `{ score, feedback }` or fallback `{ score: 0, feedback: "Scoring failed..." }`.

Caller of `/api/score` for Tempo stages under `components/tempo/`: **none** (grep finds no `fetchStageScore` / `/api/score` under `components/tempo/`).

`fetchStageScore` in `lib/attempt-actions.ts` is used by legacy stages (`components/stages/LeadGenStage.tsx`, `components/stages/PresentationStage.tsx`, `components/call/PhoneCallStage.tsx`, `components/call/SimliCallStage.tsx`) — not Tempo.

---

## 8. `lib/tempo-results.ts` helpers

### `tempoResultsSubstanceStyle(score)`

Pure arithmetic: substance = round(score × 0.6), style = round(score × 0.4); maxes 60 / 40. No AI, no DB.

```121:132:lib/tempo-results.ts
export function tempoResultsSubstanceStyle(score: number): {
  substance: number;
  style: number;
  substanceMax: number;
  styleMax: number;
} {
  return {
    substance: Math.round(score * 0.6),
    style: Math.round(score * 0.4),
    substanceMax: 60,
    styleMax: 40,
  };
}
```

### `tempoResultsDealWon(closeStageScore)`

Parses `close` stage `transcript` JSON; returns `true` if `scenarioB.outcome.status` is `"deal_agreed"` or `"partial_close"`. Missing/invalid transcript defaults to `true`.

```138:148:lib/tempo-results.ts
export function tempoResultsDealWon(closeStageScore: StageScore | undefined): boolean {
  if (!closeStageScore?.transcript?.trim()) {
    return true;
  }
  try {
    const data = JSON.parse(closeStageScore.transcript) as NegotiationTranscriptPayload;
    const scenarioB = data.scenarioB?.outcome?.status;
    return scenarioB === "deal_agreed" || scenarioB === "partial_close";
  } catch {
    return true;
  }
}
```

### Other exported helpers / values in this file (one line each)

| Symbol | What it does |
|---|---|
| `TEMPO_RESULTS_MAX_SCORE` | Constant `500` |
| `TEMPO_RESULTS_STAGE_MAX` | Constant `100` |
| `TEMPO_RESULTS_STAGE_CONFIG` | Five stage display configs (label, icon, modality) |
| `TEMPO_RESULTS_STAGE_SUBTITLES` | Short subtitle per stage key |
| `TEMPO_STYLE_FEEDBACK_PLACEHOLDER` | Static style-placeholder copy string |
| `tempoResultsGradeFromPercent(pct)` | Maps 0–100% to letter grade string |
| `tempoResultsGradeColor(grade)` | Tailwind classes for grade badge |
| `tempoResultsTotalScore(stageScores)` | Sums scores for the five Tempo stage IDs |
| `tempoResultsDurationLabel(started, completed)` | Formats elapsed attempt time |
| `TEMPO_MANAGER_NOTE_WON/LOST/PARTIAL` | Static manager wrap-up strings |
| `TEMPO_TEST_RESULTS_OUTCOMES` | Dev dropdown outcome list |
| `buildTempoTestResultsMock(outcome)` | Builds fake scores/transcripts for `?testresults=` |
| `buildTempoTestLeaderboard(...)` | Fake peer leaderboard for test preview |
| `tempoResultsHeroSubtitle(outcome, dealWon)` | Hero subtitle string |
| `tempoResultsManagerNote(outcome, dealWon)` | Picks WON/PARTIAL/LOST manager note |
| `parseNegotiationOutcomeFromCloseStage(closeScore)` | Returns `deal_agreed` \| `partial_close` \| `kim_walked` \| `null` from close transcript |
| `resolveTempoResultsOutcome(outcome, dealWon)` | Falls back to won/lost when outcome null |
| `tempoResultsOutcomeTheme(outcome)` | Hero/bar color theme classes |
| `tempoResultsCompetencyLabel(pct)` | Excellent/Strong/Good/… label |
| `tempoResultsHeroTitle(outcome)` | “Deal Won.” / “Partial Close.” / “Deal Lost.” |

---

## 9. Negotiation outcome — produce & parse

### GPT instruction (Scenario A and B)

Both prompts instruct Turn 3 to end with an outcome code:

```277:281:lib/constants.ts
After Turn 3, end your response with exactly one of these outcome codes on a new line:
OUTCOME:deal_agreed
OUTCOME:kim_walked
OUTCOME:partial_close

Then on the next line write a 2-3 sentence closing message explaining the outcome.
```

(Same block in `SCENARIO_B_SYSTEM_PROMPT` at lines 289–293.)

### Runtime parse — full function

```306:339:lib/tempo-negotiation.ts
export function parseNegotiationOutcome(reply: string): {
  kimTail: string;
  outcome: NegotiationOutcome | null;
} {
  if (!reply.includes("OUTCOME:")) {
    return { kimTail: reply.trim(), outcome: null };
  }

  const lines = reply.split("\n");
  const outcomeIndex = lines.findIndex((line) => line.startsWith("OUTCOME:"));
  if (outcomeIndex < 0) {
    return { kimTail: reply.trim(), outcome: null };
  }

  const kimTail = lines.slice(0, outcomeIndex).join("\n").trim();
  const outcomeCode = lines[outcomeIndex]?.replace("OUTCOME:", "").trim() as
    | NegotiationOutcomeStatus
    | undefined;
  const outcomeMessage =
    lines
      .slice(outcomeIndex + 1)
      .join(" ")
      .trim() || kimTail;

  const status: NegotiationOutcomeStatus =
    outcomeCode === "kim_walked" || outcomeCode === "partial_close"
      ? outcomeCode
      : "deal_agreed";

  return {
    kimTail,
    outcome: { status, message: outcomeMessage },
  };
}
```

Called on the last turn of each scenario in `useNegotiationStage.ts` (lines 221–226). If parse returns null outcome, code defaults status to `"partial_close"`.

Parsed outcome is stored inside the negotiation payload JSON that becomes `stage_scores.transcript` for stage `"close"`.

---

## 10. Does negotiation outcome affect numeric score?

**Finding:** No. Negotiation still submits `score: 0`. Outcome status is used for results-page hero title/subtitle/theme and manager note selection (`tempoResultsDealWon`, `parseNegotiationOutcomeFromCloseStage`, `tempoResultsHeroTitle`, `tempoResultsOutcomeTheme`, `tempoResultsManagerNote`). It does **not** change the numeric `score` field written at submit time.

---

## 11. Real attempt vs `?testresults=` props to results view

**Finding (current code):** Both paths pass `negotiationOutcome` to `TempoSimulationResultsView`. The older bug where real attempts omitted it is **no longer present** in the current source.

### Test-preview path (`?testresults=deal_agreed|partial_close|kim_walked`)

```93:108:app/student/simulation/[id]/complete/page.tsx
    return (
      <div className="animate-fade-in-up">
        <TempoSimulationResultsView
          simulationId={params.id}
          classId={DEFAULT_CLASS_ID}
          displayName={session.displayName}
          totalScore={mock.totalScore}
          grade={mock.grade}
          dealWon={mock.dealWon}
          stageScores={mock.stageScores}
          leaderboard={leaderboard}
          studentId={session.studentId}
          completedAt={mock.completedAt}
          startedAt={mock.startedAt}
          negotiationOutcome={mock.negotiationOutcome}
        />
      </div>
    );
```

### Real attempt path

```189:213:app/student/simulation/[id]/complete/page.tsx
  if (isTempoDefault) {
    const closeScore = scores.find((s) => s.stage === "close");
    const dealWon = tempoResultsDealWon(closeScore);
    const negotiationOutcome = parseNegotiationOutcomeFromCloseStage(closeScore);
    const totalScore = tempoResultsTotalScore(scores);
    const grade = tempoResultsGradeFromPercent(
      Math.round((totalScore / TEMPO_RESULTS_MAX_SCORE) * 100)
    );

    return (
      <div className="animate-fade-in-up">
        <TempoSimulationResultsView
          simulationId={params.id}
          classId={DEFAULT_CLASS_ID}
          displayName={session.displayName}
          totalScore={totalScore}
          grade={grade}
          dealWon={dealWon}
          stageScores={scores}
          leaderboard={leaderboard}
          studentId={session.studentId}
          completedAt={attempt.completed_at as string | null}
          startedAt={attempt.started_at as string | null}
          negotiationOutcome={negotiationOutcome}
        />
      </div>
    );
  }
```

Difference today: test path uses mock scores/leaderboard; real path uses DB `stage_scores` and cohort leaderboard. Both pass `negotiationOutcome`.

---

## 12. Badges

**Finding:** Results-page badge grid is entirely static. No computation of earned badges; six locked slots rendered with `Array.from({ length: 6 })`.

```216:233:components/tempo/TempoSimulationResultsView.tsx
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6">
              <h4 className="text-headline-md font-bold text-on-surface mb-4">
                Achievement Progress
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square border-2 border-dashed border-outline-variant rounded-lg flex items-center justify-center grayscale opacity-40"
                  >
                    <MaterialIcon name="lock" className="text-outline text-3xl" />
                  </div>
                ))}
              </div>
              <p className="text-label-sm text-on-surface-variant mt-4 text-center">
                Badges coming soon — 12 available in this simulation
              </p>
            </div>
```

Badge-earning logic / data source: **NOT IMPLEMENTED**.

(Negotiation stage UI has local “Complete scenario to unlock” badge previews tied to scenario completion state inside the stage layout — those are stage-UI only, not results-page earned badges.)

---

## 13. Restart / retry behavior

### Server: `POST /api/student/simulation/restart`

`app/api/student/simulation/restart/route.ts`:

1. Auth + validate `attemptId`, `simulationId`, `classId`.
2. Load attempt; require `status === in_progress`.
3. **Delete** all `stage_scores` for `attempt_id`.
4. **Update** attempt: `current_stage: "lead_gen"`, `total_score: 0`, `status: in_progress`, `completed_at: null`, `stage_data: null` (plus optional `class_id` / `student_class_id` backfill).
5. Return `{ success: true, newAttemptId: attemptId }` (same attempt id reused).

### Client: `RestartSimulationButton`

After successful API response, clears **three** localStorage drafts, then full-page navigates:

```75:83:components/simulation/RestartSimulationButton.tsx
    const data = (await res.json()) as RestartSimulationResponse;
    clearProspectingWizardFromStorage(attemptId);
    clearPresentationFromStorage(attemptId);
    clearNegotiationFromStorage(attemptId);
    const href =
      redirectHref ??
      buildRestartRedirectHref(simulationId, classId, simulationTitle, data.newAttemptId);

    window.location.assign(href);
```

Keys cleared:

- Prospecting: `rehearse-prospecting-wizard-${attemptId}` (`clearProspectingWizardFromStorage` in `lib/tempo-prospecting.ts`)
- Presentation: `tempo-presentation-${attemptId}` (`clearPresentationFromStorage` in `lib/tempo-presentation.ts`)
- Negotiation: `tempo-negotiation-${attemptId}` (`clearNegotiationFromStorage` → `getNegotiationStorageKey` in `lib/tempo-negotiation.ts`)

### Negotiation localStorage clear helper

```303:315:lib/tempo-negotiation.ts
/**
 * Clears negotiation draft from localStorage (e.g. on simulation restart).
 */
export function clearNegotiationFromStorage(attemptId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(getNegotiationStorageKey(attemptId));
  } catch {
    /* ignore */
  }
}
```

**Current behavior:** On restart, prospecting, presentation, and negotiation `localStorage` drafts for the same `attemptId` are all cleared on the client. Server still nulls `stage_data` and deletes `stage_scores` as above.

*(Historical note: an earlier audit revision found negotiation was not cleared; that gap was fixed in commit `794e4b8`.)*

---

## Quick reference — files inspected

| Area | Primary files |
|---|---|
| Submit API | `app/api/student/complete-stage/route.ts`, `lib/attempt-actions.ts` |
| Stage submitters | `hooks/useProspectingWizard.ts`, `components/tempo/stages/DiscoveryStage.tsx`, `hooks/usePresentationStage.ts`, `components/tempo/stages/ObjectionHandlingStage.tsx`, `hooks/useNegotiationStage.ts` |
| Drafts | `app/api/student/prospecting-wizard/route.ts`, `app/api/student/presentation-stage/route.ts` |
| Scoring API | `app/api/score/route.ts`, `lib/scoring.ts` |
| Results | `app/student/simulation/[id]/complete/page.tsx`, `lib/tempo-results.ts`, `components/tempo/TempoSimulationResultsView.tsx` |
| Handoffs / prompts | `lib/tempo-prospecting.ts`, `lib/constants.ts`, `components/tempo/HandoffModal.tsx` |
| Prior transcripts | `app/student/simulation/[id]/page.tsx`, `lib/tempo-negotiation.ts`, `lib/tempo-presentation.ts` |
| Restart | `app/api/student/simulation/restart/route.ts`, `components/simulation/RestartSimulationButton.tsx`, `lib/tempo-negotiation.ts` (`clearNegotiationFromStorage`) |
