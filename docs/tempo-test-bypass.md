# Tempo Prospecting — test gate bypass

Local-only shortcut for faster Prospecting testing. **Gate logic is not weakened** — each gate keeps its normal condition and gains one short-circuit when the bypass is on.

## How to enable

Add exactly this line to **`.env.local` only** (not committed):

```bash
TEMPO_TEST_BYPASS_GATES=true
```

Restart the Next.js dev server after changing the file.

## How to disable

Delete that line from `.env.local` and restart the dev server. No code change and no revert commit — every gate returns to exact current behavior.

Any value other than the exact string `true` (including `false`, empty, or absent) leaves bypass **off**.

## Never set this in production

**Do not** put `TEMPO_TEST_BYPASS_GATES` in Vercel, any deployment environment, `.env.example`, committed env files, or deployment scripts. The variable is intentionally **not** `NEXT_PUBLIC_`, so it never ships to the browser. Client UI only sees a boolean the **server** reports.

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
