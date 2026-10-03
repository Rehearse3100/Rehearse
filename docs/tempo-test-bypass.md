# Tempo — test gate bypass (all 5 stages)

Local-only shortcut for faster Tempo testing across Prospecting → Discovery →
Presentation → Objections → Negotiation. **Gate logic is not weakened** — each
gate keeps its normal condition and gains one short-circuit when the bypass is on.

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
   → every Tempo stage component + `<CrmAccess testBypass={testBypass} />`

2. **Stage components** (CLIENT) — ProspectingWizard, DiscoveryStage, PresentationStage, ObjectionHandlingStage, NegotiationStage
   Accept `testBypass`. Render `<TempoTestBypassBanner testBypass={…} />`.
   Pass it into hooks, prep/forms, lobbies, and `HandoffModal`.

3. **Shared gate helpers** (`lib/tempo-*.ts`)
   Optional `testBypass = false` short-circuits only. **Never read `process.env`.**

4. **`components/tempo/HandoffModal.tsx`**
   Short-circuits CRM log + Prospecting Account/Contact Begin Stage 2 disable.
   Also readable from `CrmAccess` context as a fallback.

5. **Autofill**
   - Prospecting: server `GET /api/student/prospecting-wizard` via `isGateBypassEnabled()`
   - Discovery / Presentation / Negotiation: client helpers in `lib/tempo-test-bypass-client.ts` (prop-driven; no env reads)

If the amber banner is missing and gates still block: confirm `.env.local` has the exact line, then **restart** the dev server.

## Never set this in production

**Do not** put `TEMPO_TEST_BYPASS_GATES` in Vercel, any deployment environment, `.env.example`, committed env files, or deployment scripts.

## Gates affected

| Stage | Gate | Bypass behavior |
|-------|------|-----------------|
| Prospecting | Welcome Briefing | Still opens first on a new sim; Next unlocked without watching (marks complete on advance) |
| Prospecting | ICP / shortlist / opening / CRM profile | Advance/submit allowed; empty fields auto-filled with `[TEST]` |
| Prospecting | Select Target Lead | Summit/Dana pre-seeded; **wrong company/contact still shows manager-note modal** (identity check is never bypassed) |
| Prospecting → Discovery | CRM Account + Contact before Stage 2 | Begin Stage 2 unlocked |
| Discovery | OPC prep (`canBeginDiscoveryCall`) | Begin unlocked; empty prep auto-filled with `[TEST]` |
| Discovery | Live call | Lobby shows **Skip Call (test)** — completes stage without Anam |
| Presentation | All 6 fields (`canSubmitPresentation`) | Submit unlocked; empty fields auto-filled with `[TEST]` |
| Objections | Live call | Lobby shows **Skip Call (test)** — completes stage without Anam |
| Negotiation | Scenario complete + AI work (`canSubmitNegotiation`) | Submit unlocked; scenarios + AI work seeded with `[TEST]` |
| Negotiation | 40-word Send Response | Send unlocked; empty reply uses a `[TEST]` placeholder |
| All handoffs | CRM activity log before Begin | Begin unlocked when bypass is on |

Auto-fill **never overwrites** non-empty student text.

`discoveryHandoffSeen` still requires clicking **Begin Stage 2** (now unblocked by CRM bypass); acknowledgement is still persisted.

## Visible indicator

When the server page passes `testBypass={true}`, every Tempo stage shows a persistent amber banner: **TEST MODE: gates bypassed**.

## Related

`?teststage=` (`hasTestStageJump`) is a separate stage-jump helper and is **not** reused by this bypass.
