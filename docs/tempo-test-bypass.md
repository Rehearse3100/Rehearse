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

## How the flag reaches the client (do not re-break this)

`TEMPO_TEST_BYPASS_GATES` is **not** `NEXT_PUBLIC_`. Client code must never read `process.env.TEMPO_TEST_BYPASS_GATES` (Next strips non-public env in the browser, so it would always look “off”).

Delivery path:

1. **Server page** `app/student/simulation/[id]/page.tsx` calls `isGateBypassEnabled()` and passes the boolean as `gateBypassEnabled` into `ProspectingWizard` and `CrmAccess`.
2. **API** `GET /api/student/prospecting-wizard` also calls `isGateBypassEnabled()`, runs autofill when on, and returns `{ state, gateBypassEnabled }`.
3. **Client hook** `useProspectingWizard` stores that boolean (from the page prop, then refreshed from the API body) and passes it into `canAdvanceProspectingStep` / `canSubmitProspectingBrief`.
4. **Banner** in `ProspectingWizard` reads `wizard.gateBypassEnabled` (the boolean), not the env var.
5. **CRM Stage 2 gate** in `HandoffModal` reads `gateBypassEnabled` from `TempoCrmGate` context (set by `CrmAccess` from the page prop).
6. **Lead identity** short-circuit runs only on the server inside `validateLeadIdentity` via `isGateBypassEnabled()`.

If the amber banner is missing and gates still block, check `.env.local` first — the variable is often missing after an env rewrite.

## Never set this in production

**Do not** put `TEMPO_TEST_BYPASS_GATES` in Vercel, any deployment environment, `.env.example`, committed env files, or deployment scripts.

## Gates affected

| Gate | Bypass behavior |
|------|-----------------|
| Onboarding video end | Treated complete; `onboardingComplete` auto-set if needed |
| ICP field completeness | Advance allowed; empty ICP fields auto-filled with `[TEST]` placeholders |
| Data Room shortlist (3) | Advance allowed; empty shortlist seeded with first 3 Data Room companies alphabetically by `company_name` (no `class` / `fit_rank` / answer-key columns) |
| Lead identity (Summit / Dana) | Select/convert validation short-circuited; Summit + Dana lead seeded when missing |
| Opening message 20–120 words | Submit allowed; empty message auto-filled with a `[TEST]` draft in range |
| CRM Account + Contact before Stage 2 | Begin Stage 2 unlocked; empty required CRM fields auto-filled with `[TEST]` values |
| discoveryHandoffSeen | Still requires clicking **Begin Stage 2** (now unblocked by CRM bypass); acknowledgement is still persisted |

Auto-fill **never overwrites** non-empty student text.

## Visible indicator

When the server reports bypass on, Prospecting shows a persistent amber banner: **TEST MODE: gates bypassed**.

## Related

`?teststage=` (`hasTestStageJump`) is a separate stage-jump helper and is **not** reused by this bypass.
