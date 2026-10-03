# Rehearse — Code Guidelines

Reference this file for all changes to the Rehearse codebase.

## Repository

- Canonical GitHub remote: https://github.com/Rehearse3100/Rehearse
- Push to that `origin` by default. Do not use `Atharva309/Rehearse` or `rehearse2026/Rehearse` unless explicitly asked.

## What this app is

Next.js App Router product for sales-roleplay simulations. Students run class-assigned simulations; professors manage classes and content. The shipped simulation today is **Tempo** (Prospecting → Discovery → Presentation → Objection Handling → Negotiation). A parallel **legacy** stage runner exists so professors can build future non-Tempo simulations — it is not dead code.

## Folder structure (core)

```
Rehearse/
├── app/
│   ├── api/                    # Route handlers (student/, professor/, chat, score, tts)
│   ├── student/                # Student UI (dashboard, classes, simulation/[id])
│   ├── (teacher)/teacher/      # Professor UI
│   └── …                       # Auth/join pages
├── components/
│   ├── call/                   # Live Anam call shell (do not casually refactor)
│   ├── stages/                 # Legacy generic stage tree (future simulations)
│   ├── tempo/                  # Tempo-specific stages, lobbies, CRM UI
│   ├── Avatar.tsx              # Anam WebRTC surface (preserve AvatarRef)
│   └── SimulationRunner.tsx    # Legacy multi-stage runner
├── hooks/                      # Stage + voice orchestration
├── lib/                        # Domain logic + helpers (see Types / Helpers)
│   ├── constants.ts            # Business constants
│   ├── supabase/               # Browser + service clients
│   └── tempo-*.ts              # Tempo domain modules (types often colocated)
├── types/
│   └── index.ts                # Cross-cutting shared types only
├── supabase/
│   ├── FULL-SETUP.sql          # Only setup file — keep in sync with live DB
│   └── archive/                # Historical migrations — do not run
├── docs/                       # Current docs; docs/archive/ is historical
├── scripts/                    # Generators/tooling (do not point at live DB casually)
└── .env.example
```

## Architectural principles

These are the rules most often violated — treat them as hard constraints.

1. **Config over hardcoding** — Simulation-specific content lives in config / domain modules (`lib/tempo-*.ts`, constants, seed data), never baked into reusable runners or generic UI.
2. **Generic database, app-level validation** — Schema stays simulation-agnostic. Do not add simulation-specific `CHECK` constraints; validate in application code.
3. **No AI where deterministic logic works** — Gates, scoring, ICP checks, badge rules, and directory filters stay deterministic.
4. **AI must not leak the answer** — AI surfaces must never reveal, rank, or imply the correct answer. The deliberate exception is the student-authored Prospecting Step 3 agent, which ranks by the student's own criteria and must never see the answer key.
5. **Hidden layer stays server-side** — Answer-key and hidden-layer fields never reach any client payload or any AI prompt.
6. **Legacy simulation foundation is intentional** — `components/stages/`, `components/call/`, `SimulationRunner`, `AvatarCallStage`, and `PhoneCallStage` support future non-Tempo simulations. Do not delete or "consolidate away."
7. **Secrets stay server-side** — Never put secrets in `NEXT_PUBLIC_*`. Client code never reads `process.env` for a non-public variable; server code passes values down as data.
8. **API errors are wrapped** — Every API route uses try/catch and never returns raw errors, stacks, or internal details to the client.
9. **Third-party shapes are verified** — Confirm Anam, OpenAI, ElevenLabs, Deepgram, Supabase, etc. against current docs; never assume from memory.
10. **One DB setup file** — `supabase/FULL-SETUP.sql` is the only setup file. Any change applied to the live database must be written back into it. Archived SQL under `supabase/archive/` is historical and must not be run.

## Prospecting wizard steps

- Persist **stable step ids** (`currentStepId` from `PROSPECTING_STEPS`) in saved state — never rename or reuse an id.
- Adding a step needs no migration; unknown ids fall back to the first step.
- Removing a step is safe for the same reason. Do not reintroduce numeric `currentStep` or a version-migration chain.

## Live call stack (handle with care)

Do not casually consolidate or rewrite:

- `components/call/`, `components/Avatar.tsx`, `app/api/chat/`
- Anam session/token/avatar/streaming modules
- Tempo lobbies / call sessions / TopBar wrappers (`DiscoveryLobby`, `ObjectionHandlingLobby`, `DiscoveryCallSession`, `ObjectionHandlingCallSession`, `TempoCallSessionShell`, related TopBars)

Near-duplication in the call path is preferred over breaking live calls.

## Types

- **Domain types** live next to their `lib/` module (accepted pattern for Tempo and similar domains).
- **`types/index.ts`** is for genuinely cross-cutting types (auth roles, attempts, shared voice/chat shapes, `AvatarRef`, etc.).
- **UI must not import types from API route files.** If a route needs a shared type, move it to `lib/` or `types/`.

## Helpers (there is no `lib/utils.ts`)

Shared helpers live in focused modules under `lib/`, for example:

- `lib/constants.ts` — business constants
- `lib/api-auth.ts`, `lib/auth-helpers.ts`, `lib/student-session.ts` — auth/session
- `lib/supabase/server.ts`, `lib/supabase/client.ts` — Supabase clients
- `lib/audio.ts`, `lib/audio-playback.ts`, `lib/deepgram.ts` — media/STT helpers
- `lib/scoring.ts`, `lib/stages.ts`, `lib/persona.ts` — legacy/generic simulation helpers
- `lib/tempo-*.ts` — Tempo domain logic

Prefer a named module over a catch-all utils file.

## TypeScript

- Explicit parameter and return types on every function — no `any` unless unavoidable (comment why).
- Prefer `const`; use `let` only when reassigned.
- No unused imports or variables.

## Comments / JSDoc

- **File-level JSDoc required** on every file (what it is, what it connects to, why).
- **Function-level JSDoc required** on exported functions (inputs, outputs, behavior).
- **Not required** on small module-private helpers.
- Inline comments for non-obvious logic (chunk sizes, debounce, refs, gate rationale).
- Section dividers when a file has clear regions: `// ── Section Name ───`

## Naming

| Type | Convention |
|---|---|
| Functions | camelCase, verb-first: `fetchChatReply` |
| Components | PascalCase: `Avatar` |
| Constants | SCREAMING_SNAKE_CASE: `DEBOUNCE_MS` |
| Types | PascalCase: `ChatMessage` |
| Booleans | `is` / `has` / `should` prefix |

## Constants vs magic numbers

Put **business values** in `lib/constants.ts` (or a domain constants export): durations, thresholds, counts, limits, scoring weights, stage identifiers used as config.

**Not** magic numbers for this purpose:

- HTTP status codes (`400`, `404`, `500`)
- Tailwind class values and pure layout pixels in JSX

## Error handling

- API routes: try/catch around handler logic; success paths and status codes stay intentional and stable.
- On unexpected errors: log server-side; return a generic JSON message — never the raw error, stack, or internal details.
- External services: graceful failures; user-facing messages in the UI.
- No silent unhandled rejections.

## No dead code

Remove commented-out blocks, unused imports, and verified-orphan files — but do not delete:

- Legacy foundation (`components/stages/`, `SimulationRunner`, call stages)
- Deliberately kept Tempo helpers (e.g. Prospecting directory/chat modules kept for future use)
- Archived docs/SQL (move to `archive/`, never delete)

## Hard rules

- Do not commit `.env.local` or secrets.
- Do not rename or remove `AvatarRef`.
- Do not change `/api/chat` or `/api/tts` paths without an explicit product decision.
- Do not run ad-hoc SQL against the live Supabase project from cleanup/chores; update `FULL-SETUP.sql` instead.
- Do not modify Prospecting gate conditions, badge logic, or scoring logic unless the task explicitly requires it.
- Run `npm run build` with zero errors before commit/deploy.

## Env template

See `.env.example` for OpenAI, ElevenLabs, Deepgram (`NEXT_PUBLIC_DEEPGRAM_API_KEY`), Anam (`ANAM_API_KEY` — server only), Supabase, and `STUDENT_SESSION_SECRET`.
