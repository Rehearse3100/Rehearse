# Tempo Data Room v2 — generation report

Generated: 2026-08-31 (template-density guardrail + rewritten filler fact pools)  
Simulation ID: `00000000-0000-0000-0000-000000000002` (Sell Tempo to Summit Dental Group)

## What changed

- **2026-08-31 (this run):** Removed single-frame supplemental facts (`"Local coverage noted the … in the Mountain West region."`). Replaced with 33 hand-written facts per vertical (varied structure, subject, and length). Added generic `validateNoTemplateDensity` alongside the existing anti-correlation validator. Trap disqualifier insert index now biases toward the middle and end of the array.
- **2026-08-31 (prior):** Universal `research_facts` range 4–7; `validateNoStructuralClassCorrelation`; unique trap disqualifiers; vertical fact/signal pools.

## Template-density guardrail (generic, reusable)

`validateNoTemplateDensity(records, config)` in `scripts/generate-prospect-directory.ts` is **simulation-agnostic**. Field definitions live in `templateDensity` in `tempo-directory-seed.ts`.

**Skeleton algorithm:** lowercase, strip punctuation, keep first three and last three tokens (`toSentenceSkeleton`).

**Per-record failures:**

| Condition | When it throws |
|-----------|----------------|
| **Template density** | More than 2 strings in one record share a skeleton |
| **Odd-one-out** | 3+ strings share one skeleton and exactly one string is structurally distinct |

**Corpus failure:** any skeleton accounts for more than 15% of all strings in a configured field.

Runs in the same pre-insert pass as `validateNoStructuralClassCorrelation`; neither replaces the other.

### Validator proof (forced leaks)

| Test | Exact error |
|------|-------------|
| 3 templated facts (old frame) in one record | `Template density: record "Rainier Vision Group" has 3 strings sharing skeleton "local coverage noted in the region" in field "facts" (max 2)` |
| 3 templated + 1 distinct (odd-one-out) | `Template odd-one-out: record "Rainier Vision Group" has 3+ strings sharing skeleton "local coverage noted in the region" and one structurally distinct string in field "facts": "Practice-wide vendor selection for appointment software finished last quarter."` |

### Corpus skeleton stats (2026-08-31 run)

| Metric | Value |
|--------|-------|
| Total research fact strings | 349 |
| Most common skeleton | `indeed post seeks for evening shifts` |
| Corpus share | **0.9%** (well under 15% cap) |
| Facts containing `"in the Mountain West region"` | **0** |

## Anti-correlation guardrail (unchanged)

`validateNoStructuralClassCorrelation` still runs before insert. Production roster passes with every class spanning fact counts 4, 5, 6, and 7.

## research_facts distribution (2026-08-31 run)

| class | facts=4 | facts=5 | facts=6 | facts=7 |
|-------|--------:|--------:|--------:|--------:|
| `strong_fit` | 3 | 2 | 2 | 2 |
| `near_miss` | 4 | 4 | 4 | 4 |
| `trap` | 2 | 1 | 2 | 2 |
| `pass` | 8 | 8 | 8 | 8 |

## All 7 traps — full fact lists (human review)

Disqualifier marked with `*`. Index is 0-based.

### Northview Family Dentistry (`already_solved`) — disqualifier @ **5**

0. Patient forum threads praise the refreshed portal branding.
1. Local newsletter profiled the practice's school outreach program.
2. Website highlights same-day emergency appointment availability.
3. A trade journal interview quoted the owner on refreshing waiting-room signage.
4. Volunteers handed out toothbrushes at an elementary school health fair.
5. **\*** Operations team standardized on SlotEasy eighteen months ago with a multi-year agreement.

### Golden State Dental Alliance (`contracting`) — disqualifier @ **5**

0. Google reviews praise friendly hygienists at most locations.
1. Careers page lists hygienist openings at two locations.
2. Local newsletter profiled the group's community outreach program.
3. Website highlights same-day emergency appointment availability.
4. An Indeed post described flexible Tuesday hours for a sterilization technician.
5. **\*** Internal memo leaked to a trade blog cites a freeze on discretionary vendor projects through next fiscal year.

### Goldleaf Eye Care (`already_solved`) — disqualifier @ **3**

0. Local paper covered a donation of exam vouchers to a school district.
1. A blogger walked through the difference between medical and routine exams.
2. Facebook followers voted on favorite staff picks for frame styling advice.
3. **\*** Operations standardized on an incumbent scheduling platform after a competitive review two years ago.

### Harbor Physical Therapy (`franchise_power`) — disqualifier @ **3**

0. Community board listed a posture-screening event at a farmers market.
1. Careers page lists a billing specialist for the billing office.
2. Yelp reviewers mention flexible morning appointment slots.
3. **\*** Franchise agreement requires all clinics to purchase scheduling tools from an approved corporate catalog.

### Riverside Eye Care (`contracting`) — disqualifier @ **5**

0. Chamber of commerce spotlighted the group's downtown storefront.
1. Instagram campaign featured new designer frame arrivals.
2. Website notes complimentary frame adjustments during business hours.
3. Patients compared lens coating options in a lengthy Google Q&A thread.
4. Indeed listed weekend hours for an optician comfortable with pediatric fittings.
5. **\*** CFO memo suspended evaluation of new SaaS vendors through the next budget cycle.
6. Glassdoor reviewers liked the paid training for new optical sales associates.

### Glenwood Dental Care (`phantom_fit`) — disqualifier @ **4**

0. Instagram story featured staff volunteering at a health fair.
1. A chamber newsletter photo showed the team after a charity pro-bono day.
2. Patient forum threads discuss parking at the downtown location.
3. Community calendar listed a free dental-sealant clinic for teens.
4. **\*** Expansion headline was a rebranding of an existing location, not a new site opening.

### Beacon Chiropractic Center (`already_solved`) — disqualifier @ **3**

0. A radio spot promoted a posture screening at the farmer's market booth.
1. Reddit users debated which location has the easiest stroller access.
2. Careers page lists a chiropractic assistant opening.
3. **\*** Practice-wide vendor selection for appointment software finished last quarter with a locked-in term.
4. Yelp reviewers mention short visits for maintenance adjustments.

No trap has the disqualifier at index 0. All seven disqualifier sentences are distinct. No trap fact list is dominated by a shared sentence frame.

## Trap disqualifier sentences (unique)

1. Operations team standardized on SlotEasy eighteen months ago with a multi-year agreement.
2. Internal memo leaked to a trade blog cites a freeze on discretionary vendor projects through next fiscal year.
3. Operations standardized on an incumbent scheduling platform after a competitive review two years ago.
4. Franchise agreement requires all clinics to purchase scheduling tools from an approved corporate catalog.
5. CFO memo suspended evaluation of new SaaS vendors through the next budget cycle.
6. Expansion headline was a rebranding of an existing location, not a new site opening.
7. Practice-wide vendor selection for appointment software finished last quarter with a locked-in term.

## Verification results (2026-08-31 run)

| Check | Result |
|-------|--------|
| Template-density validator (production roster) | Pass |
| Forced template-density error | Documented above |
| Forced odd-one-out error | Documented above |
| Anti-correlation validator | Pass |
| No `"in the Mountain West region"` in facts | 0 |
| Top skeleton corpus share | 0.9% |
| Unique trap disqualifiers | 7/7 |
| `fit_rank = 1` | Summit Dental Group only |
| Class distribution | 9 / 16 / 7 / 32 |
| `crm_prospect_documents` | 0 rows |
| `app/api/student/data-room-chat/route.ts` | Unchanged |
| `npm run build` | Pass |

## Before running the generator

1. Run `supabase/archive/data-room-v2-migration.sql` if schema not yet applied.
2. Run: `npx tsx scripts/generate-prospect-directory.ts`
