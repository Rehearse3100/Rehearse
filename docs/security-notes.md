# Security notes: fixes from the 2026-11-07 code review

Five fixes, made 2026-11-08. Each section says what changed, what still needs
doing, and how it was checked.

## Atharva runs this SQL once

**`supabase/2026-11-08-lock-anon-reads.sql`** in Supabase → SQL Editor. It is
idempotent, so running it twice is safe. The last result row should be all `true`.

The same changes are already in `supabase/FULL-SETUP.sql`. Until the file is run on
the live database:

- the anon key can still read classes and simulations;
- the login limit fails open: logins work, but there is no limit, and the server
  logs `[student-login] login limits unavailable, allowing:`.

---

## 1. Spoilers in the browser (H3)

**Fixed:**

- **Handoff messages.** They moved to `lib/server/tempo-handoffs.ts`, which refuses
  to load in a browser. (The `server-only` package isn't installed, so a `window`
  guard does the job, the same pattern as `lib/server/persona-prompts.ts`.)
- **What each stage gets.** The simulation page passes each stage only the messages
  it shows:

  | Stage | Messages it receives |
  |---|---|
  | Prospecting | Its own message. The Discovery message only once Stage 1 has been submitted. |
  | Discovery, Presentation, Objections | Their own message plus the next stage's brief, for the end-of-stage handoff. |
  | Negotiation | Its own message. |

  On Stage 1's Submit, the page doesn't have the Discovery message yet. It reloads
  the canonical URL, and the existing "handoff pending" path shows the Discovery
  handoff.
- **Stage descriptions** (`lib/tempo-simulation.ts`). They say "the account" or "your
  prospect" now, not the company or contact names.
- **Stage 1 opening-message step** (`ProspectingStepPanels.tsx`). It used to
  hard-code the answer: Dana Reyes, the 8th-location trigger, Summit Dental Group.
  It now shows the student's own chosen lead, read from the CRM.
- **Tester autofill** (`lib/tempo-test-bypass-client.ts`). It no longer names the
  contacts or spells out Discovery's findings.

**Audit** (`npm run build`, then the chunks the browser downloads):

- Entry page = `/layout` + `/student/layout` + the entry page.
- Simulation page = `/layout` + `/student/layout` + the stage page.
- Every Tempo stage shares the simulation page, so Stage 1 downloads every stage's
  components.
- No directory answer-key field or target/trap marker appeared in any chunk:
  `fit_rank`, `keyed_trigger`, `best_contact`, `trigger_quality`,
  `is_correct_contact`, "trap" and "target" were all absent.

Still in the chunks after this fix:

| Where it loads | Source | What it reveals |
|---|---|---|
| Every student page (student layout chunk) | `lib/tempo-badges.ts` (ask-first) | Badge descriptions: "Dana and Dr. Kim", "Quantified value came from Dana", "Summit-specific findings" |
| Entry and every stage (shared chunk) | `lib/tempo-discovery.ts` | Discovery prep brief: "Quick one before your call with Dana Reyes, Director of Operations at Summit Dental Group…" |
| Entry and every stage (shared chunk) | `lib/tempo-presentation.ts` | `customerName: "Summit Dental Group"`; the reference ROI "6,400 appts × 18% no-shows × $120" (a Discovery finding) |
| Entry and every stage (shared chunk) | `lib/tempo-negotiation.ts` | Negotiation scenario: "$1,432 a month across eight locations", "Dana also wants to add the ninth location" |
| Entry and every stage (shared chunk) | `lib/tempo-objections.ts` | Names; objection-scoring patterns ("growing to eight") |
| Stage page | `DiscoveryStageLayout.tsx` | "Dana Reyes", "Director of Operations, Summit Dental", "8 dental practices, Colorado" |
| Stage page | `DiscoveryStage.tsx`, `DiscoveryPreCallPrep.tsx` | "Dana Reyes" |
| Stage page | `DiscoveryCallSession.tsx` (locked) | "Dana Reyes" (persona name, connect error) |
| Stage page | `PresentationStageLayout.tsx` | "Dana Reyes", "Saul Kim" |
| Stage page | `ObjectionHandlingStageLayout.tsx` | "Dr. Saul Kim", "Dr. Kim built Summit from one chair to eight locations…" |
| Stage page | `ObjectionHandlingStage.tsx`, `ObjectionHandlingCallSession.tsx` (locked) | "Saul Kim", "Dr. Kim" |
| Stage page | `NegotiationStageLayout.tsx` | "Dr. Kim", "Saul Kim", "Summit Dental", the ninth-location ask |

Not shipped (checked in the chunks): `TEMPO_RESEARCH_SYSTEM_PROMPT` and
`AUTO_RESEARCH_CARDS` in `lib/tempo-prospecting.ts`. They are unused and tree-shaken,
so they're orphaned code to report, not remove.

**Plan for the rest (not implemented):**

1. Move each stage's scenario text into server-only modules under `lib/server/`:
   - contact names and titles, the account summary, the Discovery prep brief;
   - the presentation reference numbers, the objection and negotiation scripts;
   - scoring patterns that name the account.
2. Make the stage components and layouts generic. The simulation page passes the
   current stage's content as props, the way the handoffs work now. Stage N may
   also get stage N+1's brief.
3. Code-splitting alone isn't enough. Chunk URLs can be found, so content must not
   be in any client chunk at all.
4. Two parts need decisions first:
   - **Locked files:** `DiscoveryCallSession.tsx` and `ObjectionHandlingCallSession.tsx`
     hard-code the persona names. They must be unlocked to take the name as a prop.
   - **Badges** (`lib/tempo-badges.ts`, ask-first) load on every student page. They
     need generic descriptions, or descriptions delivered from the server with the
     results.
5. Add a test like `tests/tempo-handoff-delivery.test.ts` for each move: no client
   file reaches the module, and none holds its phrases.

## 2. Anon key reads class join codes and persona prompts (H2)

**Checked first:**

- Every browser Supabase client (`lib/supabase/client.ts`) is used by teacher
  screens signed in as `authenticated`, or for auth calls only.
- Student pages and routes use the server's service client.
- So nothing in the browser needs anon access to these three tables.

**Fixed** (in the SQL file and in FULL-SETUP.sql):

- dropped the `"anyone_read_classes"` policy;
- revoked anon `SELECT` on `classes`, `class_simulations` and `simulations`.

**Finding, not changed:**

- **Simulations.** The `"Students read published simulations"` policy has no `TO`
  clause: `is_published = true OR auth.uid() = teacher_id`. Any signed-in teacher
  can read every other teacher's published simulations, including
  `persona_system_prompt`.
- **Class links.** `"anyone_read_class_simulations"` (`USING (true)`) lets any
  teacher read every class↔simulation link.

**Proposal:**

- Students never read through Supabase auth, so restrict the first policy to
  `TO authenticated USING (auth.uid() = teacher_id)`.
- Restrict `class_simulations` to the teacher's own classes.

## 3. Leaderboard trusts the URL (M2)

`app/student/simulation/[id]/complete/page.tsx`:

- **Matching ids.** The `?attempt=` must belong to the student, and its
  `simulation_id` must equal the URL id. Otherwise the page goes to
  `/student/dashboard`, as it does for a missing attempt.
- **Leaderboard filter.** It filters by the attempt's `simulation_id`. The audience
  is the same as before: every completed attempt at that simulation, not per class.

## 4. Student login (M4)

**Same reply.** An unknown username and a wrong password both get 401 "Invalid
username or password." Before, an unknown username got 404.

**Failed-attempt limit** (`lib/student-login-limits.ts`, table
`public.student_login_failures`, service role only, indexed):

- **Limits.** 10 failures per username (lowercased) or 30 per IP in 15 minutes.
  After that, the route answers 429 "Too many attempts. Try again in a few minutes."
  It checks the limit before the password.
- **What counts.** A 429 isn't recorded, and neither is a success. Missing fields
  still get 400 and aren't counted.
- **IP.** The IP is stored only as a SHA-256 hash: the first `x-forwarded-for`
  entry, else `x-real-ip`. Without an IP, only the username limit applies.
- **Fail open.** If the table can't be read, the check logs and allows the login.
  If recording a failure fails, that is logged and ignored.
- **Unchanged.** Password hashing and sessions. Both login forms already show the
  route's `error` text.

**Open points:**

- **Timing.** An unknown username still answers faster than a wrong password,
  because the password check only runs for real users.
- **Hash strength.** An unsalted SHA-256 of an IPv4 address can be brute-forced, so
  treat `ip_hash` as pseudonymous.
- **Table growth.** Rows older than 15 minutes are never needed again. A periodic
  `DELETE … WHERE created_at < now() - interval '1 day'` would keep the table small.
- **Proxy headers.** I haven't confirmed against Vercel's docs that its proxy sets
  `x-forwarded-for` and `x-real-ip`.

## 5. The old directory seed (L6): report only

- **Current tree.** The old hard-coded seed (in
  `scripts/config/tempo-directory-seed.ts`, removed in `c58c8e6`) appears in no file
  of the current tree. `.git`, `node_modules`, `.next` and `.eval` were not searched.
- **How the generator gets its seed now.**
  - `scripts/generate-prospect-directory.ts` reads `TEMPO_DIRECTORY_SEED`: a positive
    whole number up to 4,294,967,295.
  - There's no default. If the variable is unset or invalid, the generator stops with
    a message and generates nothing.
  - `.env.example` has an empty placeholder.
- **Git history.** The old value is still in git history, which was not rewritten.
  The live seed should not be the old one.
