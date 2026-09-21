# New Supabase project setup

Ordered checklist after creating a brand-new Supabase project. The old project is gone; nothing can be recovered from it.

## 0. Paste the schema

1. Open **SQL Editor** in the new project.
2. Paste the entire contents of [`supabase/FULL-SETUP.sql`](../supabase/FULL-SETUP.sql).
3. Run once. The last result should be **one summary row** with:
   - `expected_tables_present` = **15**
   - `tempo_row_exists` = **true**
   - `anam_ids_populated` = **true**
   - `onboarding_videos_bucket_public` = **true**
   - `data_room_v2_columns_present` = **true**
4. Optional: run the same paste a second time to confirm idempotency (should still succeed).

## 1. Environment variables

Update these locally (`.env.local`) and in every deployment environment. Names found by scanning `app/`, `lib/`, `middleware.ts`, and `scripts/`:

| Variable | Used for |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase clients; onboarding video URL base (`lib/tempo-onboarding-video.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser / SSR authenticated client |
| `SUPABASE_SERVICE_ROLE_KEY` | Student APIs, CRM, directory generator, uploads |
| `STUDENT_SESSION_SECRET` | Student JWT sessions (class auth — not Supabase Auth) |

Also required for Tempo live calls / AI (not Supabase, but needed for the app):

| Variable | Used for |
|----------|----------|
| `OPENAI_API_KEY` | Persona replies, scoring, research chat |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | TTS |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Browser STT |
| `ANAM_API_KEY` | Discovery / Objection session tokens |

## 2. Auth settings (professors)

Professors sign up / sign in via **Supabase Auth** (`app/(auth)/login`, `register`). Profiles are created by the `handle_new_user` trigger from `raw_user_meta_data`.

Recommended for local/dev:

- Disable **Confirm email** (Authentication → Providers → Email) so professor signup works without an inbox, **or** use a real confirmation flow in production.
- Allow email/password provider.

Students do **not** use Supabase Auth; they use `students` + `STUDENT_SESSION_SECRET`.

## 3. Re-upload onboarding video + captions

**Do NOT run video generation** (`scripts/generate-heygen-video.ts`, `scripts/generate-onboarding-video.ts`, etc.) — those call HeyGen and cost money.

Local files that survived (gitignored) under `build/onboarding-pip-work/`:

| Local file | Upload to bucket path |
|------------|------------------------|
| `build/onboarding-pip-work/onboarding-pip-preview.mp4` | `onboarding-videos/tempo-welcome-v2.mp4` |
| `build/onboarding-pip-work/tempo-welcome-v2.vtt` | `onboarding-videos/tempo-welcome-v2.vtt` |

Notes:

- There is no local file named `tempo-welcome-v2.mp4`. The PiP composite that matches the app path is `onboarding-pip-preview.mp4` (upload it **as** `tempo-welcome-v2.mp4`).
- `tempo-welcome.mp4` in that folder is the older presenter-only export — not the object the app requests.
- Bucket `onboarding-videos` is created public by `FULL-SETUP.sql`.
- After upload, with `NEXT_PUBLIC_SUPABASE_URL` set, `lib/tempo-onboarding-video.ts` builds:

  `{SUPABASE_URL}/storage/v1/object/public/onboarding-videos/tempo-welcome-v2.mp4`  
  `{SUPABASE_URL}/storage/v1/object/public/onboarding-videos/tempo-welcome-v2.vtt`

## 4. Seed the prospect directory / data room

With `.env.local` pointing at the **new** project:

```bash
npx tsx scripts/generate-prospect-directory.ts
```

Expect ~64 companies and ~192 contacts for simulation `00000000-0000-0000-0000-000000000002`.  
`crm_prospect_documents` stays empty (code still reads the table).

Quick checks (SQL Editor):

```sql
SELECT class, COUNT(*) FROM public.crm_prospect_directory
WHERE simulation_id = '00000000-0000-0000-0000-000000000002'
GROUP BY class ORDER BY class;
-- expect strong_fit 9, near_miss 16, trap 7, pass 32

SELECT company_name FROM public.crm_prospect_directory WHERE fit_rank = 1;
-- expect Summit Dental Group only

SELECT COUNT(*) FROM public.crm_prospect_documents;
-- expect 0
```

## 5. Anam IDs

Recovered from `supabase/anam-ids-migration.sql` and already seeded into the Tempo row by `FULL-SETUP.sql`:

```json
anam_avatar_ids: {"discovery":"071b0286-4cce-4808-bee2-e642f1062de3","objections":"960f614f-ea88-47c3-9883-f02094f70874"}
anam_voice_ids:  {"discovery":"d338ed86-05e6-4ca0-a3fc-3d438ddb1a96","objections":"2e7fc41b-be40-49d8-a5ca-b26ab5775a33"}
```

If live Anam sessions fail (IDs revoked / wrong org), paste replacements using the optional `UPDATE` block at the bottom of `FULL-SETUP.sql`.

## 6. Recreate accounts

1. **Professor:** use `/register` or `/signup` (Supabase Auth) with role teacher in metadata as the app expects.
2. **Student:** register via student join/register flow against class join code `DEFAULT` (Rehearse Essentials) or a class you create.
3. Assign / confirm Tempo simulation is on the class (`class_simulations` is seeded for Essentials).

---

## Part 1 — Code inventory (source of truth)

### Tables referenced via `.from(...)`

| Table | Primary callers |
|-------|-----------------|
| `profiles` | auth helpers, login/register, middleware |
| `simulations` | teacher UI, entry pages, anam-session, class listings |
| `classes` | professor APIs, student join/register |
| `students` | student login/register |
| `student_classes` | enrollment, dashboards, restart |
| `class_simulations` | class ↔ sim assignment |
| `attempts` | nearly all student stage APIs |
| `stage_scores` | complete-stage, results, dashboards |
| `crm_log_entries` | crm-log, complete-stage, restart |
| `crm_account_notes` | crm-account, lead conversion, restart |
| `crm_contact_notes` | crm-contact, lead conversion, restart |
| `crm_leads` | crm-leads CRUD/select, complete-stage, restart |
| `crm_prospect_directory` | prospect-directory, data-room, research chat, generator |
| `crm_prospect_contacts` | same |
| `crm_prospect_documents` | data-room (+ generate-data-room.ts) |

### RPC

None. No `.rpc("...")` calls in app/lib/hooks/components/scripts.

### Storage buckets

| Bucket | Paths |
|--------|-------|
| `onboarding-videos` | `tempo-welcome-v2.mp4`, `tempo-welcome-v2.vtt` (also used by HeyGen upload scripts) |

### `onConflict` targets (require unique constraints)

| Target | Table | Constraint in FULL-SETUP |
|--------|-------|--------------------------|
| `attempt_id` | `crm_account_notes` | `UNIQUE (attempt_id)` |
| `attempt_id,contact_key` | `crm_contact_notes` | `UNIQUE (attempt_id, contact_key)` |
| `attempt_id,stage` | `crm_log_entries` | `UNIQUE (attempt_id, stage)` |
| `attempt_id,stage` | `stage_scores` | `UNIQUE (attempt_id, stage)` |

### Columns the code uses that old SQL files did **not** create

| Column | Table | Notes |
|--------|-------|-------|
| `decision_maker_rationale` | `crm_leads` | Written/read by crm-leads APIs; **missing from all historical SQL** |
| `shortlisted` status | `crm_leads` status check | Code inserts `shortlisted`; old check only allowed `new/selected/converted` |
| Data-room v2 columns | `crm_prospect_directory` | Lived in `data-room-v2-migration.sql`, not always folded into older FULL-SETUP |
| `in_data_room` + `crm_prospect_documents` | directory / documents | Lived in `crm-data-room-migration.sql` |
| `anam_avatar_ids` / `anam_voice_ids` | `simulations` | Lived in `anam-ids-migration.sql` |

### SQL-created columns with little/no direct app select (kept)

- `simulations.simli_face_id` — still selected in class simulation joins / types; historical Simli field
- `attempts.lead_selection_attempts` — written on restart
- Directory hidden columns (`why`, `keyed_trigger`, etc.) — generator + server chat; not all exposed to client
- `crm_prospect_documents.*` — table readable; currently 0 rows after generator

---

## Part 2 — Recovery findings (lost database)

### a. Persona prompts at runtime

- **Discovery / Objection live calls** read prompts from **code**, not the DB:
  - `lib/constants.ts` → `DANA_REYES_SYSTEM_PROMPT`, `DR_KIM_SYSTEM_PROMPT`
  - Wired in `components/tempo/stages/DiscoveryCallSession.tsx` and `ObjectionHandlingCallSession.tsx`
- `simulations.persona_system_prompt` / `product_context` are still **NOT NULL** and are shown in teacher/student listing UIs. Seed values come from prior `FULL-SETUP.sql` / `tempo-simulation-seed.sql` history (Summit Dental / Tempo copy). They are placeholders for the row, not the live Anam brain.

### b. Anam avatar / voice IDs

**Recovered** from `supabase/anam-ids-migration.sql` (also present in later `FULL-SETUP.sql` history):

- discovery avatar `071b0286-4cce-4808-bee2-e642f1062de3`
- objections avatar `960f614f-ea88-47c3-9883-f02094f70874`
- discovery voice `d338ed86-05e6-4ca0-a3fc-3d438ddb1a96`
- objections voice `2e7fc41b-be40-49d8-a5ca-b26ab5775a33`

Resolved at runtime from `simulations.anam_avatar_ids` / `anam_voice_ids` via `app/api/student/anam-session/route.ts` + `lib/tempo-anam-config.ts`.

### c. Tempo `simulations` row requirements

| Field | Value |
|-------|-------|
| `id` | **`00000000-0000-0000-0000-000000000002`** (hardcoded in `lib/constants.ts` as `TEMPO_SIMULATION_ID`) |
| `is_published` | `true` |
| `title` | Sell Tempo to Summit Dental Group |
| `persona_name` / `persona_role` | Dana Reyes / Director of Operations |
| `persona_system_prompt` / `product_context` | Non-empty seed text (see FULL-SETUP) |
| `anam_*` | Recovered maps above |
| Class link | Essentials class `…0001` via `class_simulations` |

---

## Local validation method (this change)

Docker / Homebrew Postgres CLI were unavailable in the agent environment. Validation used **PGlite** (Postgres-compatible WASM) with stub `auth` + `storage` schemas:

1. Ran adapted `FULL-SETUP.sql` **twice** (idempotent) — success.
2. Summary row checks all passed (15 tables, Tempo row, Anam IDs, public bucket, v2 columns).
3. Ran `generateProspectDirectory` against the local PGlite DB via a temporary client shim (not committed).
4. Verification: **64** companies, class split **9 / 16 / 7 / 32**, `fit_rank = 1` → Summit Dental Group, **0** documents, **192** contacts.

PGlite adaptations (not needed on real Supabase): skip `pgcrypto` extension (UUID builtins present), `EXECUTE PROCEDURE` alias, skip `NOTIFY pgrst`. The committed SQL keeps Supabase-native forms (`CREATE EXTENSION pgcrypto`, `EXECUTE FUNCTION`, `NOTIFY`).
