# Prospecting Stage Reference

This document describes the Prospecting stage as implemented in the current codebase. It covers both runtime mechanics and design intent. Where the implementation differs from an earlier or implied design (for example, `classifyMatch` or `needsConfirmation` behavior), the discrepancy is called out explicitly.

> **Update — multi-contact model.** Each directory company now has **3 contacts** stored in a separate `crm_prospect_contacts` table, not inline `contact_name`/`contact_title` columns on `crm_prospect_directory` (those columns were dropped). The target and 3 crafted decoys each have 1 hand-authored correct contact plus 2 designed "trap" contacts, validated by the same generic axis guardrail used for company-vs-target. Filler companies get 3 auto-generated contacts from a shared, simulation-agnostic name pool. Sections 2.1, 2.3, and 7 reflect this; see also Section 2.7.

> **Update — server-side research claims and CRM completion gate.** Scoped research chat now uses the authenticated `POST /api/student/prospect-research-chat` route. The browser sends only the attempt/company IDs and chat messages; the server reloads company facts, contacts, and `hidden_claim`, then builds the system prompt. Designed-company claims are scheduled for the third student exchange and explicitly framed as unverified. Selecting the correct Lead now also autofills Account/Contact records, and Stage 2 remains locked until all required Account fields plus the primary Contact's name, title, and buying role are complete.

> **Update — persistent Stage 1-to-2 transition.** Completing Prospecting still writes its score and advances `attempts.current_stage` to `discovery`, but that database advancement no longer makes Discovery visible by itself. The student must explicitly click **Begin Stage 2** on the gated manager handoff. That acknowledgement is persisted as `attempts.stage_data.discoveryHandoffSeen`; until it exists, the entry page says **Continue Stage 1: Prospecting**, the Prospecting wizard remains behind the handoff, and leaving/re-entering cannot bypass the CRM completion gate.

## 1. Overall Prospecting flow

### 1.1 Implemented step order

Prospecting has three steps, in this exact order:

1. **Company Directory**
2. **Select Target Lead**
3. **Opening Message**

The order comes from the shared step definition, not from component ordering:

```ts
// lib/tempo-prospecting.ts:10-26
export type ProspectingStepId = "research" | "select_lead" | "opening";

export const PROSPECTING_STEPS: readonly ProspectingStepDefinition[] = [
  { id: "research", label: "Company Directory", description: "Research candidate companies" },
  {
    id: "select_lead",
    label: "Select Target Lead",
    description: "Choose your best lead",
  },
  { id: "opening", label: "Opening Message", description: "Write your outreach" },
] as const;
```

The wizard state stores `currentStep` as a numeric index. Advancement is governed by one function:

```ts
// lib/tempo-prospecting.ts:331-356
export function canAdvanceProspectingStep(
  stepIndex: number,
  state: ProspectingWizardState
): boolean {
  switch (stepIndex) {
    case 0:
      return hasProspectingResearchActivity(state.companyChats);
    case 1:
      return Boolean(state.selectedLeadId);
    case 2:
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

### 1.2 Step 1 — Company Directory

**What the student sees:** a searchable list of candidate-company cards on the left and either an empty research canvas or a company-scoped AI chat on the right. Every card displays the same public fields: company name, industry, scale, and signal hint (`components/tempo/stages/ProspectingCompanyDirectory.tsx:88-99,111-215`).

**What the student does:** selects one or more companies and asks research questions. Search filters locally by name, industry, or signal:

```ts
// components/tempo/stages/ProspectingCompanyDirectory.tsx:88-99
return companies.filter(
  (c) =>
    c.name.toLowerCase().includes(q) ||
    c.industry.toLowerCase().includes(q) ||
    c.signalHint.toLowerCase().includes(q)
);
```

**Validation before advancing:** at least one student-authored message must exist in any company chat. Merely selecting a company or receiving an AI message is insufficient:

```ts
// lib/tempo-prospect-directory.ts:225-233
export function hasProspectingResearchActivity(
  companyChats: Record<string, ChatMessage[]>
): boolean {
  return Object.values(companyChats).some((messages) =>
    messages.some((msg) => msg.role === "user")
  );
}
```

**Storage:** the full wizard state—including `companyChats`, `selectedCompanyId`, and `directoryCompanyIds`—is persisted to `attempts.stage_data`. The same state is also written to browser `localStorage` as a fallback:

```ts
// app/api/student/prospecting-wizard/route.ts:85-102
const merged = {
  ...existing,
  ...normalized,
  directoryCompanyIds:
    normalized.directoryCompanyIds.length > 0
      ? normalized.directoryCompanyIds
      : existingDirectoryIds,
};

await supabase
  .from("attempts")
  .update({ stage_data: merged })
  .eq("id", attemptId);
```

```ts
// lib/tempo-prospecting.ts:243-275
const STORAGE_PREFIX = "rehearse-prospecting-wizard-";
// ...
window.localStorage.setItem(`${STORAGE_PREFIX}${attemptId}`, JSON.stringify(state));
```

### 1.3 Step 2 — Select Target Lead

**What the student sees:** the CRM Leads associated with the attempt. If no Leads exist, the UI directs the student to CRM to create one (`components/tempo/stages/ProspectingLeadSelectionStep.tsx:37-59,123-130`).

**What the student does:** picks a Lead and clicks **Select as Target**. The client calls `POST /api/student/crm-leads/:leadId/select`:

```ts
// components/tempo/stages/ProspectingLeadSelectionStep.tsx:68-95
const res = await fetch(
  `/api/student/crm-leads/${encodeURIComponent(pickedId)}/select`,
  { method: "POST" }
);
// ...
if (!res.ok || !body?.success) {
  if (typeof body?.managerNote === "string" && body.managerNote.trim()) {
    setManagerNote(body.managerNote);
    return;
  }
  setError(body?.error ?? "Could not select this lead.");
  return;
}

await onSelected(pickedId);
```

**Validation before advancing:** both `crm_leads.company_name` and `crm_leads.contact_name` must fuzzy-match the hardcoded Tempo target identity, Summit Dental Group and Dana Reyes. Details are in Section 3.

**Storage:** successful server validation changes the selected `crm_leads.status` to `selected`. The client then stores the Lead ID as `selectedLeadId` in `attempts.stage_data`/localStorage and advances to step index 2:

```ts
// hooks/useProspectingWizard.ts:218-229
const completeLeadSelection = useCallback(
  async (leadId: string): Promise<void> => {
    setState((prev) => {
      const next = { ...prev, selectedLeadId: leadId, currentStep: 2 };
      void persistState(next);
      return next;
    });
  },
  [persistState]
);
```

The selected (and later converted) Lead is sorted to the top of the CRM Home preview and Leads tab. Successful selection also makes a non-fatal call to `syncLeadToAccountAndContact()`, so the Account and primary Contact are available for completion before Prospecting is submitted. The Prospecting picker itself continues to display the order returned by the Leads API.

The Lead list sits in a fixed-height scroll container below the **Open CRM: Leads** and **Refresh list** controls. Its footer is always rendered, including while loading or when no Leads exist, so the layout does not jump when data arrives. **Select as Target** is disabled until a Lead is picked rather than being conditionally mounted (`components/tempo/stages/ProspectingLeadSelectionStep.tsx`).

### 1.4 Step 3 — Opening Message

**What the student sees:** fixed context pills for Dana Reyes, Summit Dental Group, and the eighth-location trigger; a multiline opening-message editor; a live word count; and five writing tips (`components/tempo/stages/ProspectingStepPanels.tsx:79-163`).

**What the student does:** writes an outreach message.

The explicit **Save Draft** button appears only in this Opening Message step. Company Directory and Select Target Lead continue to autosave through the shared wizard persistence path, but they do not show a redundant manual-save action (`components/tempo/stages/ProspectingWizard.tsx`; `hooks/useProspectingWizard.ts`).

**Validation before completion:** the message must be **20 through 120 words inclusive**. The visible tips (specific trigger, business issue, CTA, professional tone) are not programmatically enforced:

```ts
// lib/tempo-prospecting.ts:119-128,320-356
export const SELF_CHECK_ITEMS = [
  { id: "wordCount", label: "Under 120 words" },
  { id: "trigger", label: "Mentioned specific trigger event" },
  { id: "businessIssue", label: "Led with their business issue, not product" },
  { id: "cta", label: "Clear and soft call to action" },
  { id: "professional", label: "Professional and specific tone" },
] as const;

export const OPENING_MESSAGE_TIPS = SELF_CHECK_ITEMS.map((item) => item.label);

export function canSubmitProspectingBrief(state: ProspectingWizardState): boolean {
  const words = countWords(state.openingMessage);
  return words >= 20 && words <= 120;
}
```

**Storage:** the opening message is kept in `attempts.stage_data` while drafting. On submission it is serialized into the Prospecting `stage_scores.transcript` JSON along with chat data and `selfCheck`:

```ts
// hooks/useProspectingWizard.ts:312-333
const transcript = JSON.stringify({
  companyChats: state.companyChats,
  selectedCompanyId: state.selectedCompanyId,
  chatMessages: state.chatMessages,
  openingMessage: state.openingMessage,
  selfCheck: state.selfCheck,
});

await completeStage(
  attemptId,
  "prospecting",
  0,
  "Submitted. Scoring coming soon",
  transcript
);
```

### 1.5 What stage completion creates

The first Account/Contact upsert happens immediately after successful Lead selection. When Prospecting completes, the server looks up the attempt's Lead whose status is `selected` and calls `convertLead()`, which revalidates the identity and runs the same merge-based sync again (`app/api/student/complete-stage/route.ts:53-84`; `lib/tempo-lead-conversion.ts`).

On successful conversion:

- `crm_account_notes` preserves existing student-entered fields and notes while refreshing `accountName`, `primaryContact`, `whyFit`, and `trigger` from the Lead.
- `crm_contact_notes` preserves existing buying role, notes, and other fields while refreshing `name` and `position` for `contact_key = "dana_reyes"`.
- The selected `crm_leads` row becomes `converted`.

There is **no `crm_opportunities` insert** in this path. The CRM UI treats a converted Lead/account as the existence of an Opportunity:

```ts
// components/crm/CrmOverlay.tsx:380-383
const hasConverted =
  hasAccountRow || leads.some((lead) => lead.status === "converted");
const hasOpportunity = hasConverted;
```

The Account and Contact are populated from the student's CRM Lead, not directly from directory/chat state. On the first sync, fields not supplied by the Lead remain blank for the student to complete. Later syncs merge rather than replace, so Account notes, Contact buying role, Contact notes, and manually entered profile fields survive conversion.

### 1.6 Handoff and reference-library presentation

The pre-Stage-1 manager handoff is intentionally non-spoiling. It frames the task as finding one account with real buying signals and one person who owns the decision, but does not name Summit Dental Group or Dana Reyes. The student must discover both through research and Lead Selection. Later handoffs may name them because the identity exercise has already been completed.

The Reference Library contains two cards labeled **Rehearse Tips** with the same structure but deliberately different colors. The pain-over-demographics tip is blue (`bg-secondary-fixed`); the short, trigger-led opening-message tip is gold (`bg-tertiary-fixed`). The former **Professor's Tip** label and asymmetric first-card layout were removed (`components/tempo/stages/ProspectingWizard.tsx`).

Prospecting and handoff UI copy uses plain punctuation rather than em dashes. Examples include **Open CRM: Leads**, **Stage 2: Discovery**, and **Go to CRM: Add Account & Contact Notes**. This is presentation-only and does not change stage behavior.

### 1.7 Entry, exit, and CRM navigation

Clicking **Begin** on a fresh Tempo entry creates or resumes an attempt whose initial `current_stage` is `lead_gen`. Because that value remains in place throughout Stage 1, the entry route also reads `attempts.stage_data`: null stage data means the fresh-start briefing, while any persisted Stage 1 object (including cached directory IDs or a wizard draft) means the in-progress briefing. Therefore, returning after the first Stage 1 visit no longer shows the new-attempt screen (`app/student/simulation/[id]/entry/page.tsx`).

The stage control previously labeled **Back to Dashboard** is now **Exit Simulation**. `TempoExitSimulation` preserves the current simulation ID and `classId` and routes to `/student/simulation/[id]/entry`, so exiting gameplay returns to the briefing/resume screen rather than the student dashboard. Mobile top-bar exit handlers use the same destination (`components/tempo/TempoExitSimulation.tsx`; Tempo stage components).

CRM navigation now separates internal history from closing the overlay:

- The CRM header **Back** button pops an in-memory `CrmNavSnapshot` containing `view`, `contactKey`, `selectedLeadId`, and `leadFormKey`. For example, navigating Contacts → Accounts → Back restores Contacts instead of leaving CRM.
- History resets whenever CRM opens or deep-links to a new starting view. Back is disabled when no prior CRM view exists.
- The gold **Go to Simulation** button is located in the left CRM sidebar immediately above the student profile. It uses the Rehearse logo and closes the CRM overlay through the existing slide-out path, so it does not cover record actions in the main content area.

```ts
// components/crm/CrmOverlay.tsx
const setView = (next: CrmView): void => {
  if (next !== view) {
    viewHistoryRef.current.push({ view, contactKey, selectedLeadId, leadFormKey });
    setCanGoBack(true);
  }
  setViewState(next);
};

const handleCrmBack = (): void => {
  const prev = viewHistoryRef.current.pop();
  setCanGoBack(viewHistoryRef.current.length > 0);
  if (!prev) return;
  setContactKey(prev.contactKey);
  setSelectedLeadId(prev.selectedLeadId);
  setLeadFormKey(prev.leadFormKey);
  setViewState(prev.view);
};
```

## 2. Company Directory + Scoped Research Chat

### 2.1 Data source, simulation scope, randomization, and caching

The browser calls the existing attempt-scoped endpoint:

```ts
// components/tempo/stages/ProspectingCompanyDirectory.tsx:47-67
const res = await fetch(
  `/api/student/prospect-directory?attemptId=${encodeURIComponent(attemptId)}`
);
// ...
const body = (await res.json()) as { companies?: ProspectDirectoryCompany[] };
const next = body.companies ?? [];
setCompanies(next);
onCompaniesLoaded(next);
```

The endpoint verifies that the attempt belongs to the logged-in student, reads its `simulation_id`, and queries active rows from `crm_prospect_directory`:

```ts
// app/api/student/prospect-directory/route.ts:82-99
const { data: attempt, error: attemptError } = await supabase
  .from("attempts")
  .select("id, student_id, simulation_id, stage_data")
  .eq("id", attemptId)
  .eq("student_id", auth.session.studentId)
  .maybeSingle();

const allRows = await loadDirectoryRows(String(attempt.simulation_id));
```

```ts
// app/api/student/prospect-directory/route.ts:48-52
const { data, error } = await supabase
  .from("crm_prospect_directory")
  .select(
    "id, company_name, industry, size_locations, signal_hint, hidden_claim, entry_type"
  )
  .eq("simulation_id", simulationId)
  .eq("is_active", true);
```

Contacts live in a separate table now, so the loader makes a second query against `crm_prospect_contacts`, groups by `company_id`, and alphabetizes each company's list. It deliberately does **not** select `is_correct_contact`, `stronger_axis`, or `weaker_axis`, so the ordering and payload never hint which contact is the right one:

```ts
// app/api/student/prospect-directory/route.ts:61-82
const { data: contacts, error: contactsError } = await supabase
  .from("crm_prospect_contacts")
  .select("company_id, contact_name, contact_title, department")
  .in("company_id", companyIds);
// ...group into contactsByCompany, then:
contactsByCompany.forEach((list) => {
  list.sort((a, b) => a.name.localeCompare(b.name));
});
```

The server retains `entry_type` and `hidden_claim` only in the internal row, and attaches the joined contacts array:

```ts
// app/api/student/prospect-directory/route.ts:26-38
function mapDirectoryRow(
  row: Record<string, unknown>,
  contacts: ProspectDirectoryContact[]
): ProspectDirectoryCompanyRow {
  return {
    id: String(row.id),
    name: String(row.company_name ?? ""),
    industry: String(row.industry ?? ""),
    sizeLabel: String(row.size_locations ?? ""),
    signalHint: String(row.signal_hint ?? ""),
    hiddenClaim:
      typeof row.hidden_claim === "string" ? row.hidden_claim : null,
    contacts,
    isTarget: row.entry_type === "target",
  };
}
```

The public shape strips both `isTarget` and `hiddenClaim`, so the directory response never exposes `entry_type`, a target flag, or a raw scripted claim. It does carry the neutral `contacts` array:

```ts
// lib/tempo-prospect-directory.ts:171-182
export function toPublicProspectCompany(
  row: ProspectDirectoryCompanyRow
): ProspectDirectoryCompany {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    sizeLabel: row.sizeLabel,
    signalHint: row.signalHint,
    contacts: row.contacts ?? [],
  };
}
```

Each contact is a `{ name, title, department }` triple. The `ProspectDirectoryContact` type intentionally has no correct/trap flag, and the public company type has no hidden-claim field. Nothing in the directory payload distinguishes the right company/contact or reveals the scripted research exercise (`lib/tempo-prospect-directory.ts`).

Randomization uses Fisher–Yates. It chooses one target plus up to 24 non-target rows, then shuffles the combined result:

```ts
// lib/tempo-prospect-directory.ts:173-201
export function shuffleProspectCompanies<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    // swap
  }
  return next;
}

export function pickProspectDirectorySubset(
  rows: readonly ProspectDirectoryCompanyRow[],
  decoyCount = PROSPECT_DIRECTORY_DECOY_COUNT
): ProspectDirectoryCompanyRow[] {
  const target = rows.find((row) => row.isTarget);
  const decoys = shuffleProspectCompanies(rows.filter((row) => !row.isTarget)).slice(
    0,
    decoyCount
  );
  const combined = target ? [target, ...decoys] : decoys;
  return shuffleProspectCompanies(combined);
}
```

The chosen ID order is persisted in `attempts.stage_data.directoryCompanyIds`; subsequent calls restore the same order:

```ts
// app/api/student/prospect-directory/route.ts:101-121
const cachedIds = Array.isArray(stageData.directoryCompanyIds)
  ? stageData.directoryCompanyIds.filter((id): id is string => typeof id === "string")
  : [];

let selected = cachedIds.length > 0 ? orderByCachedIds(allRows, cachedIds) : [];

if (selected.length === 0) {
  selected = pickProspectDirectorySubset(allRows);
  // update attempts.stage_data.directoryCompanyIds
}
```

Current Tempo data has 25 rows (1 target, 3 crafted decoys, 21 fillers), while the display limit is 1 target plus 24 non-targets, so all 25 are normally shown (`scripts/config/tempo-directory-seed.ts:14-68`; `lib/tempo-prospect-directory.ts:28-29`).

**Cache edge case:** if only some cached IDs still exist, `selected.length` is nonzero, so the endpoint returns the smaller surviving list without refilling it. It regenerates only when zero cached rows survive (`app/api/student/prospect-directory/route.ts:106-121`).

### 2.2 Neutral visual treatment

All companies render through one `.map()` branch. Styling depends only on whether the student selected the card, never on `entry_type`:

```tsx
// components/tempo/stages/ProspectingCompanyDirectory.tsx:159-197
filtered.map((company) => {
  const isSelected = selectedCompanyId === company.id;
  return (
    <button
      key={company.id}
      className={`... ${
        isSelected
          ? "bg-surface border-2 border-secondary shadow-sm"
          : "bg-surface border-outline-variant hover:border-outline hover:shadow-sm"
      }`}
    >
      <h3>{company.name}</h3>
      <span>{company.industry}</span>
      <span>{company.sizeLabel}</span>
      <p>{company.signalHint}</p>
    </button>
  );
})
```

Because the API does not expose target/decoy/filler classification and the component has no classification branch, real, crafted-decoy, and filler rows are visually indistinguishable except for their factual content.

### 2.3 Dedicated server-side scoped chat

The browser no longer constructs or sends a system prompt through the generic `/api/chat` proxy. It calls the dedicated authenticated route with only attempt/company identity and that company's chat history:

```ts
// hooks/useProspectingWizard.ts
const res = await fetch("/api/student/prospect-research-chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    attemptId,
    companyId,
    messages: nextMessages.slice(0, -1),
    newMessage: trimmed,
  }),
});
```

`POST /api/student/prospect-research-chat` verifies that the attempt belongs to the authenticated student, scopes the company query to the attempt's `simulation_id`, and rejects a company outside the attempt's cached directory. It then reloads the full company row plus the three public contact facts:

```ts
// app/api/student/prospect-research-chat/route.ts
const { data: company } = await supabase
  .from("crm_prospect_directory")
  .select(
    "id, company_name, industry, size_locations, signal_hint, hidden_claim, entry_type"
  )
  .eq("id", companyId)
  .eq("simulation_id", String(attempt.simulation_id))
  .eq("is_active", true)
  .maybeSingle();

const { data: contactRows } = await supabase
  .from("crm_prospect_contacts")
  .select("contact_name, contact_title, department")
  .eq("company_id", companyId);
```

The contact query never selects `is_correct_contact`, `stronger_axis`, or `weaker_axis`. The prompt is built only on the server and retains the same neutral structure for every company: Tempo context, known company facts, all three contacts, no target ranking, and no recommendation of the "right," "best," or "primary" contact. The route calls the same `gpt-4o` model used by the former generic chat call and returns only `{ reply }`.

### 2.4 Deterministic `hidden_claim` behavior

The seed config gives the target and crafted decoys a `hiddenClaim`, and the generator inserts it into `crm_prospect_directory.hidden_claim`:

```ts
// scripts/config/tempo-directory-seed.ts:15-25
target: {
  companyName: "Summit Dental Group",
  // ...
  hiddenClaim:
    "Two front-desk staff have reportedly left this year, reportedly tied to phone-scheduling overload",
},
```

```ts
// scripts/generate-prospect-directory.ts:329-344
return {
  simulation_id: simulationId,
  company_name: entry.companyName,
  // ...
  hidden_claim: entry.hiddenClaim?.trim() ? entry.hiddenClaim.trim() : null,
  entry_type: entryType,
  is_active: true,
};
```

The internal `ProspectDirectoryCompanyRow` carries `hiddenClaim`, but `toPublicProspectCompany()` deliberately omits it. Therefore the raw field never enters the directory response, browser state, or chat request body.

For a designed company with a non-empty claim, `buildServerScopedResearchPrompt()` uses the number of prior student messages to schedule the exercise:

```ts
// lib/tempo-prospect-directory.ts
if (priorStudentMessageCount < 2) {
  // Keep the claim text out of the prompt and stay within known facts.
} else if (priorStudentMessageCount === 2) {
  // Include the specific claim exactly once in this answer and label it unverified.
} else {
  // Do not repeat the scripted claim or introduce another unsupported detail.
}
```

This means the claim is withheld on the first two student exchanges and supplied to the model for the third response, framed as plausible-sounding but explicitly unverified. The scheduling is deterministic in code; as with any prompt instruction, exact model compliance is not mechanically guaranteed.

Fillers have `hidden_claim = null`. They retain the previous generic drill unchanged: roughly one in four answers may include one plausible unsupported detail. This preserves neutrality because both designed companies and fillers can produce questionable claims, while only designed companies use authored content.

### 2.5 Per-company history isolation

Chat state is a dictionary keyed by company ID:

```ts
// lib/tempo-prospecting.ts:130-148
export type ProspectingWizardState = {
  // ...
  companyChats: Record<string, ChatMessage[]>;
  selectedCompanyId: string | null;
  // ...
};
```

Switching selection restores only that company's messages:

```ts
// hooks/useProspectingWizard.ts:168-183
const selectDirectoryCompany = useCallback(
  (companyId: string): void => {
    setChatInput("");
    setState((prev) => {
      const messages = prev.companyChats[companyId] ?? [];
      return {
        ...prev,
        selectedCompanyId: companyId,
        chatMessages: messages,
      };
    });
  },
  [persistState]
);
```

Sending a message reads and writes only `companyChats[companyId]`, and the API request receives only that company's prior messages:

```ts
// hooks/useProspectingWizard.ts:232-283
const companyId = state.selectedCompanyId;
const prior = state.companyChats[companyId] ?? [];
const nextMessages = [...prior, userMessage];

body: JSON.stringify({
  attemptId,
  companyId,
  messages: nextMessages.slice(0, -1),
  newMessage: trimmed,
}),

companyChats: { ...prev.companyChats, [companyId]: withReply },
```

Therefore switching companies does not leak one company's transcript into another company's request. `chatMessages` is a compatibility mirror of the active company's history, not a global mixed transcript.

### 2.6 Directory-backed Lead company and contact fields

There is no code path that copies the selected research card, chat answers, or signal directly into a CRM Lead. The student still creates the Lead. However, the Lead form now reuses the attempt-scoped directory for both Company and Contact selection:

```tsx
// components/crm/LeadDetailForm.tsx
type DirectoryCompanyOption = {
  name: string;
  contacts: { name: string; title: string }[];
};

const contactOptions =
  companyOptions.find((option) => option.name === values.companyName)?.contacts ?? [];
```

Company Name is a closed dropdown of directory companies. Contact Name is a second dropdown filtered to the selected company. Changing company clears an incompatible contact and title; choosing a contact autofills that contact's directory title into `contactTitle`. The title remains editable. `whyFit`, `trigger`, and `nextStep` remain student-authored controls, so research facts do not automatically become CRM judgment.

### 2.7 Multiple contacts per company (3-contact model)

Each company exposes three contacts. Both the research chat's Known Facts panel and the AI prompt show all three, so a student can ask "who are the contacts?" and get every name.

**Known Facts panel — tabbed layout.** The scoped chat renders a compact "Known Facts" card with four underlined tabs (Industry, Scale, Contacts, Trigger Signal); selecting a tab reveals that fact's full value below. The Contacts tab lists all three people, one per line, as `Name, Title`:

```tsx
// components/tempo/stages/ProspectingScopedChat.tsx:59-69
{
  id: "contact",
  label: "Contacts",
  value:
    company.contacts.length > 0
      ? company.contacts
          .map((contact) => `${contact.name}, ${contact.title}`)
          .join("\n")
      : "No contacts listed.",
  description: "Known people at this company. Decide who's worth reaching",
},
```

**Correct vs. trap contacts (designed companies).** For the target and each crafted decoy, one contact is the correct owner of the scheduling decision and the other two are designed traps: one that out-ranks the correct contact but sits in the wrong department (e.g. VP of Finance), and one that is in the right department but too junior to have purchasing authority (e.g. Front Desk Lead). The correct/trap distinction lives only in `crm_prospect_contacts` (`is_correct_contact`, `stronger_axis`, `weaker_axis`) and is never sent to the client (Section 2.1). Filler companies get three undesigned contacts with no correct answer to find.

**Design intent.** Splitting each company into three contacts turns "who do I actually reach out to?" into a second reasoning exercise layered on top of "which company?". Because the traps each beat the correct contact on exactly one axis (seniority *or* department relevance, never both), the student must weigh authority against relevance rather than picking the most senior or the most operationally-adjacent name by reflex. The neutral, alphabetized, flag-free payload and the anti-reveal prompt control (Section 2.3) keep the AI and UI from short-circuiting that judgment.

## 3. Lead Selection step

### 3.1 Important correction: no `classifyMatch()` or three-tier result exists

The current repository does **not** implement the requested/assumed `classifyMatch()` three-tier (`exact`/`close`/`none`) system. It uses one boolean function, `isCloseMatch()`. Consequently:

- accepted exact, prefix, substring, and fuzzy matches are all indistinguishable to callers;
- there is no `needsConfirmation` server field;
- there is no client “Did you mean?” confirmation flow.

The selection client's response type confirms the only handled fields are `success`, `managerNote`, and `error`:

```ts
// components/tempo/stages/ProspectingLeadSelectionStep.tsx:76-95
const body = (await res.json().catch(() => null)) as {
  success?: boolean;
  managerNote?: string;
  error?: string;
} | null;
// ...
await onSelected(pickedId);
```

### 3.2 Actual normalization and matching

Normalization trims, lowercases, and collapses whitespace:

```ts
// lib/string-similarity.ts:6-11
function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
```

**There is no company-suffix stripping.** Terms such as `LLC`, `Inc.`, `Corp.`, or `Group` are not specially removed. Some strings with extra suffixes may still pass because of the general prefix/substring rules.

The actual boolean matcher is:

```ts
// lib/string-similarity.ts:68-95
export function isCloseMatch(
  input: string,
  target: string,
  threshold = 0.8
): boolean {
  const normInput = normalizeForCompare(input);
  const normTarget = normalizeForCompare(target);

  if (normInput === normTarget) {
    return true;
  }

  // Prefix/substring: allow dropping trailing words (e.g. "Summit Dental", "Dana").
  // Guard short inputs so "S" / "D" do not trivially match.
  if (normInput.length >= 4) {
    if (normTarget.startsWith(normInput) || normInput.startsWith(normTarget)) {
      return true;
    }
    if (normTarget.includes(normInput) || normInput.includes(normTarget)) {
      return true;
    }
  }

  return similarity(normInput, normTarget) >= threshold;
}
```

Prefix and substring checks are bidirectional, but only the input must be at least four characters. Examples accepted by this logic include `Summit Dental`, `Dana`, and longer strings containing the target.

The fuzzy fallback uses ordinary Levenshtein distance:

```ts
// lib/string-similarity.ts:51-65
export function similarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  // ...
  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLen;
}
```

The default acceptance threshold is `0.8`, so the normalized similarity must be at least 80%. The implementation uses insertion, deletion, and substitution costs; it does not implement Damerau transposition as a single operation (`lib/string-similarity.ts:13-49`).

Both fields must pass:

```ts
// lib/tempo-lead-conversion.ts:10-33
export const CORRECT_COMPANY = "Summit Dental Group";
export const CORRECT_CONTACT = "Dana Reyes";

export function validateLeadIdentity(
  companyName: string,
  contactName: string
): LeadValidationResult {
  if (!isCloseMatch(companyName, CORRECT_COMPANY)) {
    return { success: false, reason: "company" };
  }
  if (!isCloseMatch(contactName, CORRECT_CONTACT)) {
    return { success: false, reason: "contact" };
  }
  return { success: true };
}
```

### 3.3 Reason-specific manager guidance

There is no longer any escalating attempt counter. Every failed validation returns one of two manager notes based on `validation.reason`:

```ts
// app/api/student/crm-leads/[leadId]/select/route.ts
const WRONG_COMPANY_NOTE =
  "Let’s focus this opportunity on Summit Dental Group. That’s the account I want us to pursue. Update the company on your lead and try again.";

const WRONG_CONTACT_NOTE =
  "I have a strong contact for us at Summit Dental Group: Dana Reyes. Update the lead with Dana as the contact and try again.";

const managerNote =
  validation.reason === "company" ? WRONG_COMPANY_NOTE : WRONG_CONTACT_NOTE;
```

The client displays `managerNote` in `ConvertFailureModal`; it does not perform a second classification or confirmation (`components/tempo/stages/ProspectingLeadSelectionStep.tsx:86-109`).

### 3.4 Successful selection timing

On success, the route first resets any previous selected Lead for the attempt to `new`, then marks the chosen Lead `selected`:

```ts
// app/api/student/crm-leads/[leadId]/select/route.ts:101-132
await supabase
  .from("crm_leads")
  .update({ status: "new", updated_at: updatedAt })
  .eq("attempt_id", attemptId)
  .eq("status", "selected");

await supabase
  .from("crm_leads")
  .update({ status: "selected", updated_at: updatedAt })
  .eq("id", leadId);

await syncLeadToAccountAndContact(supabase, attemptId, lead);

return NextResponse.json({ success: true });
```

After marking the Lead selected, the route non-fatally calls `syncLeadToAccountAndContact()`. This creates or updates the Account and primary Contact before the Opening Message step finishes, allowing the student to complete required CRM fields before Stage 2. If this early sync fails, the error is logged and selection still succeeds; `convertLead()` retries the same sync at Prospecting completion.

CRM Home and the Leads tab sort `selected` and `converted` Leads ahead of `new` Leads, then preserve creation order within each status group (`components/crm/CrmOverlay.tsx`).

## 4. Opening Message step

### 4.1 Fields and validation

The only authored field in this step is `openingMessage`. The UI also renders fixed context pills and non-interactive writing tips (`components/tempo/stages/ProspectingStepPanels.tsx:79-163`).

Word counting trims the string and splits on whitespace:

```ts
// lib/tempo-prospecting.ts:320-329
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}
```

Submission requires 20–120 words inclusive; no code verifies that the message actually mentions a trigger, leads with a business issue, includes a CTA, or has a professional tone (`lib/tempo-prospecting.ts:350-356`).

Also note that `canSubmitProspectingBrief()` does not re-check `selectedLeadId`. Normal navigation requires a selection to reach this step, but the final predicate itself checks only word count.

### 4.2 Transcript and badge relationship

The submitted transcript includes:

- all `companyChats`;
- `selectedCompanyId`;
- the active company's mirrored `chatMessages`;
- `openingMessage`;
- `selfCheck`.

It excludes `selectedLeadId`, `directoryCompanyIds`, `agentDesign`, and `agentCorrections` (`hooks/useProspectingWizard.ts:319-325`).

The entire JSON transcript is passed to GPT badge detection, so the model receives `openingMessage`. However, **no current Prospecting badge criterion explicitly awards a badge from the opening message itself**:

```ts
// lib/tempo-badges.ts:312-324
return `You are a sales coach evaluating a Tempo Prospecting stage submission
(JSON with chatMessages from an AI research agent, selfCheck, and draft openingMessage)
plus optional CRM log fields.

Badge criteria:
- pros_guardrails: chatMessages / selfCheck show ...
- pros_reusable_system: chatMessages show ...
- pros_directed_agent: chatMessages show ...
${crmCriteria}`;
```

`pros_real_trigger` and `pros_business_issue_led` are judged from converted CRM Lead fields, not from `openingMessage` (Section 6).

## 5. Stage completion — automatic conversion

### 5.1 Trigger path

The completion route runs conversion before badge detection, stage-score persistence, and attempt advancement:

```ts
// app/api/student/complete-stage/route.ts:53-84
if (stage === "prospecting") {
  const { data: selectedLead, error: selectedError } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("attempt_id", attemptId)
    .eq("status", "selected")
    .maybeSingle();

  if (selectedError) {
    console.error("[complete-stage] could not load selected lead for auto-convert:", selectedError);
  } else if (!selectedLead) {
    console.error("[complete-stage] prospecting completed with no selected crm_leads row ...");
  } else {
    try {
      const convertResult = await convertLead(supabase, attemptId, selectedLead.id as string);
      if (!convertResult.success) {
        console.error("[complete-stage] auto-convert failed after wizard selection:", ...);
      }
    } catch (err) {
      console.error("[complete-stage] auto-convert threw:", err);
    }
  }
}
```

### 5.2 Shared merge-based Account/Contact sync

`convertLead()` reloads the Lead for the same attempt, returns success immediately if it is already converted, and otherwise revalidates company/contact identity:

```ts
// lib/tempo-lead-conversion.ts:45-68
const { data: lead, error: loadError } = await supabase
  .from("crm_leads")
  .select("id, attempt_id, status, company_name, contact_name, contact_title, why_fit, trigger_event")
  .eq("id", leadId)
  .eq("attempt_id", attemptId)
  .maybeSingle();

if (lead.status === "converted") {
  return { success: true };
}

const validation = validateLeadIdentity(companyName, contactName);
if (!validation.success) {
  return validation;
}
```

Both successful selection and conversion call `syncLeadToAccountAndContact()`. The helper first loads any existing Account row, spreads its fields, and overwrites only the Lead-owned values:

```ts
// lib/tempo-lead-conversion.ts
const accountFields: Record<string, string> = {
  ...((existingAccount?.fields as Record<string, string> | null) ?? {}),
  accountName: companyName,
  primaryContact,
  whyFit,
  trigger: triggerEvent,
};

await supabase.from("crm_account_notes").upsert(
  {
    attempt_id: attemptId,
    notes: String(existingAccount?.notes ?? ""),
    fields: accountFields,
    updated_at: updatedAt,
  },
  { onConflict: "attempt_id" }
);
```

It applies the same merge rule to the primary Contact:

```ts
// lib/tempo-lead-conversion.ts
const contactFields: Record<string, string> = {
  ...((existingContact?.fields as Record<string, string> | null) ?? {}),
  name: contactName,
  position: contactTitle,
};

await supabase.from("crm_contact_notes").upsert(
  {
    attempt_id: attemptId,
    contact_key: "dana_reyes",
    role: String(existingContact?.role ?? ""),
    notes: String(existingContact?.notes ?? ""),
    fields: contactFields,
    updated_at: updatedAt,
  },
  { onConflict: "attempt_id,contact_key" }
);
```

This preserves student-entered Account profile data and strategy notes plus the Contact's buying role and relationship notes. After the sync, `convertLead()` marks the Lead converted:

```ts
// lib/tempo-lead-conversion.ts:141-151
await supabase
  .from("crm_leads")
  .update({ status: "converted", updated_at: updatedAt })
  .eq("id", leadId);
```

No transaction wraps the Account sync, Contact sync, and Lead status write. A later failure can therefore leave earlier writes committed.

### 5.3 Failure behavior at completion

If the selected Lead is missing, fails identity revalidation, or conversion throws, `complete-stage` logs the problem and continues. It does **not** block completion.

After the conversion block, the route still detects badges, upserts `stage_scores`, and advances `attempts.current_stage`:

```ts
// app/api/student/complete-stage/route.ts:132-174
badgesEarned = await detectTempoBadges(stage, transcript, crmFields);

await supabase.from("stage_scores").upsert({
  attempt_id: attemptId,
  stage,
  score,
  feedback,
  transcript,
  badges_earned: badgesEarned,
});

const next = getNextStage(stage);
await supabase
  .from("attempts")
  .update({ current_stage: next, total_score: totalScore })
  .eq("id", attemptId);
```

Conversion remains fail-open at the `complete-stage` API layer: conversion errors are logged and stage-score persistence can continue. The student-facing transition is nevertheless fail-closed for CRM profile completeness. The Prospecting-to-Discovery handoff disables **Begin Stage 2** until:

- all seven Account fields are non-empty (`accountName`, `industry`, `locations`, `region`, `primaryContact`, `whyFit`, and `trigger`);
- the primary Contact has `name` and `position`;
- the primary Contact has a non-empty **Role in Decision**.

Account strategy notes and Contact relationship notes remain optional. The green **Go to CRM: Add Account & Contact Notes** button opens CRM Home. Closing the CRM refreshes completeness, saving an Account returns to the Accounts list, and saving a Contact returns to the Contacts list (`components/tempo/HandoffModal.tsx`; `components/crm/CrmOverlay.tsx`; `lib/tempo-crm-account.ts`; `lib/tempo-crm-contact.ts`).

The handoff can be visually dismissed by clicking its backdrop, including while CRM completion is still gated, but dismissal is not stage acceptance. **Begin Stage 2** is the only action that persists acceptance. It calls the authenticated `POST /api/student/discovery-handoff` endpoint, which merges `discoveryHandoffSeen: true` into the existing `attempts.stage_data` object:

```ts
// app/api/student/discovery-handoff/route.ts
const existing = (attempt.stage_data ?? {}) as Record<string, unknown>;
await supabase
  .from("attempts")
  .update({ stage_data: { ...existing, discoveryHandoffSeen: true } })
  .eq("id", attemptId);
```

This separate acknowledgement closes the gap between database progression and student-visible progression:

1. Prospecting submission writes the `stage_scores` row and advances `current_stage` to `discovery`.
2. If `discoveryHandoffSeen` is absent, the simulation route renders `ProspectingWizard` with `initialDiscoveryHandoff`, not `DiscoveryStage`. Stage 2 therefore cannot appear behind the modal.
3. Leaving for the entry screen or dashboard does not bypass the handoff. The entry screen continues to display **Continue Stage 1: Prospecting**, removes Prospecting from the displayed completed-stage set, and returns to the same gated handoff.
4. After the student completes required CRM fields and clicks **Begin Stage 2**, the acknowledgement flag is saved and the browser enters Discovery. Future entry screens then display **Continue Stage 2: Discovery**.

```ts
// app/student/simulation/[id]/page.tsx
const discoveryHandoffSeen = attemptStageData.discoveryHandoffSeen === true;
const isDiscoveryHandoffPending =
  attempt.current_stage === "discovery" && !discoveryHandoffSeen;

const showTempoProspectingWizard =
  isTempoDefault && (!hasTestStageJump && isDiscoveryHandoffPending /* ... */);

const showTempoDiscovery =
  isTempoDefault &&
  (!hasTestStageJump &&
    attempt.current_stage === "discovery" &&
    discoveryHandoffSeen);
```

The restart endpoint clears `stage_data`, which also clears this acknowledgement and restores the correct fresh-run behavior.

## 6. Badge detection tie-in

All five Prospecting badges are GPT-judged. The route calls `detectTempoBadges()`, then stores returned IDs in `stage_scores.badges_earned`:

```ts
// app/api/student/complete-stage/route.ts:132-144
badgesEarned = await detectTempoBadges(stage, transcript, crmFields);

await supabase.from("stage_scores").upsert({
  // ...
  transcript,
  badges_earned: badgesEarned,
});
```

The evaluator uses `gpt-4o-mini` with JSON output:

```ts
// lib/tempo-badges.ts:519-538
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  max_tokens: MAX_BADGE_DETECTION_TOKENS,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Evaluate the following material:\n\n${material}` },
  ],
});
```

### 6.1 `pros_guardrails`

**Source:** submitted Prospecting transcript, specifically evidence in `companyChats`/active `chatMessages` and `selfCheck`. No CRM query feeds this criterion.

```ts
// lib/tempo-badges.ts:316-319
- pros_guardrails: chatMessages / selfCheck show the student verifying claims or flagging unverified AI output, not blind trust of whatever the AI produced
```

The judgment is probabilistic GPT evaluation; there is no deterministic check that the student correctly caught the prompt's injected unsupported claim.

### 6.2 `pros_reusable_system`

**Source:** submitted research chat transcript only:

```ts
// lib/tempo-badges.ts:318
- pros_reusable_system: chatMessages show a generalized reusable research approach, not a one-off hardcoded lookup for this account only
```

Although wizard state still defines `agentDesign`, that field has no current UI and is omitted from the submission transcript (`lib/tempo-prospecting.ts:140-145`; `hooks/useProspectingWizard.ts:319-325`).

### 6.3 `pros_directed_agent`

**Source:** submitted research chat transcript only:

```ts
// lib/tempo-badges.ts:319
- pros_directed_agent: chatMessages show the student pushing back, correcting, or refining the AI's output — not just accepting the first response
```

`agentCorrections` exists in state but is not included in the submitted transcript (`lib/tempo-prospecting.ts:143-144`; `hooks/useProspectingWizard.ts:319-325`).

### 6.4 `pros_real_trigger`

**Source:** `trigger_event` from the **converted** `crm_leads` row:

```ts
// app/api/student/complete-stage/route.ts:96-108
const { data: convertedLead } = await supabase
  .from("crm_leads")
  .select("trigger_event, why_fit")
  .eq("attempt_id", attemptId)
  .eq("status", "converted")
  .maybeSingle();

crmFields = {
  trigger: String(convertedLead.trigger_event ?? ""),
  whyFit: String(convertedLead.why_fit ?? ""),
};
```

```ts
// lib/tempo-badges.ts:305-309
- pros_real_trigger: CRM trigger field is specific and credible (a real timing reason), not generic filler
```

It does not read the directory's `signal_hint` directly and does not use `openingMessage` as its declared source.

### 6.5 `pros_business_issue_led`

**Source:** `why_fit` from the same converted `crm_leads` query:

```ts
// lib/tempo-badges.ts:305-309
- pros_business_issue_led: CRM whyFit leads with a plausible business issue/pain for the account, not a feature pitch
```

If conversion did not produce a converted Lead, `crmFields` remains `null`, and both CRM-dependent Prospecting badges are removed from the allowed set:

```ts
// lib/tempo-badges.ts:371-408
const CRM_DEPENDENT_BADGE_IDS = {
  prospecting: ["pros_real_trigger", "pros_business_issue_led"],
  // ...
};

if (crmFields !== null || ...) {
  return base;
}
const excluded = new Set(CRM_DEPENDENT_BADGE_IDS[stage]);
return new Set(Array.from(base).filter((id) => !excluded.has(id)));
```

## 7. The prospect-directory generator

### 7.1 How generic is it?

The core generation API accepts a `DirectoryConfig` with target, decoys, pools, and arbitrary numeric comparison axes. `ComparableAxis` is now generic over its subject type, so the same shape describes both company-level axes (`ComparableAxis<DirectoryEntry>`) and contact-level axes (`ComparableAxis<ContactEntry>`):

```ts
// scripts/generate-prospect-directory.ts:64-86
export interface ComparableAxis<TSubject> {
  name: string;
  keywords: string[];
  getValue: (subject: TSubject, config: DirectoryConfig) => number | null;
  regenerateFillerValue?: (config: DirectoryConfig) => Partial<TSubject>;
}

export interface DirectoryConfig {
  simulationId: string;
  target: DesignedDirectoryEntry;
  craftedDecoys: CraftedDecoyEntry[];
  // pools...
  contactDepartmentPool: string[];
  contactTitleSeniorityRank: string[];
  corePainDepartment: string;
  comparableAxes: ComparableAxis<DirectoryEntry>[];
  contactComparableAxes: ComparableAxis<ContactEntry>[];
}
```

The core comparison loops do not branch on axis name; they iterate `config.comparableAxes` (companies) or `config.contactComparableAxes` (contacts) (`scripts/generate-prospect-directory.ts:164-218,225-323`).

**Shared, simulation-agnostic name pool.** Diverse first names (with gender tags) and last names now live in `scripts/shared/person-name-pool.ts`, which contains zero Tempo-specific content and is meant to be reused by any future simulation:

```ts
// scripts/shared/person-name-pool.ts:8-11,113-121
export interface NamedPerson {
  firstName: string;
  gender: "male" | "female";
}

export function randomPerson(): NamedPerson & { lastName: string } {
  const person = pickRandom(FIRST_NAME_POOL);
  return { firstName: person.firstName, gender: person.gender, lastName: pickRandom(LAST_NAME_POOL) };
}
```

The generator imports `randomPerson()` and produces full first-and-last filler contact names (no more single-initial format):

```ts
// scripts/generate-prospect-directory.ts:382-390
function buildFillerContact(config: DirectoryConfig): ContactEntry {
  const person = randomPerson();
  return {
    contactName: `${person.firstName} ${person.lastName}`,
    contactTitle: pickRandom(config.contactTitlePool),
    department: pickRandom(config.contactDepartmentPool),
    gender: person.gender,
  };
}
```

However, the statement “zero hardcoded Tempo-specific content” is still **not fully true** of the generator itself (only the name pool is fully generic):

1. The CLI entry imports `tempoDirectorySeed` directly:

   ```ts
   // scripts/generate-prospect-directory.ts:650-652
   const { tempoDirectorySeed } = await import("./config/tempo-directory-seed");
   const result = await generateProspectDirectory(supabase, tempoDirectorySeed);
   ```

2. Generic filler signal text is hardcoded in the generator rather than supplied by config:

   ```ts
   // scripts/generate-prospect-directory.ts:117-123
   const FILLER_SIGNAL_HINTS = [
     "Steady operations with no notable public updates recently.",
     // ...
   ];
   ```

3. The exported parser is named `parseSizeNumber`, and `DirectoryConfig` still exposes `contactTitleSeniorityRank`/`corePainDepartment` (`scripts/generate-prospect-directory.ts:81-83,137-145`). The axis loops remain generic, but these names are concrete concepts in the generator's public surface.

The actual Tempo target, decoy descriptions, industry/name pools, contact sets, and axis definitions live in `scripts/config/tempo-directory-seed.ts`.

### 7.2 Comparable axes

For each filler and each axis, the generator compares the candidate with the target. If the filler is at or above the target, it invokes that axis's regeneration strategy up to ten times:

```ts
// scripts/generate-prospect-directory.ts:170-215
for (const axis of config.comparableAxes) {
  const targetValue = axis.getValue(config.target, config);
  let fillerValue = axis.getValue(cappedCandidate, config);

  if (targetValue === null || fillerValue === null) {
    console.warn(...);
    continue;
  }
  if (fillerValue < targetValue) {
    continue;
  }
  if (!axis.regenerateFillerValue) {
    console.warn(...);
    continue;
  }

  for (let attempt = 0; attempt < FILLER_GUARD_RETRY_MAX; attempt += 1) {
    cappedCandidate = {
      ...cappedCandidate,
      ...axis.regenerateFillerValue(config),
    };
    // accept once fillerValue < targetValue
  }
}
```

Tempo defines two **company** axes. The `seniority` axis now reads the company's primary contact title through the `resolvePrimaryContactTitle()` helper (which returns `contactSet.correct.contactTitle` for designed companies, or the inline `contactTitle` for fillers), since directory rows no longer carry a contact title column:

```ts
// scripts/config/tempo-directory-seed.ts:265-293
comparableAxes: [
  {
    name: "size",
    keywords: ["size", "location", "locations", "clinic", "clinics", "studio"],
    getValue: (entry) => parseSizeNumber(entry.sizeLocations),
    regenerateFillerValue: (config) => {
      const targetSize = parseSizeNumber(config.target.sizeLocations) ?? 8;
      const newSize =
        Math.floor(Math.random() * Math.max(1, targetSize - 1)) + 1;
      return { sizeLocations: `${newSize} locations` };
    },
  },
  {
    name: "seniority",
    keywords: ["senior", "director", "title", "seniority", "authority"],
    getValue: (entry, config) =>
      config.contactTitleSeniorityRank.indexOf(resolvePrimaryContactTitle(entry)),
    regenerateFillerValue: (config) => {
      const targetRank = config.contactTitleSeniorityRank.indexOf(
        resolvePrimaryContactTitle(config.target)
      );
      const validTitles = config.contactTitlePool.filter(
        (title) => config.contactTitleSeniorityRank.indexOf(title) < targetRank
      );
      const pick = validTitles[Math.floor(Math.random() * validTitles.length)];
      return { contactTitle: pick };
    },
  },
],
```

For the current Tempo config, both regeneration strategies produce values below the target: 1–7 locations versus 8, and a title ranked below Director of Operations.

Tempo also defines two **contact** axes, used to validate each designed company's two trap contacts against its correct contact. These axes have no `regenerateFillerValue` because filler contacts are undesigned and never validated. The `department_relevance` axis returns 0 outside the core-pain department, 1 for an in-department manager, and 2 for an in-department front-line role — so the "right department but too junior" trap can win relevance alone while the correct contact still wins on the seniority axis:

```ts
// scripts/config/tempo-directory-seed.ts:294-317
contactComparableAxes: [
  {
    name: "seniority",
    keywords: ["senior", "seniority", "vp", "director", "title", "authority", "outrank"],
    getValue: (contact, config) =>
      config.contactTitleSeniorityRank.indexOf(contact.contactTitle),
  },
  {
    name: "department_relevance",
    keywords: ["department", "operations", "relevant", "relevance", "pain"],
    getValue: (contact, config) => {
      if (contact.department !== config.corePainDepartment) {
        return 0;
      }
      if (contact.contactTitle === "Front Desk Lead") {
        return 2;
      }
      return 1;
    },
  },
],
```

### 7.3 Enforced guardrails and their limits

**Filler cap:** current Tempo fillers are regenerated below the target on both configured axes. Generically, though, “can never match/exceed” is stronger than the implementation guarantees. Missing values, a missing regeneration strategy, or ten failed retries produce warnings and allow generation to continue:

```ts
// scripts/generate-prospect-directory.ts:108-148
if (targetValue === null || fillerValue === null) {
  console.warn(...);
  continue;
}
if (!axis.regenerateFillerValue) {
  console.warn(...);
  continue;
}
// ...
if (!isCapped) {
  console.warn(...);
}
```

**One shared validator for companies and contacts.** The win-count logic now lives in a single generic function, `validateCompetitorsAgainstCanonical<TSubject>()`, that accepts any "candidates vs. canonical" pair and any axis list. It is called twice: once for company decoys vs. the target (`validateCraftedDecoys`, using `config.comparableAxes`) and once per designed company for its two trap contacts vs. its correct contact (`validateDesignedContactSets`, using `config.contactComparableAxes`):

```ts
// scripts/generate-prospect-directory.ts:284-323
export function validateCraftedDecoys(config: DirectoryConfig): void {
  validateCompetitorsAgainstCanonical({
    candidates: config.craftedDecoys,
    canonical: config.target,
    axes: config.comparableAxes,
    config,
    labelFor: (decoy) => decoy.companyName.trim() || "(unnamed crafted decoy)",
  });
}

export function validateDesignedContactSets(config: DirectoryConfig): void {
  const designedCompanies = [config.target, ...config.craftedDecoys];
  for (const company of designedCompanies) {
    // requires contactSet.correct + exactly 2 traps, then:
    validateCompetitorsAgainstCanonical({
      candidates: company.contactSet.traps,
      canonical: company.contactSet.correct,
      axes: config.contactComparableAxes,
      config,
      labelFor: (trap) => `${company.companyName} / ${trap.contactName}`,
    });
  }
}
```

`generateProspectDirectory()` runs both validators before any insert (`scripts/generate-prospect-directory.ts:549-550`).

**Required rationale fields:** every competitor (company decoy or trap contact) must have non-empty `strongerAxis` and `weakerAxis`; missing either throws:

```ts
// scripts/generate-prospect-directory.ts:236-241
if (!candidate.strongerAxis?.trim()) {
  throw new Error(`Competitor "${label}" is missing required field strongerAxis.`);
}
if (!candidate.weakerAxis?.trim()) {
  throw new Error(`Competitor "${label}" is missing required field weakerAxis.`);
}
```

**Exactly-2-traps shape check:** each designed company must declare a correct contact and exactly two traps, or `validateDesignedContactSets` throws (`scripts/generate-prospect-directory.ts:305-312`).

**At most one measurable win:** wins are axes where `candidateValue > canonicalValue`. More than one throws and names every winning axis:

```ts
// scripts/generate-prospect-directory.ts:243-259
const winningAxes = axes.filter((axis) => {
  const candidateValue = axis.getValue(candidate, config);
  const canonicalValue = axis.getValue(canonical, config);
  return (
    candidateValue !== null && canonicalValue !== null && candidateValue > canonicalValue
  );
});

if (winningAxes.length > 1) {
  throw new Error(
    `Competitor "${label}" out-performs the canonical subject on multiple axes: ${winningAxes
      .map((axis) => axis.name)
      .join(", ")}.`
  );
}
```

This is the same rule that keeps each company decoy to one strength, now also guaranteeing that neither trap contact beats the correct contact on both seniority and department relevance.

**Declared-vs-measured strength:** when there is exactly one measurable win, the generator checks whether `strongerAxis` contains any configured keyword for that winning axis. A mismatch logs a warning; it does not throw:

```ts
// scripts/generate-prospect-directory.ts:268-277
const winningAxis = winningAxes[0];
const declaredStrength = candidate.strongerAxis.toLowerCase();
const referencesWinningAxis = winningAxis.keywords.some((keyword) =>
  declaredStrength.includes(keyword.toLowerCase())
);
if (!referencesWinningAxis) {
  console.warn(...);
}
```

Zero measurable wins also produce only a warning (`scripts/generate-prospect-directory.ts:261-266`). `weakerAxis` is required to be present but is not semantically compared with axis values. Note that Tempo's `Office Manager`/`Practice Manager` correct contacts do not out-rank their own company decoy status, so `validateCraftedDecoys` emits the expected "does not measurably out-perform… on any configured axis" warning for the two decoys that win via trigger/scale narrative rather than a numeric axis.

### 7.4 Duplicate company-name prevention

The used-name set starts with the target and every crafted decoy, preventing fillers from exactly duplicating any of them:

```ts
// scripts/generate-prospect-directory.ts:403-414
const usedCompanyNames = new Set<string>([
  config.target.companyName,
  ...config.craftedDecoys.map((decoy) => decoy.companyName),
]);

const companyName = buildUniqueFillerCompanyName(config, suffixes, usedCompanyNames);
usedCompanyNames.add(companyName);
```

For a collision, the generator rerolls the prefix and later the suffix up to ten times. It then tries directional qualifiers before throwing:

```ts
// scripts/generate-prospect-directory.ts:357-377
for (let attempt = 0; attempt < FILLER_GUARD_RETRY_MAX; attempt += 1) {
  if (!usedNames.has(candidate)) {
    return candidate;
  }
  if (attempt >= FILLER_GUARD_RETRY_MAX / 2) {
    suffix = pickRandom(suffixes);
  }
  candidate = `${pickRandom(config.namePrefixPool)} ${suffix}`;
}

for (const qualifier of NAME_COLLISION_QUALIFIERS) {
  const qualified = `${candidate} (${qualifier})`;
  if (!usedNames.has(qualified)) {
    return qualified;
  }
}
```

This is exact, case-sensitive string uniqueness. It does not normalize case/whitespace, test similar-looking names, or validate that target and crafted-decoy names are mutually unique.

### 7.5 Manual seeding — companies idempotent, contacts always resynced

The generator is a manual CLI, not a gameplay service (`scripts/generate-prospect-directory.ts:1-5,640-668`).

Its idempotency changed with the multi-contact work. **Company rows** are still inserted only when the directory is empty for the `simulation_id`; if any company already exists, the company insert is skipped. **Contacts, however, are always resynced** on every run — the generator loads the current companies and calls `syncProspectContacts()` regardless of whether companies were freshly inserted:

```ts
// scripts/generate-prospect-directory.ts:561-599
let insertedCompanies = 0;
if ((count ?? 0) === 0) {
  // ...insert target + decoys + fillers
  insertedCompanies = rows.length;
} else {
  console.log(`Directory already has ${count} row(s) ...; syncing contacts only.`);
}

const { data: directoryRows } = await supabase
  .from("crm_prospect_directory")
  .select("id, company_name, entry_type")
  .eq("simulation_id", config.simulationId)
  .eq("is_active", true);

const insertedContacts = await syncProspectContacts(supabase, config, directoryRows);
```

`syncProspectContacts()` is destructive-then-rebuild: it deletes every existing `crm_prospect_contacts` row for the current company IDs, then inserts a fresh 3-contact set per company — designed sets for the target/decoys, generated sets for fillers (`scripts/generate-prospect-directory.ts:493-540`). This means re-running the generator regenerates all filler contacts (new random names) while keeping company rows stable, and it is how existing single-contact placeholder rows were corrected to the full 3-contact model. Because company IDs are preserved, attempt-cached `directoryCompanyIds` stay valid.

Each designed company inserts exactly one `is_correct_contact: true` row and two trap rows carrying `stronger_axis`/`weaker_axis`; fillers insert three rows with the first arbitrarily flagged `is_correct_contact: true` for schema consistency and no axis metadata (`scripts/generate-prospect-directory.ts:435-488`).

No Next.js route, component, hook, package script, or build hook invokes the generator. `package.json` contains only `dev`, `build`, `start`, and `lint`. Live gameplay only reads the rows already present in Supabase.

## 8. Design rationale

### 8.1 Neutral company treatment

The exercise is meant to test account reasoning, not visual pattern recognition. If the true target had a special badge, ordering rule, color, or richer card, students could identify it without evaluating industry fit, scale, trigger quality, and buyer relevance. Neutral treatment makes the facts—not the UI—the source of the answer.

### 8.2 One scoped chat per company

A single chat spanning every company invites prompts such as “rank these accounts” or “tell me which one is correct.” That delegates the core exercise to the model. Company-scoped chat keeps the AI in a research-assistant role: it can help investigate one account's known facts, but the student must perform the cross-company comparison.

### 8.3 Manual research-to-CRM transcription

There is intentionally no button that turns AI research into a completed Lead. Company and Contact are selected from directory-backed dropdowns to prevent identity drift, and Contact Title autofills from the chosen person. The student still decides and writes the fit hypothesis, trigger, and next step. Automatically copying AI output into those judgment fields would remove that practice and encourage uncritical acceptance of generated claims.

### 8.4 One strength per crafted decoy

A crafted decoy may look better than the target on one dimension so the student must notice why that tempting signal is insufficient. Allowing the decoy to dominate on multiple dimensions muddies the lesson and can make it objectively preferable. The one-axis rule keeps each decoy focused on one teachable misconception.

### 8.5 Config-driven comparison axes

Size and title seniority happen to matter for Tempo, but another simulation may care about urgency, technical maturity, budget authority, geography, regulation, or completely different attributes. Keeping comparison in `comparableAxes` lets a simulation author define those measurements and regeneration strategies without adding per-axis branches to the generator's core loop.

### 8.6 Deterministic string matching

Lead selection compares the Lead's stored company/contact names against fixed known answers. The current UI sources both names from directory-backed dropdowns, while the server still uses Levenshtein, prefix, and substring checks for compatibility with existing or externally edited rows. These checks are deterministic, immediate, free, and easy to test. A GPT call would add latency, cost, nondeterminism, and prompt sensitivity to a closed-set matching problem that does not require open-ended judgment.

### 8.7 Three contacts with single-axis traps

Real prospecting rarely stops at "which company"; the rep still has to pick the right person. Giving each designed company one correct contact and two traps — one senior-but-wrong-department, one right-department-but-too-junior — forces the student to separate authority from relevance instead of defaulting to the most impressive title or the person closest to the pain. Reusing the same single-win axis rule (Section 8.4) at the contact level keeps each trap teaching one clean misconception rather than being dismissible on multiple grounds. The correct/trap flags stay server-side and the payload is alphabetized so neither the UI nor the AI can shortcut the decision (Sections 2.1, 2.3).

### 8.8 Shared, simulation-agnostic name pool

Contact names were pulled out of Tempo's config into `scripts/shared/person-name-pool.ts` so any future simulation can generate plausible, culturally diverse, gender-tagged people without re-authoring a list. Keeping the pool free of Tempo-specific content is what lets the generator's filler-contact logic stay generic while the simulation-specific designed contacts remain in the Tempo config.

### 8.9 Server-only deterministic claim exercise

Keeping `hidden_claim` server-side prevents a student from discovering authored claims by inspecting the directory response or client state. Scheduling a designed claim on the third student exchange makes the exercise repeatable across attempts, while explicitly labeling it unverified teaches verification without teaching the model to state fabricated details as facts. Fillers retain the generic probabilistic drill so the presence of a questionable claim does not identify a designed company.

### 8.10 Required CRM completion before Discovery

The Account/Contact sync removes duplicate transcription for facts already captured on the selected Lead, but it deliberately leaves profile and buying-role fields for the student. The Stage 2 gate makes that CRM work consequential: students cannot begin Discovery until the Account context and primary Contact role are complete. Strategy and relationship notes stay optional so the gate enforces structured preparation without requiring speculative prose.

### 8.11 Explicit handoff acknowledgement

`attempts.current_stage` is advanced when Stage 1 is scored so completion data and downstream stage routing remain consistent, but that server-side value is not treated as proof that the student accepted the next-stage handoff. Persisting `discoveryHandoffSeen` separately preserves the distinction between **finishing Prospecting work** and **choosing to begin Discovery**. It also makes the CRM gate durable across navigation: reloading, exiting to the entry screen, or visiting the dashboard cannot reveal or enter Stage 2 before the student completes the required preparation and clicks **Begin Stage 2**.
