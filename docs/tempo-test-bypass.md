# Tempo Prospecting — test gate bypass

Local-only shortcut for faster Prospecting testing. **Gate logic is not weakened** — each gate keeps its normal condition and gains one short-circuit when the bypass is on.

## How to enable

Add exactly this line to **`.env.local` only** (not committed):

```bash
TEMPO_TEST_BYPASS_GATES=true
```

Restart the Next.js dev server after changing the file. Next only loads `.env.local` at process start — editing the file without a restart leaves the bypass off.

## How to disable

Delete that line from `.env.local` and restart the dev server. No code change and no revert commit — every gate returns to exact current behavior.

Any value other than the exact string `true` (including `false`, empty, or absent) leaves bypass **off**.

## Prop chain (server → client) — do not re-break this

`TEMPO_TEST_BYPASS_GATES` is **not** `NEXT_PUBLIC_`. Client bundles never see it. The flag is read once on the server and passed as ordinary data named `testBypass`:

1. **`app/student/simulation/[id]/page.tsx`** (SERVER)
   `const testBypass = process.env.TEMPO_TEST_BYPASS_GATES === "true"`
   → `<ProspectingWizard testBypass={testBypass} />`
   → `<CrmAccess testBypass={testBypass} />`

2. **`components/tempo/stages/ProspectingWizard.tsx`** (CLIENT)
   Accepts `testBypass`. Renders the amber TEST MODE banner from this prop.
   Passes it to `useProspectingWizard({ testBypass })`, `ProspectingStepPanels`, and `HandoffModal`.

3. **`hooks/useProspectingWizard.ts`** (CLIENT)
   Passes `testBypass` into `canAdvanceProspectingStep` / `canSubmitProspectingBrief`.
   Does **not** read `process.env` and does **not** take the flag from the wizard API body.

4. **`lib/tempo-prospecting.ts`** (shared, runs on client)
   `canAdvanceProspectingStep(stepIndex, state, testBypass = false)` —
   short-circuits when `testBypass` is true. **Never reads `process.env`.**

5. **`components/tempo/stages/ProspectingStepPanels.tsx`** → onboarding panel
   Forwards `testBypass` so the video-end gate can write `onboardingComplete` without waiting for `ended`.

6. **`components/tempo/HandoffModal.tsx`**
   Accepts `testBypass` and short-circuits the CRM Account/Contact Begin Stage 2 disable.
   Also readable from `CrmAccess` context as a fallback.

7. **Server-only autofill** — `GET /api/student/prospecting-wizard` calls `isGateBypassEnabled()` and seeds empty ICP / shortlist / lead / opening / CRM fields with `[TEST]` values. That does not drive the client banner or Next buttons; the page prop does.

If the amber banner is missing and gates still block: confirm `.env.local` has the exact line, then **restart** the dev server.

## Never set this in production

**Do not** put `TEMPO_TEST_BYPASS_GATES` in Vercel, any deployment environment, `.env.example`, committed env files, or deployment scripts.

## Gates affected

| Gate | Bypass behavior |
|------|-----------------|
| Onboarding video end | Treated complete; `onboardingComplete` written without waiting for video |
| ICP field completeness | Advance allowed; empty ICP fields auto-filled with `[TEST]` placeholders |
| Data Room shortlist (3) | Advance allowed; empty shortlist seeded with first 3 Data Room companies alphabetically by `company_name` (no `class` / `fit_rank` / answer-key columns) |
| Lead identity (Summit / Dana) | Select/convert validation short-circuited server-side; Summit + Dana lead seeded when missing |
| Opening message 20–120 words | Submit allowed; empty message auto-filled with a `[TEST]` draft in range |
| CRM Account + Contact before Stage 2 | Begin Stage 2 unlocked; empty required CRM fields auto-filled with `[TEST]` values |
| discoveryHandoffSeen | Still requires clicking **Begin Stage 2** (now unblocked by CRM bypass); acknowledgement is still persisted |

Auto-fill **never overwrites** non-empty student text.

## Visible indicator

When the server page passes `testBypass={true}`, Prospecting shows a persistent amber banner: **TEST MODE: gates bypassed**.

## Related

`?teststage=` (`hasTestStageJump`) is a separate stage-jump helper and is **not** reused by this bypass.
