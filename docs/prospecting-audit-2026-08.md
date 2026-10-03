# Prospecting Stage Audit — 2026-08-29 (post-ICP)

Read-only audit of the Tempo Prospecting stage as implemented in the repository and on Supabase project `visuvrjmcoanndndimfw`. **No application code was modified.** The only file written is this report.

**Stale reference checked:** `docs/prospecting-stage-reference.md` (no `docs/prospecting-reference.md` exists).

**Tempo simulation ID (code):** `00000000-0000-0000-0000-000000000002` (`lib/constants.ts:160`).

---

## SECTION 1 — Wizard structure as it exists now

### 1.1 Step definition array

```10:31:lib/tempo-prospecting.ts
export type ProspectingStepId = "icp" | "research" | "select_lead" | "opening";

export const PROSPECTING_STEPS: readonly ProspectingStepDefinition[] = [
  { id: "icp", label: "Define Your ICP", description: "Who is Tempo for?" },
  {
    id: "research",
    label: "Data Room",
    description: "Review documents and shortlist three accounts",
  },
  {
    id: "select_lead",
    label: "Select Target Lead",
    description: "Choose your best lead",
  },
  { id: "opening", label: "Opening Message", description: "Write your outreach" },
] as const;
```

| Index | `id` | Label | Panel component |
|------:|------|-------|-----------------|
| 0 | `icp` | Define Your ICP | `ProspectingIcpStep` |
| 1 | `research` | Data Room | `ProspectingDataRoom` |
| 2 | `select_lead` | Select Target Lead | `ProspectingLeadSelectionStep` |
| 3 | `opening` | Opening Message | default branch in `ProspectingStepPanels` |

### 1.2 How `currentStep` is tracked

- **Type:** numeric index on `ProspectingWizardState.currentStep` (default `0`) — `lib/tempo-prospecting.ts:136,165`.
- **Not** a string step id at runtime; ids exist only in `PROSPECTING_STEPS` metadata.
- **Persisted:** `attempts.stage_data` via `POST /api/student/prospecting-wizard` (`app/api/student/prospecting-wizard/route.ts:58-103`) and browser `localStorage` (`lib/tempo-prospecting.ts:277-309`).

ICP gate resets step on load when feedback not seen:

```125:131:hooks/useProspectingWizard.ts
        const icpDone = nextIcp?.feedbackSeen === true;
        nextState = {
          ...nextState,
          icpGateComplete: icpDone,
          currentStep: icpDone ? nextState.currentStep : 0,
          prospectingStepVersion: icpDone ? nextState.prospectingStepVersion ?? 2 : undefined,
        };
```

Navigation blocked until ICP gate complete:

```183:190:hooks/useProspectingWizard.ts
  const setCurrentStep = useCallback(
    (step: number): void => {
      if (step > 0 && !state.icpGateComplete) {
        return;
      }
      updateField("currentStep", step);
    },
    [state.icpGateComplete, updateField]
  );
```

Legacy index migration when `prospectingStepVersion !== 2`:

```245:250:lib/tempo-prospecting.ts
  let resolvedStep = step;
  if (!icpRecord?.feedbackSeen) {
    resolvedStep = 0;
  } else if (anyRaw.prospectingStepVersion !== 2) {
    resolvedStep = Math.min(step + 1, PROSPECTING_STEPS.length - 1);
  }
```

### 1.3 Advancement function (full) and gate conditions

```400:424:lib/tempo-prospecting.ts
export function canAdvanceProspectingStep(
  stepIndex: number,
  state: ProspectingWizardState
): boolean {
  switch (stepIndex) {
    case 0:
      return state.icpGateComplete;
    case 1:
      return state.shortlistedCompanyIds.length === 3;
    case 2:
      return Boolean(state.selectedLeadId);
    case 3:
      return canSubmitProspectingBrief(state);
    default:
      return false;
  }
}

export function canSubmitProspectingBrief(state: ProspectingWizardState): boolean {
  const words = countWords(state.openingMessage);
  return words >= 20 && words <= 120;
}
```

Wizard “Next” increments index when `canProceed` is true (`ProspectingWizard.tsx:68-72`). Lead selection jumps directly to step 3:

```288:294:hooks/useProspectingWizard.ts
      setState((prev) => {
        const next = { ...prev, selectedLeadId: leadId, currentStep: 3, prospectingStepVersion: 2 };
        void persistState(next);
        return next;
      });
```

### 1.4 Hardcoded step indices (outside `PROSPECTING_STEPS`)

| File | Lines | Usage |
|------|------:|-------|
| `components/tempo/stages/ProspectingStepPanels.tsx` | 54, 64, 74 | `currentStep === 0/1/2` panel routing |
| `lib/tempo-prospecting.ts` | 405-412 | `canAdvanceProspectingStep` switch |
| `hooks/useProspectingWizard.ts` | 291 | `completeLeadSelection` → `currentStep: 3` |
| `components/tempo/stages/ProspectingWizard.tsx` | 198, 261 | Back disabled at step 1; padding at step 1 |
| `lib/tempo-prospecting.ts` | 195-203 | Legacy normalization (`step > 2`, `step === 1`) |
| `lib/attempt-progress.ts` | 60 | `currentStep > 0` = meaningful progress |

---

## SECTION 2 — The ICP step as shipped

### 2.1 Component and fields

**Component:** `ProspectingIcpStep` (`components/tempo/stages/ProspectingIcpStep.tsx`).

**Fields:** one required free-text `<textarea>` (“Your ICP”) — not structured:

```149:156:components/tempo/stages/ProspectingIcpStep.tsx
              <textarea
                id="icp-textarea"
                rows={8}
                value={icpText}
                onChange={(e) => setIcpText(e.target.value)}
```

### 2.2 Persistence

**Location:** `attempts.stage_data.icp` (sibling key, not inside wizard blob):

```43:51:lib/tempo-icp-criteria.ts
export type ProspectingIcpState = {
  originalText: string;
  result: IcpCheckResult;
  displayText: string;
  activeIcpText: string;
  feedbackSeen: boolean;
};
```

Wizard draft stores mirror flag only: `icpGateComplete` (`lib/tempo-prospecting.ts:161,273`).

### 2.3 AI feedback

| Item | Value |
|------|-------|
| Route | `POST /api/student/icp-check` |
| Model | `gpt-4o-mini` (`app/api/student/icp-check/route.ts:218`) |
| Prompt | `buildIcpSystemPrompt()` — grades against `TEMPO_ICP_CRITERIA`, JSON `{ meetsCorrectCriteria, reasoning }` (`route.ts:35-48`) |
| Fallback | Missing key or OpenAI error → **affirmed** (`route.ts:209-245`) |

### 2.4 BLOCKING vs NON-BLOCKING

**ICP quality: NON-BLOCKING.** Corrected submissions still show manager feedback and allow Continue; no re-submit loop.

**ICP step: BLOCKING** until manager feedback Continue (`feedbackSeen: true`):

```405:406:lib/tempo-prospecting.ts
    case 0:
      return state.icpGateComplete;
```

```272:273:lib/tempo-prospecting.ts
    icpGateComplete: icpRecord?.feedbackSeen === true,
```

```88:111:components/tempo/stages/ProspectingIcpStep.tsx
  const handleContinue = async (): Promise<void> => {
    ...
    const next: ProspectingIcpState = { ... feedbackSeen: true };
    ...
    onComplete(next);
  };
```

`ManagerFeedbackCard` — Continue always enabled (`components/tempo/ManagerFeedbackCard.tsx:22-23`).

### 2.5 Availability to later steps

- **Not displayed** in steps 1–3 UI.
- **Included in submit transcript** (`hooks/useProspectingWizard.ts:394-400`).
- **Merged server-side** on complete if client omitted (`app/api/student/complete-stage/route.ts:54-79`).
- Otherwise **write-only** for later wizard UX.

---

## SECTION 3 — Directory data and schema

### 3.1 Columns

**`crm_prospect_directory`** (`supabase/FULL-SETUP.sql:191-203`, `supabase/archive/crm-data-room-migration.sql:5-6`):

| Column | Type |
|--------|------|
| `id` | `uuid` PK |
| `simulation_id` | `uuid` FK |
| `company_name` | `text` |
| `industry` | `text` |
| `size_locations` | `text` |
| `signal_hint` | `text` |
| `hidden_claim` | `text` nullable |
| `entry_type` | `text` (`target` \| `crafted_decoy` \| `filler`) |
| `is_active` | `boolean` |
| `created_at` | `timestamptz` |
| `in_data_room` | `boolean` (migration) |

**`crm_prospect_contacts`** (`supabase/FULL-SETUP.sql:213-224`):

| Column | Type |
|--------|------|
| `id` | `uuid` PK |
| `company_id` | `uuid` FK |
| `contact_name` | `text` |
| `contact_title` | `text` |
| `department` | `text` |
| `gender` | `text` nullable |
| `is_correct_contact` | `boolean` |
| `stronger_axis` | `text` nullable |
| `weaker_axis` | `text` nullable |
| `created_at` | `timestamptz` |

**Related:** `crm_prospect_documents` (`supabase/archive/crm-data-room-migration.sql:8-16`) — `company_id`, `doc_type`, `title`, `content`.

### 3.2 Live row counts (Tempo, read-only query 2026-08-29)

Simulation: **“Sell Tempo to Summit Dental Group”** (`00000000-0000-0000-0000-000000000002`).

| Metric | Count |
|--------|------:|
| Total `crm_prospect_directory` rows | 25 |
| `entry_type = target` | 1 |
| `entry_type = crafted_decoy` | 3 |
| `entry_type = filler` | 21 |
| `in_data_room = true` | 10 |
| `crm_prospect_contacts` (all 25 companies) | 75 |
| `crm_prospect_documents` (Data Room companies) | 20 |

### 3.3 Companies per student attempt

**Wizard Data Room (step 1): 10 companies** — fixed roster:

```60:66:app/api/student/data-room/route.ts
      .eq("in_data_room", true)
      .eq("is_active", true)
      .order("company_name", { ascending: true });
```

Roster composition (seeder): 1 target + 3 decoys + 6 random fillers (`scripts/generate-data-room.ts:167-182`).

**CRM Lead company dropdown: up to 25** — randomized subset:

```203:214:lib/tempo-prospect-directory.ts
export function pickProspectDirectorySubset(
  rows: readonly ProspectDirectoryCompanyRow[],
  decoyCount = PROSPECT_DIRECTORY_DECOY_COUNT
): ProspectDirectoryCompanyRow[] {
```

`PROSPECT_DIRECTORY_DECOY_COUNT = 24` (`lib/tempo-prospect-directory.ts:41`). Used by `LeadDetailForm` via `GET /api/student/prospect-directory` (`components/crm/LeadDetailForm.tsx:154-155`), **not** by the wizard Data Room step.

### 3.4 Randomization

| Surface | Behavior |
|---------|----------|
| Data Room (10) | **No** per-attempt shuffle; `in_data_room` flag set once |
| CRM directory API (25) | **Yes** — shuffle on first fetch, cache in `stage_data.directoryCompanyIds` (`app/api/student/prospect-directory/route.ts:150-158`) |
| Data Room sort order | Alphabetical by `company_name` (`data-room/route.ts:66`) |

### 3.5 Public payloads and stripping

**Data Room** (`app/api/student/data-room/route.ts:23-30`):

```typescript
{ id, name, industry, sizeLabel, contacts[], documents[] }
```

**Stripped:** `signal_hint`, `hidden_claim`, `entry_type`, `in_data_room`, `is_correct_contact`, axis fields, `gender`.

**Prospect directory API** (`lib/tempo-prospect-directory.ts:173-184`):

```typescript
{ id, name, industry, sizeLabel, signalHint, contacts[] }
```

**Stripped:** `hiddenClaim`, `isTarget`, contact trap metadata.

---

## SECTION 4 — AI surfaces in Prospecting

### 4.1 Inventory

| Surface | Route | Model | Prompt builder | In live wizard? |
|---------|-------|-------|----------------|-----------------|
| ICP coaching | `POST /api/student/icp-check` | `gpt-4o-mini` | `buildIcpSystemPrompt()` in route | **Yes** (step 0) |
| Data Room assistant | `POST /api/student/data-room-chat` | `gpt-4o` | `buildDataRoomChatSystemPrompt()` | **Yes** (Assistant tab) |
| Per-company scoped research | `POST /api/student/prospect-research-chat` | `gpt-4o` | `buildServerScopedResearchPrompt()` | **No** (orphaned) |
| Badge detection on submit | via `detectTempoBadges()` in `complete-stage` | `gpt-4o-mini` | `buildProspectingBadgePrompt()` | **Yes** (on submit) |
| Opening Message | — | — | — | **No AI** |
| Lead selection validation | `POST .../crm-leads/:id/select` | — | fuzzy match, not LLM | **Yes** |

### 4.2 Cross-company assistant vs per-company chat — **settled**

**Both exist in code. Only the cross-company Data Room assistant is wired to the shipped wizard.**

**Cross-company (live):** `ProspectingDataRoomChat` attaches **multiple** company IDs; server loads Profile + News + contacts for all (`app/api/student/data-room-chat/route.ts:192-262`). Chat state is **component-local only** — not in wizard transcript.

**Per-company (orphaned):** `useProspectingWizard.handleSendMessage` → `prospect-research-chat` (`hooks/useProspectingWizard.ts:324-333`). UI components `ProspectingCompanyDirectory` / `ProspectingScopedChat` are **not imported** by any mounted wizard step (grep: zero imports outside their own files and the stale doc).

### 4.3 Anti-ranking / anti-reveal instructions (quoted)

**Data Room chat:**

```102:104:app/api/student/data-room-chat/route.ts
    "Answer the student's questions using ONLY the content in these documents. ... Treat every attached company with equal, neutral consideration — do not imply any of them is 'better,' 'preferred,' 'the target,' 'real,' or 'a decoy.'",
    "",
    "CRITICAL: If the student asks you to rank, compare, or recommend which of these companies is the best prospect ... do NOT comply.",
```

**Per-company scoped research (orphaned path):**

```236:246:lib/tempo-prospect-directory.ts
  return `You are an AI research assistant ... Treat this company with the same neutral care ... do not imply it is preferred, correct, or "the" target.
...
never tell the student which contact is the "right", "best", or "primary" person to pursue.
```

**ICP check:** No anti-ranking language (not applicable). Criteria avoid naming answer-key accounts (`lib/tempo-icp-criteria.ts:4`).

### 4.4 Can hidden / answer-key fields reach any AI prompt?

| Field | Live AI paths |
|-------|----------------|
| `hidden_claim` (raw column) | **Only** `prospect-research-chat` → `buildServerScopedResearchPrompt` (`lib/tempo-prospect-directory.ts:274-284`). Route is **orphaned**. |
| `hidden_claim` (baked into News docs) | **Yes** — `generate-data-room.ts` weaves hedged claim into News at seed time (`scripts/generate-data-room.ts:275-286`); `data-room-chat` loads document **content** (`data-room-chat/route.ts:212-221`). Student and assistant see prose, not the column name. |
| `is_correct_contact`, `stronger_axis`, `weaker_axis` | **No** — not selected in `data-room` or `data-room-chat` or `prospect-research-chat` contact queries (only `contact_name`, `contact_title`, `department`). |
| `entry_type` / `isTarget` | Loaded server-side in `prospect-research-chat` (`route.ts:156`) but **not injected** into `buildResearchPrompt` text. |
| `signal_hint` | In scoped-research prompt (`lib/tempo-prospect-directory.ts:244`); **not** in Data Room public API (stripped). May appear inside generated Profile/News document text. |

---

## SECTION 5 — `hidden_claim` and the hallucination drill

### 5.1 Scheduled `hidden_claim` mechanic (scoped chat)

**Code path:** `buildServerScopedResearchPrompt` in `lib/tempo-prospect-directory.ts:269-291`.

Scheduling by prior **student** message count:

```279:288:lib/tempo-prospect-directory.ts
  if (priorStudentMessageCount < 2) {
    guardrailDrill = "... Do not introduce it yet. Wait until ... at least two prior student messages.";
  } else if (priorStudentMessageCount === 2) {
    guardrailDrill = `... work in this specific claim exactly once: "${hiddenClaim}". Explicitly frame it as plausible-sounding but unverified ...`;
  } else {
    guardrailDrill = "... one scripted unsupported-detail exercise has already occurred. Do not repeat it ...";
  }
```

**Live in production UI?** **No** — only called from `POST /api/student/prospect-research-chat` (`route.ts:163-166`), which has **no current wizard caller**.

**Indirect live path:** `hidden_claim` from seed config (`scripts/config/tempo-directory-seed.ts:22-23` etc.) is incorporated into **News documents** at generation time (`scripts/generate-data-room.ts:275-286`), hedged in the prompt as “unconfirmed/reported.” Those documents are what the Data Room assistant reads.

### 5.2 Filler probabilistic unsupported-detail drill

```253:254:lib/tempo-prospect-directory.ts
const GENERIC_GUARDRAIL_DRILL =
  "GUARDRAIL DRILL: In roughly one out of every four answers, include ONE plausible but unsupported detail ... Present that detail confidently without labeling it as uncertain ...";
```

Used when `hiddenClaim` is absent in `buildServerScopedResearchPrompt` (`lib/tempo-prospect-directory.ts:275-276`) — **orphaned scoped-chat path only**.

**Data Room chat** has **no** probabilistic drill; prompt requires answers **only** from attached document text (`app/api/student/data-room-chat/route.ts:102`).

### 5.3 Badges tied to this behavior

| Badge ID | Declared source (`lib/tempo-badges.ts`) | Tied to `hidden_claim` drill? |
|----------|----------------------------------------|-------------------------------|
| `pros_guardrails` | `chatMessages / selfCheck` show verifying claims (`tempo-badges.ts:325`) | **Indirectly** — intended for catching AI fabrication; **not** wired to Data Room chat in transcript |
| `pros_reusable_system` | `chatMessages` (`tempo-badges.ts:326`) | No |
| `pros_directed_agent` | `chatMessages` pushback (`tempo-badges.ts:327`) | No |
| `pros_real_trigger` | CRM `trigger` field (`tempo-badges.ts:315`) | No |
| `pros_business_issue_led` | CRM `whyFit` (`tempo-badges.ts:316`) | No |

**No badge** explicitly references `hidden_claim` or the third-message drill by name.

---

## SECTION 6 — Lead selection and convergence

### 6.1 Single-pick Lead Selection step

**Yes** — step index 2, `ProspectingLeadSelectionStep` (`ProspectingStepPanels.tsx:64-71`). Student picks one lead and clicks “Select as Target” (`ProspectingLeadSelectionStep.tsx:201-213`).

### 6.2 Identity validation

**Function:** `validateLeadIdentity(companyName, contactName)` (`lib/tempo-lead-conversion.ts:23-34`).

**Fields checked:** `company_name` and `contact_name` on the lead row (`app/api/student/crm-leads/[leadId]/select/route.ts:80-83`).

**Match rule:** fuzzy via `isCloseMatch` against constants:

```10:11:lib/tempo-lead-conversion.ts
export const CORRECT_COMPANY = "Summit Dental Group";
export const CORRECT_CONTACT = "Dana Reyes";
```

```27:33:lib/tempo-lead-conversion.ts
  if (!isCloseMatch(companyName, CORRECT_COMPANY)) {
    return { success: false, reason: "company" };
  }
  if (!isCloseMatch(contactName, CORRECT_CONTACT)) {
    return { success: false, reason: "contact" };
  }
```

### 6.3 Manager-note failure path

```85:88:app/api/student/crm-leads/[leadId]/select/route.ts
    if (!validation.success) {
      const managerNote =
        validation.reason === "company" ? WRONG_COMPANY_NOTE : WRONG_CONTACT_NOTE;
      return NextResponse.json({ success: false, managerNote });
```

Notes (`route.ts:19-23`) shown in `ConvertFailureModal` (`ProspectingLeadSelectionStep.tsx:105-109`). **Not** GPT-generated.

### 6.4 Success writes

On `POST .../select` success:

1. Clears other leads’ `status` from `selected` → `new` (`select/route.ts:93-97`).
2. Sets picked lead `status: "selected"` (`select/route.ts:104-107`).
3. Calls `syncLeadToAccountAndContact` → upserts `crm_account_notes` + `crm_contact_notes` (`select/route.ts:122-128`, `lib/tempo-lead-conversion.ts:51-124`).
4. Wizard sets `selectedLeadId` and `currentStep: 3` (`hooks/useProspectingWizard.ts:288-294`).

On **prospecting complete** (`complete-stage`), `convertLead` marks lead `converted` (`lib/tempo-lead-conversion.ts:176-187`, `complete-stage/route.ts:100-108`).

### 6.5 `discoveryHandoffSeen`

**Set:** `POST /api/student/discovery-handoff` merges `discoveryHandoffSeen: true` into `attempts.stage_data` (`app/api/student/discovery-handoff/route.ts:41-45`). Called from `ProspectingWizard.handleDiscoveryBegin` after submit (`ProspectingWizard.tsx:84-99`).

**Read:**

- Simulation page — blocks Discovery UI until seen (`app/student/simulation/[id]/page.tsx:210-227`).
- Entry page — shows “prospecting” as display stage when `current_stage === "discovery" && !discoveryHandoffSeen` (`app/student/simulation/[id]/entry/page.tsx:129-131`).
- Prospecting wizard re-shown when discovery handoff pending (`page.tsx:214-220`).

---

## SECTION 7 — Scoring and badges

### 7.1 Prospecting score

**Verified:** client submits score `0` and feedback `"Submitted. Scoring coming soon"`:

```403:408:hooks/useProspectingWizard.ts
      await completeStage(
        attemptId,
        "prospecting",
        0,
        "Submitted. Scoring coming soon",
        transcript
      );
```

Stored via `stage_scores` upsert in `complete-stage` (`app/api/student/complete-stage/route.ts:184-194`). **No numeric scoring model** runs for prospecting content quality.

### 7.2 Prospecting badges

| ID | Name (declared) | GPT criteria source | In submitted transcript? |
|----|-----------------|---------------------|--------------------------|
| `pros_guardrails` | Built Guardrails | `chatMessages` / `selfCheck` (`tempo-badges.ts:325`) | `chatMessages` yes; **usually empty** in live flow. `selfCheck` yes but **no UI toggles** wired (`toggleSelfCheck` exported but unused in panels) |
| `pros_reusable_system` | Reusable System | `chatMessages` (`tempo-badges.ts:326`) | **Dead in practice** — Data Room chat not in transcript |
| `pros_directed_agent` | Directed the Agent | `chatMessages` (`tempo-badges.ts:327`) | **Dead in practice** — same |
| `pros_real_trigger` | Found a Real Trigger | CRM `trigger` from **converted** lead (`complete-stage/route.ts:125-137`, `tempo-badges.ts:315`) | CRM fields appended at badge time, not in transcript JSON |
| `pros_business_issue_led` | Led with Business Issue | CRM `whyFit` (`tempo-badges.ts:316`) | Same |

Badge detection runs on submit (`complete-stage/route.ts:176-181`) using `gpt-4o-mini` (`lib/tempo-badges.ts:541`). If `OPENAI_API_KEY` missing → `[]` (`tempo-badges.ts:565-567`).

CRM-dependent badges excluded when no converted lead fields at detection time (`tempo-badges.ts:383-384,411-416`). Auto-convert runs **before** badge detection on prospecting complete (`complete-stage/route.ts:82-112` then `176-181`), so converted lead CRM fields are usually available.

### 7.3 Flags — dead or empty sources

| Badge | Issue |
|-------|-------|
| `pros_guardrails` | Transcript `chatMessages` / `companyChats` reflect **orphaned** scoped chat; Data Room assistant chat **not included** |
| `pros_reusable_system` | Same — depends on `chatMessages` |
| `pros_directed_agent` | Same |
| `selfCheck` in transcript | Persisted field exists; **no UI** calls `toggleSelfCheck` in current step panels |

---

## SECTION 8 — Generator state

### 8.1 Generator vs current schema

**`generate-prospect-directory.ts`** inserts rows matching `FULL-SETUP.sql` columns (`scripts/generate-prospect-directory.ts:90-99,329-343`). Does **not** set `in_data_room` (defaults `false` per migration).

**`generate-data-room.ts`** requires `in_data_room` column + `crm_prospect_documents` table (`scripts/generate-data-room.ts:131-139`). **Could not verify a live generator run** (not executed per audit rules). Schema and live DB counts (§3.2) are consistent with both generators having been applied.

### 8.2 Guardrail validation (enforced vs warn)

**Enforced (throws):**

- `validateCraftedDecoys` — decoy wins on **>1** company axis (`scripts/generate-prospect-directory.ts:253-258`).
- `validateDesignedContactSets` — each designed company must have exactly 2 trap contacts (`generate-prospect-directory.ts:308-311`).
- Trap contacts — same multi-axis throw via `validateCompetitorsAgainstCanonical` (`generate-prospect-directory.ts:314-321`).
- Missing `strongerAxis` / `weakerAxis` on competitors (`generate-prospect-directory.ts:236-240`).

**Warn only (`console.warn`):**

- Competitor wins on **zero** axes (`generate-prospect-directory.ts:261-265`).
- `strongerAxis` text may not reference winning axis keywords (`generate-prospect-directory.ts:273-276`).
- Filler axis cap skip/unavailable value (`generate-prospect-directory.ts:175-177,198-200`).
- Filler axis still `>= target` after `FILLER_GUARD_RETRY_MAX` attempts (`generate-prospect-directory.ts:210-213`).

**Which companies currently trigger warnings:** **Could not determine without running** `npx tsx scripts/generate-prospect-directory.ts` (forbidden by audit scope).

### 8.3 Filler cap loop

`applyComparableAxisCaps` (`scripts/generate-prospect-directory.ts:164-217`):

- For each axis, if `fillerValue >= targetValue`, calls `regenerateFillerValue` up to `FILLER_GUARD_RETRY_MAX` times.
- If still `>= target` after retries → **warns**, does **not** throw (`generate-prospect-directory.ts:210-213`).
- If `fillerValue < targetValue` already → **skips** axis (`generate-prospect-directory.ts:180-181`).

**Conclusion:** Loop **attempts** to force each filler below target on each comparable axis; it does **not** guarantee success on every axis for every filler.

---

## SECTION 9 — Stale-doc reconciliation

`docs/prospecting-stage-reference.md` vs code today (code is truth):

1. **§1.1** — Documents **3 steps** (`research`, `select_lead`, `opening`); code has **4** with `icp` first.
2. **§1.1 quoted `canAdvanceProspectingStep`** — step 0 gate was `hasProspectingResearchActivity`; now `icpGateComplete`.
3. **§1.2** — “Company Directory” step; live label is **“Data Room”** with documents + assistant tabs.
4. **§1.2 advance gate** — “≥1 research chat message”; now **3 shortlisted companies** (`shortlistedCompanyIds.length === 3`).
5. **§1.2 UI** — `ProspectingCompanyDirectory.tsx`; wizard mounts **`ProspectingDataRoom.tsx`**.
6. **§2 entire section** — Describes 25-company randomized `prospect-directory` API as step-1 UX; wizard step 1 uses **`data-room` API** (10 companies, `in_data_room`).
7. **§2.4** — `hidden_claim` third-message drill via scoped chat; scoped chat route **orphaned**; claim may appear in **News documents** instead.
8. **§2.5** — Per-company `companyChats` persistence as primary research history; Data Room assistant chat **not persisted**.
9. **§3** — Implies lead selection immediately advances; still true but step indices shifted (+1 for ICP).
10. **§4.1** — Interactive `selfCheck` toggles; current Opening panel shows **non-interactive tips** only (`OPENING_MESSAGE_TIPS`, `ProspectingStepPanels.tsx:163-168`).
11. **§4.2** — Badge criteria assume populated `chatMessages`; live transcript **`companyChats` usually empty**.
12. **§6 Badge tie-in** — Describes all five badges as GPT-judged from chat; three depend on **empty/dead** `chatMessages` source.
13. **§8 design rationale §8.2** — “One scoped chat per company” as product design; shipped UX is **multi-attach Data Room assistant**.
14. **Quoted line numbers** throughout — many cite old 3-step `PROSPECTING_STEPS` block at `lib/tempo-prospecting.ts:10-26` that no longer matches file content.
15. **§1.5 / completion** — Still largely accurate on auto-convert and `discoveryHandoffSeen` (minor step-count context missing ICP).

---

## SECTION 10 — Things we did not ask about

1. **Dead wizard exports:** `handleSendMessage` and `toggleSelfCheck` returned from `useProspectingWizard` but **not consumed** by mounted step UI.
2. **Dead components:** `ProspectingCompanyDirectory.tsx`, `ProspectingScopedChat.tsx` — complete alternate step-1 UX still in repo.
3. **Dead constant:** `TEMPO_RESEARCH_SYSTEM_PROMPT` (`lib/tempo-prospecting.ts:83-91`) — Summit-specific; no runtime references in TS/TSX.
4. **Dead function:** `hasProspectingResearchActivity()` — not used in gating.
5. **Opening Message hardcoded pills** — always “Dana Reyes” / “Summit Dental Group” regardless of selected lead (`ProspectingStepPanels.tsx:90-107`).
6. **`selfCheck` in transcript** — serialized on submit but no UI to populate it in current Opening step.
7. **Dual directory systems** — 10-company Data Room for research vs 25-company randomized list for CRM forms; easy to confuse operationally.
8. **Data Room chat ephemeral** — refresh loses assistant conversation; not in `stage_data`.
9. **ICP defaults to affirmed** when OpenAI unavailable — student always gets Continue path after feedback card.
10. **`ProspectingStepPanels.tsx` file header comment** still says “Data Room → Select → Opening” and **omits ICP** (`ProspectingStepPanels.tsx:4-5`).
11. **`ProspectingWizard.tsx` comment** says “5-step prospecting wizard” (`ProspectingWizard.tsx:3`) but `PROSPECTING_STEPS` has **4** entries.
12. **Badge detection still calls paid OpenAI on every prospecting submit** even though numeric score is placeholder 0.

---

## Audit checklist

- [x] `docs/prospecting-audit-2026-08.md` exists with all 10 sections
- [x] Behavioral claims cite file paths and line numbers
- [x] Only this report file was written (no source edits)
- [x] No migration, generator, or seeding script executed
- [x] No Supabase writes (read-only SELECT counts only)
- [x] No paid API calls
- [x] Unanswerable items marked (generator warning inventory; live drill without running scoped chat)

**Audit metadata:** Repository read + Supabase read-only queries. Simulation `00000000-0000-0000-0000-000000000002`.
