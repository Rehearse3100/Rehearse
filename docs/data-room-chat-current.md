# Data Room AI Assistant — scope rules and the extractive answer pipeline

Captured: 2026-10-13 (Data Room redesign: scoped questions, refs instead of names, name guard)
Updated: 2026-10-14 (eval fixes: no blank answers, no hidden-findings dumps, factual comparisons, out-of-scope reply, compact multi/All lines)
Updated: 2026-10-15 (Phase 2: a router call labels each question and a code-side policy decides which facts are allowed)
Updated: 2026-10-15 (Phase 3: extractive answers — the model only selects fact ids; code renders every answer from the stored text; overview and attribute questions need no model)
Updated: 2026-10-16 (Phase 4: in All companies mode the model never sees company data — one validated filter over public attributes runs in code; everything else gets a fixed reply)
Updated: 2026-10-16 (filter answers start with a count; "how many / which are / list the" questions with one condition read as filters; `risks` also covers `growth`)
Updated: 2026-10-16 (helpful answers: allowed findings shown directly; compare without a model; cap only for broad topics; narrower off-topic)
Updated: 2026-10-16 (exact detail: "That exact detail isn't publicly findable. Related facts:" when the question asks for one specific detail no fact states)
Updated: 2026-10-16 (opening sentence: the router writes one short framing sentence, checked by code, shown above the facts)
Updated: 2026-10-16 (opening sentence written last: its own call sees only the question and the finished answer, companies as "Company 1"…; the router no longer writes it)
Updated: 2026-10-16 (All companies filters combine up to 3 conditions; an unrecognised locations comparison is invalid; one count line above 20; valid filters used at low confidence in All companies mode)
Updated: 2026-11-06 (safety checks before the pipeline: 500-character cap, per-attempt message limits, moderation, English only — 2.1; neutral router examples)
Updated: 2026-11-06 (reply fixes: greetings, every match listed with no cap, any number of filter conditions, no opening above a first line the answer already has, a total count, meta replies, an `inappropriate` intent)
Updated: 2026-11-06 (reply fixes, part 2: openings only restate the facts shown, with the question's topic; only public facts that answer the question; follow-ups routed as the question they follow; two false drops in the opening check fixed)
Scope: `POST /api/student/data-room-chat`, its client `components/tempo/stages/ProspectingDataRoomChat.tsx`, the safety checks in `lib/data-room-chat-guard.ts`, and the pure helpers in `lib/data-room-chat-scope.ts`, `lib/data-room-chat-router.ts`, `lib/data-room-chat-filter.ts`, `lib/data-room-chat-policy.ts` and `lib/data-room-chat-render.ts`.

**Previous state (2026-08-30):** the student attached companies with a picker; the model saw every attached company by name, with research findings for all of them, and replied in free text. That design let an answer about one company drift onto another, and let names come from the model.

---

## 1. Scope: what one question is about

The client works out a scope for every question; the server trusts only the company ids in it and rebuilds everything else from the database.

### 1.1 Priority on send (`resolveSendScope`)

0. **Right after an All-companies list** (the previous question was about All companies and its answer listed companies; their ids come from the answer's items), a message with a **singular back-reference** ("it", "its", "this/that company", "this/that one", "the company"), no plural reference and no company name is about the listed companies — **even with All companies on**: one listed company → sent about it; two or more → "Which one did you mean?" with the listed companies (the first 10; the dropdown scrolls), and the pick is sent about that company. Sending it switches the All companies toggle off. Only while the student hasn't opened a different company since the list (product decisions 2026-10-16: 2–3 listed also ask, consistent with the 2–3-in-focus rule below; the rule applies with the toggle still on).
1. **All companies** toggle on → `{ mode: "all" }`.
2. **Companies picked from suggestions, plus companies named in the text** → `{ mode: "companies", companyIds }`.
   - A name is detected by its **full name** (any case, whole words) or by its **first word** when that word is non-generic, at least 4 letters, and belongs to exactly one company.
   - A first word shared by 2+ companies (e.g. "Summit") is **ambiguous**: nothing is sent; the student sees "Which one did you mean?" with the options in the dropdown above the input, and picking one sends.
   - More than 3 companies → "Ask about up to 3 companies, or turn on All companies." (not sent).
3. **Follow-ups: the previous question's companies** (one, or the same 2–3), when the message names no company, and the student hasn't opened a different company in the list since that question. Every sent question saves its **final resolved scope** and the **company open at send time** on its transcript entry (`{ role: "user", content, scope, openCompanyId }`), however the scope was chosen (picked, full name, unique first word, ambiguity choice, open company, or an earlier follow-up). The follow-up rule reads the latest question's entry and compares that open company with the one open now, so it also survives leaving the step, remounts and reloads. A previous All-companies question is not reused. Questions saved before 2026-10-15 have no `openCompanyId` and don't count. `openCompanyId` is never sent to the server.
   - With **2–3 companies in focus**, a message with a **singular back-reference** ("it", "its", "this/that company", "this/that one", "the company") and no company name is not sent: the "Which one did you mean?" dropdown opens with those companies, and the pick is sent about that company only. A plural reference ("they", "them", "their", "these", "those", "both", "each", "all", "either", "companies", "ones") anywhere in the message sends it to all of them, as before. All-caps "IT" (information technology) is not a back-reference.
4. **The open company** on the company page.
5. Nothing → "Open a company or type a company's name first." (not sent).

A plain text line next to the **All companies** toggle (above the input) shows the same scope live, follow-ups included ("Current: …", "Current: All companies", or "Open a company or type a company's name"). The toggle is a pill: a dotted outline (grey round dots) when off, a solid soft-black outline on hover, and a solid soft-black outline filled soft black (white text) when selected (`on-surface-variant`, not blue, so it doesn't stand out). Nothing else changes on hover (no shadow, tint or bold).

### 1.2 Generic words (computed from the roster itself)

`buildGenericWords(roster)` = words used in **3+ company names** + every word of every **industry label** + stop words (`a, an, and, at, by, co, company, corp, for, in, inc, llc, ltd, of, on, the, to`). Generic words never suggest, detect, or count as a company name.

### 1.3 Type-to-pick (no `@`)

- The current word (letters/digits before the caret) needs **3+ letters**; it suggests companies with a **non-generic word starting with it** (any word of the name; first-word matches listed first), up to 5, in a dropdown above the input (name, then "Industry · City").
- While the dropdown is open, **Enter** picks the highlighted one, **↑/↓** move the highlight, a click picks any, **Escape** closes it. When it is closed, **Enter** sends. "Which one did you mean?" uses the same dropdown (Enter or a click sends with that company).
- Picking replaces the typed fragment with the full name and adds the company to the scope (it stays picked while its full name is in the text).
- Selected companies (the ones the "Current:" line shows) are coloured in the input, and in sent questions.

### 1.4 Decision log

- Suggestions match the start of **any** non-generic name word (product decision, 2026-10-13).
- **Enter** picks a suggestion while the dropdown is open (it replaced Tab; product decision, 2026-10-15). To send with the dropdown open, press Escape first or click Send.
- Detection on send and the name redaction use **full names and first words only**. Name endings like "Market", "Hospital", "Vision", "Center" are ordinary words, so "what market are they in?" stays on the open company. The generator keeps first words near-unique (max 2 per roster).

---

## 2. The pipeline, end to end

The model never writes answer text. Every answer is built by code from stored facts.

1. **Request checks**: auth; the attempt belongs to the student; scope is All companies or 1–3 distinct ids, every one in this simulation's active Data Room roster (400 otherwise). **Safety checks** run here, before anything else (2.1): over 500 characters, the attempt's message limits, counting the message, moderation and the non-Latin-script check; any refusal is a fixed reply.
2. **Greeting or thanks** (the whole message is "hi", "hello", "thanks"…) → a fixed reply, before the roster loads, no model call (4.0).
3. **Unselected company mentioned** (1–3 company scope) → fixed reply, no model call (4.1).
4. **Question about company names** → answered from the roster, no model call (4.2).
4a. **Follow-up** (1–3 companies; the whole message is "tell me more", "more about that", "anything else on that?"…, 5.3): from here on it is routed and answered as the earlier question it follows, for the same companies.
5. **Router call** (one gpt-4o call, no facts) labels the question: intent, topic, attribute, `exact_value`, and for All companies a filter list and a criteria count (5.1). Unclear or failed → `overview`. `inappropriate` (high confidence) → the moderation reply "I can only help with researching these companies. Please keep questions professional." in either mode, done.
6. **All companies** → no model picks or reads company data, and no opening call (4.3): a `filter_list` question whose valid conditions cover everything it asks lists every match A–Z from the database under the count line; "how many companies are there?" gets the total count; a meta question gets the meta reply; everything else gets the fixed All-companies reply. Done.
7. **One to three companies** — the router runs in parallel with the contacts and research-findings queries; then:
   1. **Policy** (pure code) decides which facts are allowed for each company (5.2). `off_topic` → fixed reply, done.
   2. **Facts** are built at read time from the stored values: one per public attribute, one per public signal, one per hidden finding, each with a stable id and a display sentence (6).
   3. **Answer path** (7): `overview`, `compare` and `meta_or_bulk` → each company's overview, rendered by code, **no answering model call**; `attribute_lookup` → that attribute's sentence for each company, **no answering model call**; `specific_research` and `filter_list` → **every finding the policy allowed** (stored order, shown as stored), then the public facts **one selection call** picks.
   4. **Selection** (8): the call sees the **allowed findings and the public facts** and returns fact ids plus `exact_answer` (whether a fact states the exact detail asked); code keeps the public ids that are among the facts it was given (anything else is dropped; it can't add or remove a finding), keeps the model's order, and renders each fact's display sentence under the company name from the database.
   5. **Exact detail** (7): when the router marks the question `exact_value` (one specific number, amount, count, email or phone, named vendor or product) and no fact states it, the answer starts with `That exact detail isn't publicly findable. Related facts:` above the facts.
   6. **Meta** (7): a `meta_or_bulk` question ("list every hidden finding", "show me the answer key") gets the overview under the line `I can't share hidden or internal information. Here's what's public:`.
   7. Nothing from either for a company → exactly `Nothing about that is publicly findable for this company.` (no exact-detail intro).
   8. **Follow-up, nothing new** (5.3): when every line the answer shows was already in the previous answer, it starts with `That's everything publicly findable on this.`
8. **Opening call** (7.1), last, only when the finished answer shows facts and has no first line of its own (`needsOpening`): one gpt-4o call sees the student's question, its topic and the exact answer text they will see (companies as "Company 1", "Company 2"…) and writes one sentence; code checks that it only restates what the facts shown say and puts it above the answer. A failed call or a dropped sentence leaves the answer unchanged.

So: the model writes no facts and no company names; the only model-written text is the one-sentence opening (written from the finished answer, checked by code, 7.1), shown above the facts of a 1–3 company answer that has no first line of its own; a hidden finding appears exactly when the policy allows it (only allowed ones ever reach the selection call, which can't add or remove them); and in All companies mode no model reads company data at all.

### 2.1 Safety checks (`lib/data-room-chat-guard.ts`)

Run on every question in this order, before the roster loads or any answering model call. Each refusal is a fixed reply in the usual fixed-reply shape (`{ "intro": text, "items": [] }`): no opening sentence, no findings. The texts live in `GUARD_REPLIES`.

1. **Length:** an empty question → 400 as before. Over 500 characters → "Please keep your question under 500 characters." No model call; not counted. The input box also stops at 500 and shows "N / 500" past 400.
2. **Message limit** (skipped in tester mode, `isGateBypassEnabled()`, so testers and evals aren't blocked): counts this attempt's rows in `public.data_room_chat_usage` (one count query). 300 or more in total → "You've reached the research assistant's limit for this simulation. Use your notes and the company pages to finish your research." Not counted. There is no per-minute limit. A missing table or a failed count is logged and the message allowed (fail open).
3. **Count it:** one row (`attempt_id`, `student_id`, `created_at`); an insert error is logged and the question carries on. Restart deletes the attempt's rows (a missing table doesn't block it).
4. **Moderation:** OpenAI moderations, `omni-moderation-latest`, on the message only. Flagged in any self-harm category → "It sounds like you might be going through something hard. I'm only a research assistant, but you don't have to deal with it alone. In the US you can call or text 988 to reach the Suicide & Crisis Lifeline at any time; elsewhere, your local emergency number or a crisis line can help." Flagged for anything else → "I can only help with researching these companies. Please keep questions professional." A moderation error is logged and the question carries on (the rest only shows database facts).
5. **English:** more than 30% of the letters in a non-Latin script → "Please ask in English.", without calling the router. Otherwise the router's reply includes `"english"` (5.1); `false` with high confidence → "Please ask in English." (checked as soon as the router returns, on both the All-companies and the 1–3-company paths). A missing or invalid field counts as English.

Table (in `supabase/FULL-SETUP.sql`): `public.data_room_chat_usage (id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.attempts(id) on delete cascade, student_id uuid not null, created_at timestamptz not null default now())`, index on `(attempt_id, created_at)`, row level security on with no policies (only the server's service client touches it).

---

## 3. What data is loaded

All queries run in the `POST` handler.

| Query | Columns | Used for |
|-------|---------|----------|
| `attempts` (ownership) | `id, simulation_id` | Request check |
| `crm_prospect_directory` (whole in_data_room, active roster) | `id, company_name, industry, vertical, locations, metro, in_territory, size_note, online_booking, blurb, public_signals` | Scope check, generic words, out-of-scope check, name questions, and the public facts of **in-scope companies only**. Names are shown as headers (from here), never written by the model |
| `crm_prospect_directory` (**only when exactly one company is in scope**) | `research_facts` | Hidden facts; only the findings the policy allows are shown, as stored (never sent to a model). `parseResearchFindings` accepts `[{ text, topics }]` and the older `string[]` (untagged findings are never allowed) |
| `crm_prospect_contacts` (1–3 company questions only) | `company_id, contact_name, contact_title, department` for in-scope companies | The contacts fact |

All-companies questions load nothing beyond the roster: a filter reads `industry`, `metro`, `locations`, `in_territory` and `online_booking`, and the list shows `company_name`, `industry`, `locations` and `metro`.

**Deliberately NOT selected:** answer-key columns `class`, `subtype`, `fit_rank`, `trigger_quality`, `keyed_trigger`, `best_contact`, `why`; contact columns `is_correct_contact`, `stronger_axis`, `weaker_axis`.

---

## 4. Server replies without the router

### 4.0 Greetings and thanks (`lib/data-room-chat-scope.ts`)

Right after the safety checks (2.1) and before the roster loads, `parseGreeting(newMessage)` lowercases the message and removes every space, punctuation mark, symbol (emoji included) and combining mark. When what's left is exactly one of `hi`, `hello`, `hey`, `hiya`, `yo`, `goodmorning`, `goodafternoon`, `goodevening` it is a greeting; `thanks`, `thankyou`, `thx`, `ty`, `cheers` are thanks. Anything else (including "hi, what software do they use?") goes on through the pipeline. No model call; the reply is a fixed reply (`items: []`, no opening):

| Message | Mode | Reply (`greetingReply`) |
|---------|------|-------------------------|
| greeting | 1–3 companies | `Hi! I'm your research assistant. Ask me about the open company: its locations, software, hiring, budget or risks. To search across every company, switch to All companies.` |
| greeting | All companies | `Hi! I'm your research assistant. Here I can filter every company by industry, city or state, number of locations, territory and online booking. Open a company to research it in depth.` |
| thanks | either | `You're welcome! Ask me anything else about these companies.` |

The texts live in `lib/data-room-chat-scope.ts` (`GREETING_REPLY_COMPANIES`, `GREETING_REPLY_ALL`, `THANKS_REPLY`) because the guard file is not part of these reply fixes.

### 4.1 A question that mentions an unselected company

Right after the scope check, for a 1–3 company scope, the server looks for companies the question mentions that are **not** in scope (`findOutOfScopeMentions` → `detectCompanies`): a **full name**, or an **identifying first word** (non-generic, 4+ letters). Generic words never count, and a first word shared with an in-scope company counts as in scope. If any is found, no model is called and the reply is (names from the database):

```
Your question mentions {Name}, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it.
```

- Two or more unselected companies: "Your question mentions {A} and {B}, which aren't selected. Type their names and press Enter, or open them from the list, and I'll answer about them."
- A first word shared by two unselected companies (e.g. "Summit" with neither Summit selected): "Your question mentions {A} or {B}, which isn't selected. …" (the client normally asks "Which one did you mean?" before sending, so this is rare).
- All companies: never applies (every company is in scope).

### 4.2 A question about company names

`parseNameQuery(newMessage)` recognizes questions about company **names** (deterministic patterns, no AI):

| Kind | Recognized phrasings (any case) |
|------|---------------------------------|
| `startsWith` | "start / starts / starting with X", "begin / begins / beginning with X" (optionally "the letter X") |
| `contains` | "names with / containing / that contain / including X", "with X in the/their name", "a company / one / business / anything called or named X" |
| `list` | "list / show / give / tell / what are … company names", "names of (all) (the) companies", "list (all) companies" |

X is a quoted phrase, or **one word that ends the sentence**, so "what do they start with on Mondays?" or "does it start with a free trial?" are not name questions, and "tell me about them" never is. Checked in order, so starts-with and contains beat a list ("names of companies starting with S" → startsWith). Typo'd verbs count: any word starting "sta" or "beg", 5–9 letters, followed by "with" ("startign with S"); a typo'd verb needs a name word (name, company, business) in the question or a value of 1–2 letters, so "Are they staffed with nurses?" is not a name question.

The answer comes from the database (no model call):

- Search space = the question's scope: All companies → the whole roster; 2–3 companies → those; one company → that one only.
- Intro: `Companies whose names start with "S":` (or `contain "…"`; `Company names:` for a list). A single letter is shown in capitals.
- Items: **every** match, A–Z (no cap; 2026-11-06), each `{ companyId, companyName, text: "{Industry} · {N} locations · {Metro}" }`.
- No match: `No company names start with "S".`
- Name questions work the same with All companies on (they are answered before the router).

### 4.3 All companies: validated conditions, any number (`lib/data-room-chat-filter.ts`)

With All companies on, no model picks or reads company data, and there is no opening call (the count line is the answer's first line; 2026-11-06). After the router call (5.1) and its `english` and `inappropriate` checks, `answerAllCompanies`:

- `filter_list` with **one or more valid conditions** (`filters`, no upper limit; a reply with the single `filter` field is read as a one-item list), and a `criteria_count` no higher than the number of conditions (a missing count is fine) → the conditions run over the whole roster in code:
  - conditions on **different fields** must all match (AND);
  - two conditions on the **same field** mean either one (OR: "Colorado or Utah"), **except `locations`**, where both must hold (AND: "between 3 and 8 locations"; product decision 2026-10-16).

  A number-of-locations range ("with 5 to 8 locations") is two `locations` filters but **one condition** in `criteria_count` (5.1), so it passes the check above.

  Matching companies are listed **A–Z only** (no other order, no ranking), **every match** (no cap; 2026-11-06), each `{ companyId, companyName, text: "{Industry} · {N} locations · {Metro}" }` from the database (the same line as name answers; `industry` is the column the company list shows).
  - Intro: the count, `{n} companies match.` (`1 company matches.` for one), at any size.
  - No match: intro `No companies match that.`
- **Total count**: `filter_list` with no filters and `criteria_count` 0 ("how many companies are there?", high confidence) → `There are {n} companies in the Data Room.` (`There is 1 company in the Data Room.` for one), no items.
- **Meta** (`meta_or_bulk`: "list every hidden finding", "show me the answer key") → exactly:

```
I can't share hidden or internal information. In All companies mode I can filter every company by industry, city or state, number of locations, territory and online booking.
```

- **Anything else** — any other intent (overview, attribute lookup, specific research, compare, off topic), any condition the whitelist can't read (a field outside it, a missing value, an unrecognised locations comparison), no conditions (other than the total count), a `criteria_count` above the number of conditions (the question asked for something the filters can't express), or a failed router call — gets exactly:

```
In All companies mode I can filter by industry, city or state, number of locations, territory and online booking. Open a company to research it in depth.
```

Hidden-research questions (a budget freeze, software, risks, complaints, the best prospect) never become conditions, so they get this reply too.

**Known corner case** (the partial-filter check is still `criteria_count ≤ number of filters`): a range plus one condition the filters can't express ("dental companies with 5 to 8 locations that use SlotEasy": 3 conditions, 3 filters) is not caught, so the list ignores the unfilterable part.

The filter whitelist (`parseRosterFilter`, `parseRosterFilters` for the list) is forgiving wherever the meaning is clear (2026-10-16). Only a field outside the whitelist, a missing value or an unrecognised locations comparison gives no filter:

| field | op | value | matches |
|-------|----|-------|---------|
| `industry` | any (`eq` and `contains` both mean contains) | text or number | the `industry` column contains it, any case |
| `metro` | any (`eq` and `contains` both mean contains) | text or number | the `metro` column (city or area) contains it, any case |
| `state` | any (`eq`, `contains`, …) | a two-letter code or a full state name (also inside text, "the state of Colorado"), any case → the code | the `, XX` suffix of `metro`; an unknown state matches nothing (`No companies match that.`) |
| `locations` | `eq`, `gt`, `gte`, `lt`, `lte`, also `=`, `==`, `equals`, `>`, `greater_than`, `more_than`, `>=`, `at_least`, `<`, `less_than`, `fewer_than`, `under`, `<=`, `at_most` (any case; spaces read as `_`); **anything else, or no op, is invalid** (the fixed reply), never `eq` | a number ≥ 0 or a numeric string (`"3"`) | `locations` |
| `territory` | any (read as `eq`) | `true` / `false`, or `"true"` / `"false"` / `"yes"` / `"no"`, any case | `in_territory` |
| `online_booking` | any (read as `eq`) | `true` / `false`, or `"true"` / `"false"` / `"yes"` / `"no"`, any case | `online_booking` |

A value that can't be read (a non-numeric locations value, a yes/no field with "maybe", an empty string) counts as missing. A missing (unknown) value on a company never matches. An attribute question with All companies on gets the fixed reply too (product decision 2026-10-16).

---

## 5. Router and policy

### 5.1 Router call (`lib/data-room-chat-router.ts`)

`gpt-4o`, `temperature: 0`, `max_tokens: 300` (room for the decision and its filters), JSON mode. Its input is **only** the student's question (names redacted), their **last 3 questions** (any scope, redacted) and the scope kind (`one company` / `two or three companies` / `all companies`) — **no facts and no company data**. Reply: `{ "intent", "topic", "attribute", "filters", "criteria_count", "exact_value", "english", "confidence" }`. It writes no opening sentence (that is its own call, written last, 7.1); a stray `intro` in its reply is ignored.

- intent: `overview` | `attribute_lookup` | `specific_research` | `compare` | `filter_list` | `meta_or_bulk` | `off_topic` | `inappropriate`; topic: a question topic from `lib/data-room-research-topics.ts` or null; attribute: `industry` | `locations` | `metro` | `territory` | `online_booking` | `size` | `contacts` | null.
- `inappropriate` (2026-11-06): sexual or romantic questions, comments on someone's looks, personal-life questions about a person (their home address, family or relationships) and insults. With high confidence it gets the moderation reply `I can only help with researching these companies. Please keep questions professional.` (`guardReply("flagged")`) in both modes; low confidence falls back to `overview` like any other intent.
- filters (All companies `filter_list` only, otherwise null): a list of `{ "field", "op", "value" }` from the whitelist (4.3), one per condition the question asks for, **no limit on how many**; conditions on different fields all hold, two on the same field mean either one, except locations, where both hold; null when any condition is about something else (software, budget, staffing, reviews, risks, fit). A reply that still uses the single `filter` field is read as a one-item list. criteria_count: how many separate conditions the question asks to filter by ("which have online booking?" = 1; "fitness studios in Phoenix" = 2; a number-of-locations range counts as one, so "with 5 to 8 locations" = 1; 0 when it filters by nothing, as in "how many companies are there?", which is `filter_list` with criteria_count 0).
- exact_value: true when the question asks for one specific detail (a number, amount, count, email or phone number, or a named vendor or product); anything but exactly `true` reads as false (7).
- english: true when the question is written in English, typos and short questions included. Read by `parseRouterEnglish`: only `false` with `"high"` confidence means not English (fixed reply, 2.1); anything missing or invalid counts as English.
- Prompt rules: questions phrased as "how many…", "which are…" or "list the…" with one or more conditions are `filter_list`, read charitably ("how many are located retail?" → filters `[{"field": "industry", "op": "contains", "value": "retail"}]`); the count intro answers "how many". Two-letter uppercase tokens such as TX, CA or NY are US state codes. The prompt's examples are neutral: none names an ICP industry, territory place or state, or the ICP location bounds (a test checks this against `scripts/config/tempo-icp.ts`). When the scope is all companies, the router still returns the filters with "low" confidence.
- `off_topic` is only for questions clearly unrelated to researching companies (the weather, homework, jokes). Anything about a company is never off topic: revenue, finances, metrics, patients, people's roles or who decides are `specific_research` with the closest topic (revenue or finances → `budget`; people's roles or who decides → `ownership`). Email addresses, phone numbers or who to contact are `attribute_lookup` with attribute `contacts`, so the answer is the contacts list (2026-10-16).
- **Fails closed in code** (`parseRouterReply`): invalid JSON, unknown values, low or missing confidence, or `specific_research` without a topic → `overview`. **All companies mode only:** a `filter_list` reply whose filters are all valid is used whatever its confidence (code checks every condition; about 1–3 companies low confidence still means `overview`). For `filter_list` an unknown topic or attribute just becomes null (it never uses them), so it can't sink valid filters. Filters with any condition the whitelist can't read (4.3) become null (an All-companies question then gets the fixed reply; there is no maximum number of filters); a criteria count that isn't a whole number ≥ 0 (a number or a numeric string such as `"1"`) becomes null. A failed router call also counts as `overview`.
- Follow-ups ("tell me more about that") about 1–3 companies are recognised in code and routed as the question they follow (5.3). In All companies mode they are still understood from the recent questions only.

### 5.2 Policy (`lib/data-room-chat-policy.ts`, pure)

`allowedFacts({ intent, topic, scope, companies })` → `{ public, hidden }` per company (1–3 company questions; All companies never reaches the policy):

| Intent | One company | Two or three |
|--------|-------------|--------------|
| `specific_research` | public + **the findings, in stored order, whose topics intersect the question topic's fact topics: the first 4 (`MAX_SHARED_FINDINGS`) for a broad topic (`risks`, `fit`, `recent_changes`), every one for a single fact topic** (e.g. `amenities`, `staffing`) | public only |
| `overview`, `attribute_lookup`, `compare`, `filter_list` | public only | public only |
| `meta_or_bulk` | public only; answered as the overview (no model call) under `I can't share hidden or internal information. Here's what's public:` | same |
| `off_topic` | nothing; fixed reply `I can only help with researching these companies.` | same |
| `inappropriate` | never reaches the policy: the route answers with the moderation reply first (5.1); the policy itself is unchanged and would allow public only | same |

Allowed findings are always shown, as stored; no model chooses among them. The directory generator places each trap's disqualifier within the first 4 matches for `risks` and `fit` (it also still checks its own topics against the cap, which is stricter than the policy now needs).

Question topics → fact topics: `risks` → current_tools, budget, staffing, ownership, operations, growth; `fit` → operations, growth, current_tools, budget, staffing, ownership; `recent_changes` → growth, current_tools, staffing, operations; every other topic → itself.

### 5.3 Follow-ups (`lib/data-room-chat-router.ts`, 2026-11-06)

**Why:** "Are they hiring?" showed "Job listing: Spa Attendant", then "tell me more about that" got "Nothing about that is publicly findable for this company." The router saw the earlier questions, but the selection call saw only "tell me more about that", which names no subject, so it picked no fact; with no finding allowed for that company the answer was empty.

**Now** (1–3 companies only):

- `isFollowUpQuestion(newMessage)`: the whole message (lowercased, punctuation dropped, a lead-in such as "ok" or "can you" and a closing "please" removed) is one of: "tell / show / give me (a bit / a little) more (about / on that / this / it / those / these)", "say / share more…", "more", "more details / info / information (about / on that…)", "anything / something / what else / more about / on that…", "go on", "keep going", "elaborate (on that…)", "expand on that…". A message with its own subject ("tell me more about their budget"), about the companies themselves ("tell me more about them") or a plain "anything else?" is not a follow-up.
- `parseFollowUpContext(history, scope)` walks back from the latest question in the client-sent history over earlier follow-ups to the question they follow. Every question on the way must have the same companies as now (and a stored scope), otherwise it is not a follow-up. It returns that question, the questions before it, and the lines the latest answer showed, by company.
- The route then routes and answers **that question**: the router sees it (and the questions before it) instead of "tell me more", and so do the selection call and the opening call. An earlier question over 500 characters is not reused.
- When every line the new answer shows was already in the latest answer for that company, the answer starts with the fixed line `That's everything publicly findable on this.` (`withNothingNewIntro`; no opening call). Anything new → a normal answer with an opening.
- The history is client-sent: it only picks the question to route and the lines to compare against. Nothing from it is shown.

---

## 6. Facts (`lib/data-room-chat-render.ts`, built at read time; no data change)

| Id | Display sentence (built from the stored value) |
|----|-----------------------------------------------|
| `<companyId>:p:industry` | `Industry: Dental.` (title-cased `vertical`, else `industry`) |
| `<companyId>:p:locations` | `8 locations across Front Range, CO.` / `1 location in Denver, CO.` / `3 locations.` (no metro) |
| `<companyId>:p:metro` | `Metro area: Front Range, CO.` |
| `<companyId>:p:territory` | `In territory.` / `Out of territory.` (the card's wording) |
| `<companyId>:p:online_booking` | `Offers online booking.` / `No online booking.` |
| `<companyId>:p:size` | the stored `size_note`, ending with a period |
| `<companyId>:p:blurb` | the stored blurb |
| `<companyId>:p:contacts` | `Contacts: Dana Reyes, Director of Operations (Operations); Pat Lee, Owner.` (A–Z) |
| `<companyId>:s:<i>` | the stored public signal (index in `public_signals`) |
| `<companyId>:h:<i>` | the stored research finding text (index in `research_facts`) |

An attribute without a stored value has no fact. The overview's first line (the **headline**) is `{Industry} · {N} locations · {Metro}`.

---

## 7. Answer paths and rendering (one to three companies)

The response is always `{ intro, items: [{ companyId, companyName, text }] }`. Each item's `text` is one fact per line (the client shows line breaks); `companyName` comes from the database and is shown as the header. The intro is one line: the answer's own first line (the exact-detail line, the meta line, a count line, the follow-up line `That's everything publicly findable on this.`), else the checked opening sentence (7.1), a fixed reply, or empty. An answer never gets two first lines (2026-11-06).

| Path | Router intent | Answering model calls (the opening call, 7.1, comes after) | Items |
|------|---------------|------------------------------|-------|
| Overview | `overview`, `compare`, `meta_or_bulk`, `attribute_lookup` without an attribute | none | Every company in scope: headline, territory, online booking, blurb, public signals, in that order (compare = these overviews side by side; `meta_or_bulk` = these overviews under `I can't share hidden or internal information. Here's what's public:`) |
| Attribute | `attribute_lookup` | none | Every company in scope: that attribute's sentence, or the nothing-findable reply when it has no value |
| Select | `specific_research`, `filter_list` | one (sees the allowed findings and the public facts) | Each company: **every finding the policy allowed** (stored order; one company only), then the public facts the selection call picked. One company with neither → the nothing-findable reply. 2–3: only companies with a line; none at all → intro = the nothing-findable reply |

**Exact detail** (2026-10-16): when the router sets `exact_value` (the question asks for one specific number, amount, count, email or phone, or named vendor or product) and the selection call's `exact_answer` is false, the intro is `That exact detail isn't publicly findable. Related facts:` and the facts follow as usual. An `attribute_lookup` for `contacts` with `exact_value` (an email or phone; contacts never store them) gets the same intro above the contacts line, with no model call. An answer with no facts keeps the nothing-findable reply, without the intro.

`filter_list` about 2–3 companies uses one selection call over their public facts (product decision 2026-10-15). All companies: see 4.3.

### 7.1 Opening sentence (written last; `lib/data-room-chat-render.ts`)

Once the answer is fully built by code, and only when it shows facts and its intro is still empty (`needsOpening` = `hasFacts` and no first line of its own), the route makes one more call (1–3 company questions only; All companies never makes it): `gpt-4o`, `temperature: 0.3`, `max_tokens: 100`, JSON mode, reply `{"opening": string}`. A failed call, a bad reply or a dropped sentence → no opening and the answer goes out unchanged (never a fixed fallback).

**Input** (`buildOpeningMessages`): only the student's question (for a follow-up, the question it follows, 5.3), the router's topic for it on a `Topic:` line when there is one (2026-11-06), and the exact answer text they will see — the intro line if any (in practice empty, since an answer with its own first line gets no call), then each company's header and lines, blank line between blocks. Company names in both are replaced by `Company 1`, `Company 2`… in the order the answer shows them; any other company becomes "another company", and an identifying first word becomes the company whose lines it is in (or the one shown company with that word; "a company" when two shown companies share it). Nothing else: no finding the answer doesn't show, no contacts it doesn't show, no answer key, no ids, no history.

```
Question: What about Company 1's budget?
Topic: budget

Answer:
Company 1
Finance memo cites a freeze on discretionary software spend.
8 locations across Front Range, CO.
```

System prompt (`OPENING_SYSTEM_PROMPT`):

```
You write the opening sentence of an answer a student sees while researching companies in a sales-training Data Room. You are given the student's question and the exact answer text shown below your sentence; companies appear only as "Company 1", "Company 2" and so on. Reply with a single JSON object and nothing else:
{"opening": string}

Rules:
- opening: ONE short, friendly sentence (at most 30 words) that introduces the answer. It may summarise what the answer shows (for example "Four dental companies in Colorado offer online booking.").
- Never add a fact, number or detail that isn't in the answer.
- Only say what the facts shown say, in their own words where you can. Never add an action, change, timing or judgment the facts don't state (for example "updated", "launched", "recently", "new", "positive" or "strong").
- Lead with the fact that most directly answers the question. When the "Topic:" line says risks, fit or budget, lead with a concern if the answer shows one (an existing contract or vendor, a freeze, a mandate, or something not being what it seems). Never describe a concern as a positive.
- For a list, use the total from the "N companies match" line, never the number of companies shown.
- When the answer is about one company, call it "this company", never "one company" or "the company below".
- Never judge, rank or recommend a company. Never write "better than", "the best", "recommend", "go with", "I'd pick", "strong fit" or "good fit".
- Never name a company, and never refer to one as "Company 1", "Company 2" and so on.
- If the student asks which company is better, which one to pick, or whether one is a good prospect, say that call is theirs and the facts below can help (for example "Which one to pursue is your call; the facts below can help you compare.").
```

**Checks** (`openingRejection` names the first one that fails; `checkOpening` keeps the sentence only when none does; dropped, with no fallback):

- empty, over 200 characters, or more than one sentence;
- a ref (`C1`, `[C1]`) or a `Company 1`-style placeholder;
- judges a company ("better than", "the best", "recommend…", "go with", "I'd pick", "strong fit", "good fit");
- a full roster company name;
- a distinctive company-name word (a non-generic name word of 3+ letters), unless the student used it in the question or the facts shown use it and it isn't the first word of a company name (2026-11-06: "market" is fine when a fact says "farmers market"; "Summit" never is);
- a number that is in neither the answer as the student sees it nor the question, where a number the facts spell out counts as its digits (2026-11-06: "two locations" allows 2, "eighteen months" 18, "fourth office" 4th);
- a **claim word** whose stem the facts shown don't use (2026-11-06): updated, launched, introduced, new, recently, expanded / expanding, positive, praised, strong, growing, best, ideal, perfect, in any form ("praised" is fine when a fact says "praise", "growing" when one says "growth"; "newsletter" is not "new"). The question's words don't count. Real cases: Canyon, "What changed recently?", facts "Website FAQ notes online intake forms…", opening "updated its online intake forms" → dropped; Northview, "Any risks?", facts including the SlotEasy multi-year agreement, opening "has received positive feedback for its portal branding…" → dropped.

A dropped sentence logs which check failed (`[data-room-chat] opening dropped: <check>`; never the sentence), so a missing opening can be traced.

**Where it shows** (`withOpening`, gated by `needsOpening`):

- 1–3 companies: above the facts on the overview, compare, attribute and select paths, when the answer has no first line of its own.
- **Not** above a first line the answer already has, and no call is made (2026-11-06; before, the two lines could say the same thing twice): All companies filter lists (`{n} companies match.`), the exact-detail line `That exact detail isn't publicly findable. Related facts:`, the meta line `I can't share hidden or internal information. Here's what's public:`, and the follow-up line `That's everything publicly findable on this.`.
- Never on an answer with no facts, and no call is made: the nothing-findable reply (an answer whose blocks are all nothing-findable, or the nothing-findable intro), off-topic, out-of-scope, greetings, the total count, the All-companies fixed and meta replies, "No companies match that." and name questions. An answer with facts for some companies and nothing-findable for others gets the opening.

---

## 8. The selection call

`gpt-4o`, `temperature: 0`, `max_tokens: 500` (room for every fact id of up to three companies), JSON mode. No history. It sees the findings the policy allowed and the public facts, adds public lines, and says whether a fact states the exact detail asked; the allowed findings are shown regardless of its reply (it can't add or remove one).

System prompt (`SELECTION_SYSTEM_PROMPT`):

```
You choose facts that answer a student's question in a sales-training Data Room. Each line under "Facts" is one fact, written as "id: fact". Companies appear only as references such as C1, in the ids and in the question.
Reply with a single JSON object and nothing else:
{"fact_ids": string[], "exact_answer": boolean}

Rules:
- fact_ids: the ids of the facts that answer the question, most relevant first. Copy each id exactly as written; use only ids from the list.
- Choose only facts that answer the question. If it is about several companies, choose the facts that answer it for the companies listed.
- Choose a fact only if it actually answers the question. A fact about a different subject never answers it, even when it is the only fact listed for a company; returning no facts is fine.
- exact_answer: true only if a listed fact states exactly what was asked (for example the number, amount or count, the email address or phone number, or the named vendor or product); false otherwise.
- If no fact answers the question, reply {"fact_ids": [], "exact_answer": false}.
- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and choose only facts genuinely related to it (about the same subject); if none are, return no facts rather than loosely related ones.
- Never rank, recommend or judge the companies; only choose facts.
```

When the selection picks nothing and the policy allows no finding, the reply is the nothing-findable reply; for an exact-detail question the `That exact detail isn't publicly findable. Related facts:` line shows only above facts that are actually there (2026-11-06). This changes only which **public** lines the call adds: findings the policy allows are still always shown (5.2), so an unrelated finding that matches the question's topic still appears (see the change history for the Canyon "phones" case).

User message:

```
Question: What's [C1]'s annual revenue?
Facts:
C1:h:1: Finance memo cites a freeze on discretionary software spend.
C1:p:industry: Industry: Dental.
C1:p:locations: 8 locations across Front Range, CO.
…
C1:s:0: Opened 8th location three months ago
```

- Only the facts the policy allows are listed (5.2): the allowed findings (one company, specific research) and the public facts. In the prompt, ids use the company's ref instead of its database id (`C1:p:locations` for `<companyId>:p:locations`), so no database ids or names reach the model.
- Fact text is name-redacted for the model only (9); the student sees the stored text.
- **Verification** (`parseSelection`): every returned id must be one of the listed ids — other companies' ids, invented or repeated ids are dropped; finding ids it returns don't change which findings are shown. `exact_answer` counts only when exactly `true`. Invalid JSON or a wrong shape selects nothing. The model's order is kept.
- A selection call error returns the route's generic 500 (`Could not generate a Data Room response.`).

---

## 9. Refs and redaction (model input only)

- In-scope companies are labelled `[C1]`, `[C2]`, … in scope order (roster order for All companies, where refs only redact names in the router's input). The ref → company mapping stays on the server.
- The student's question and recent questions (router and selection calls): full names become their ref (in scope) or "another company" (out of scope); identifying first words likewise (left as typed when two in-scope companies share it).
- Fact text in a selection call: the company's **own full name** and its own first word (as written) become "the company"; any **other company's full name** becomes "another company".
- The opening call (7.1) uses its own labels, `Company 1`, `Company 2`… in the order the answer shows the companies, for both the question and the answer text; other companies become "another company".
- Answers shown to the student are rendered from the stored text (a blurb may contain the company's own name, exactly as on its card).

---

## 10. History

- The client keeps one transcript for the whole Data Room (in memory, mirrored to `localStorage` key `tempo-data-room-chat-v2-{attemptId}`; works without storage). Every message stores its scope.
- The transcript survives leaving the Data Room, moving between Prospecting steps, reloading and closing the tab. **Only Restart clears it** (`clearDataRoomChatFromStorage` in `RestartSimulationButton`). Before 2026-10-15 it lived in `sessionStorage`; an existing copy there is still read once and removed on Restart.
- The client still sends the transcript (`{ role: "user", content, scope }` and `{ role: "assistant", intro, items, scope }`). The server reads the student's questions (`parseHistoryQuestions`); the router uses the last 3, redacted. No selection or opening call sees history. For a follow-up about 1–3 companies (5.3) the server also reads each question's scope and the latest answer's `items` (`parseFollowUpContext`), only to pick the question to route and to compare lines; nothing from them is shown.
- The client reads the last answer's items itself for the list follow-up (1.1, step 0).

---

## 11. Request/response contract

Request:

```json
{
  "attemptId": "<uuid>",
  "scope": { "mode": "companies", "companyIds": ["<uuid>"] } | { "mode": "all" },
  "history": [ { "role": "user", "content": "…", "scope": { … } },
               { "role": "assistant", "intro": "…", "items": [{ "companyId": "<uuid>", "text": "…" }], "scope": { … } } ],
  "newMessage": "<string>"
}
```

Response: `{ "intro": string, "items": [{ "companyId", "companyName", "text" }] }` (unchanged in Phase 3, so the UI needs no change). The safety checks' fixed replies (2.1) use the same shape with `items: []`. No directory columns, fact ids or answer-key fields are returned.

---

## 12. Security boundary

| Layer | Columns | Reaches a model? | Reaches the student? |
|-------|---------|------------------|----------------------|
| Visible | `vertical`/`industry`, `locations`, `metro`, `in_territory`, `size_note`, `online_booking`, `blurb`, `public_signals`, contacts | As allowed facts in a selection call about 1–3 companies (names redacted), and in the opening call only as the finished answer shows them (names as `Company 1`…); never to the router; in All companies mode never (filters run in code and there is no opening call) | Yes, rendered from the stored values |
| Visible (lookup only) | `company_name` | No (replaced by refs or `Company 1`…) | Yes, as the header (from the database) |
| Hidden (allowed) | `research_facts` | Only the findings the policy allows, in the selection call (names redacted; it can't add or remove one), and in the opening call exactly the findings the answer shows | Exactly the findings the policy allows (5.2): a specific research question about exactly one company, matching topics, at most 4 for a broad topic; rendered from the stored text |
| Hidden (forbidden) | `class`, `subtype`, `fit_rank`, `trigger_quality`, `keyed_trigger`, `best_contact`, `why` | Never selected | Never |

---

## 13. Change history

- **2026-11-06, reply fixes (part 2):**
  - **Openings only restate the facts shown** (7.1): two prompt rules (only what the facts say, in their words, no added action, change, timing or judgment; lead with the most direct fact, a concern for risks, fit and budget, never a concern as a positive); the question's topic goes to the call on a `Topic:` line; a new code check drops a claim word (updated, launched, introduced, new, recently, expanded/expanding, positive, praised, strong, growing, best, ideal, perfect) whose stem the facts shown don't use.
  - **Only public facts that answer** (8): the selection prompt now says a fact about a different subject never answers, none is fine, and an exact-detail question gets only genuinely related facts. Policy-allowed findings are unchanged and still always shown. Known gap: in the Canyon "What's going on with their phones?" case, both lines shown ("Website FAQ notes online intake forms…", "…medical directors oversee injectable services") are research findings tagged `operations`, which the policy allows for that topic; this fix cannot remove them.
  - **Follow-ups** (5.3): "tell me more about that" was answered from its own words by the selection call, which found nothing. It is now routed and answered as the question it follows; the same lines again come under `That's everything publicly findable on this.`
  - **Missing openings** (7.1): two checks dropped sentences that only restated the facts: a company-name word the facts shown already use (for example "family", "community", "regional", "market" in a fact) and digits for a number the facts spell out ("two", "eighteen", "fourth"). Both fixed; a dropped sentence now logs which check failed.
- **2026-11-06, reply fixes (part 1):** greetings and thanks get a friendly fixed reply before the roster loads (4.0); name answers and All-companies filter lists show every match (removed: `NAME_QUERY_MAX_RESULTS` = 15 with its "(the first 15, A–Z), and {n} more" intro, and `MAX_FILTER_RESULTS` = 20 with its "Showing the first 20…" line); any number of filter conditions (removed: `MAX_FILTER_CRITERIA` = 3), with a locations range counted as one condition in the router prompt; the opening sentence is skipped when the answer already has a first line (count line, exact-detail line, meta line), so All companies makes no opening call; "how many companies are there?" (`filter_list`, `criteria_count` 0) gets the total count; `meta_or_bulk` gets "I can't share hidden or internal information…" (the overview under it with 1–3 companies; its own reply in All companies); a new router intent `inappropriate` gets the moderation reply. The All-companies fixed reply drops "up to 3 at a time". Unchanged: the safety checks, the policy, the scope logic, the reply shape, compare and the other fixed replies.
- **2026-11-06, no per-minute limit:** the 20-questions-in-5-minutes limit and its "You're asking quickly…" reply are removed; only the 300-per-attempt limit remains (one count query).
- **2026-11-06, safety checks (2.1):** before the pipeline, a 500-character cap (and `maxLength` 500 with an "N / 500" counter past 400 on the input), per-attempt limits from the new `data_room_chat_usage` table (20 in 5 minutes, 300 in total; not in tester mode; fail open), counting each question, OpenAI moderation (`omni-moderation-latest`; self-harm gets a 988 Lifeline reply, other flags a "keep it professional" reply; errors carry on), and English only (a non-Latin-script check, then the router's new `english` field). Restart clears the attempt's usage rows. Router prompt examples made neutral (no ICP industries, territory places or states, or ICP location bounds).
- **2026-10-14:** compact multi/All lines; factual comparisons allowed (ranking refused); "never leave both empty" plus an empty-answer retry (blank answers came from format rules that let the model say nothing); Tempo product context and an "up to 4, most relevant first" findings line; hidden-findings requests answered like general questions.
- **2026-10-15, Phase 2:** the router and the code-side policy replaced the prompt's withholding rules; one exact sentence for "nothing found".
- **2026-10-15, Phase 3:** extractive answers. Removed: the free-text answering prompt (and its single / multi / All prompt modes and compact lines), the scan of model prose for company names, refs and the words "references"/"labels", the stricter retry and the empty-answer retry with their reminders, the fallback reply `I can only answer about the companies in your question.`, the meta-or-bulk question substitution, and history in the answering call (`selectHistoryForScope`). Kept: id verification, scope checks, the out-of-scope reply, name questions, the router's fail-closed parsing, and name redaction for model input.
- **2026-10-16, Phase 4:** All companies mode runs one validated filter in code (4.3); every other All-companies question gets the fixed one-thing-at-a-time reply. Removed: the All-companies answer paths (headline-only overview, one selection call over every company's facts, compare with one call per company for all companies and its 8-at-a-time limit). The compact multi/All prompt lines were already removed in Phase 3. Added: the list follow-up (1.1, step 0).
- **2026-10-16, helpful answers:** specific research shows every finding the policy allows (stored order) and the selection call only adds public lines (it never sees a finding); compare renders each company's overview with no model (removed: the per-company selection path); the 4-finding cap applies only to broad topics (`risks`, `fit`, `recent_changes`); `off_topic` is only for clearly unrelated questions, and company questions about revenue, finances, emails, metrics or patients are `specific_research`; the selection prompt returns no facts when the exact thing asked for isn't stated.
- **2026-10-16, exact detail:** the router adds `exact_value`; the selection call sees the allowed findings and public facts again (it still can't add or remove a finding) and returns `exact_answer` instead of `no_relevant_facts`; an exact detail no fact states gets the intro `That exact detail isn't publicly findable. Related facts:` (also above contacts for email or phone questions).
- **2026-10-16, opening sentence:** the router writes a one-sentence `intro` (no extra model call; `max_tokens` 150 → 300), checked by code and shown above the facts (7).
- **2026-10-16, up to 3 conditions:** the router returns `filters` (1–3; a single `filter` is still read as a one-item list); `MAX_FILTER_CRITERIA` 1 → 3; different fields AND, the same field OR, except locations AND (product decision: ranges work); refused when more than 3, any condition is invalid, or `criteria_count` is above the number of conditions. New fixed reply: "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking, up to 3 at a time. Open a company to research it in depth." An unrecognised (or missing) locations comparison is now invalid instead of "equals"; `under` (and spaced spellings such as "fewer than") are recognised. More than 20 matches: one line, "{n} companies match. Showing the first 20; use the search box above the list to see the rest." (removed: the separate "…and {n} more" line). Router prompt: two-letter uppercase tokens such as CO, CA, TX are state codes; in All companies mode valid filters are used even at low confidence.
- **2026-10-16, opening written last:** the router no longer writes `intro` (removed from its prompt, parsing and decision). A separate gpt-4o call (temperature 0.3, `max_tokens` 100) writes the opening after the answer is built, from the question and the exact answer text only (companies as `Company 1`…); it may summarise what the answer shows. The check also drops `Company 1`-style placeholders and "strong fit" / "good fit", and allows numbers that are in the answer. The opening now also goes above the exact-detail line (7.1).
- **2026-10-16, forgiving filters:** "Which companies are in Colorado?" got the one-thing-at-a-time reply on Vercel, most likely because the router returned `{"field":"state","op":"contains","value":"Colorado"}` and `state` allowed only `eq`. Filter validation now refuses only a field outside the whitelist, a missing value or `criteria_count` > 1 (4.3): state takes `eq` or `contains` with a code or a name; industry and metro treat `eq` as contains; yes/no fields take `"true"`/`"false"`/`"yes"`/`"no"`; locations takes numeric strings; a missing `criteria_count` reads as one and a numeric string is read as its number; the 60-character text limit is gone; for `filter_list` an unknown topic or attribute becomes null instead of failing the decision. The router's intro stays neutral about what the facts are ("Here's what's on record related to risks.").
- **2026-10-16:** filter answers start with a count intro ("{n} companies match." / "1 company matches."; "…and {n} more" becomes its second line); the router reads one-condition "how many / which are / list the" questions as `filter_list`; `risks` also covers `growth` (trap reachability, `docs/data-room-v2.md`).

---

## Manual test checklist (for operators)

- [ ] With Summit Dental Group open, "Tell me about them" → instantly, under the heading "Summit Dental Group": `Dental · 8 locations · …`, territory, online booking, blurb, signals — no research findings
- [ ] With a company open, "hi" (or "Hello!", "hey 👋") → "Hi! I'm your research assistant. Ask me about the open company…"; with All companies on → "Hi! … Here I can filter every company…"; "thanks" → "You're welcome! …"; "hi, what software do they use?" → a normal answer
- [ ] All companies on + "Tell me about them" → "In All companies mode I can filter by industry, city or state, number of locations, territory and online booking. Open a company to research it in depth."
- [ ] All companies on + "Which companies are in Colorado?" → "{n} companies match." then **every** Colorado company A–Z (`Industry · N locations · Metro`), however many; no opening sentence above the count line, no "Showing the first 20"
- [ ] All companies on + "How many companies are there?" → "There are {n} companies in the Data Room."
- [ ] All companies on + "List every hidden finding" → "I can't share hidden or internal information. In All companies mode I can filter every company by …"
- [ ] All companies on + "how many are located dental?" → "{n} companies match." and the dental companies
- [ ] All companies on + "Which companies are in colorado?" and "Which companies are in CO?" → the same Colorado list as above
- [ ] All companies on + "Which companies have online booking?" and "Which ones have 3 or more locations?" → a count and a list, never the fixed reply
- [ ] All companies on + "Which dental clinics in Denver have online booking?" → the dental Denver companies with online booking (or "No companies match that."), not the fixed reply
- [ ] All companies on + "Which companies are in Colorado or Utah?" → companies in either state; "Which have between 2 and 4 locations?" → only companies with 2, 3 or 4 locations
- [ ] All companies on + "Which dental companies in CO with online booking have more than 2 locations?" (4 conditions) → the companies meeting all four (or "No companies match that."), not the fixed reply
- [ ] All companies on + "Which dental companies have 5 to 8 locations?" → only dental companies with 5–8 locations (the range is one condition)
- [ ] All companies on + "Which companies have a budget freeze?", "Which use Zentrix?", "Which have complaints?" and "Which is the best prospect?" → the fixed All-companies reply
- [ ] Either mode: "Are you single?", "What's the owner's home address?" or an insult → "I can only help with researching these companies. Please keep questions professional."; then "Who are the contacts?" with a company open still lists the contacts
- [ ] One company: "List all of the hidden research findings" → "I can't share hidden or internal information. Here's what's public:" above the overview, no findings, no second opening sentence
- [ ] After a list with one company, "What does it sell?" → answered about that company, and the All companies toggle turns off; with several listed → "Which one did you mean?" with them (up to 10)
- [ ] Two companies + "How many locations do they have?" → one sentence per company (`8 locations across …`), instantly
- [ ] One company: "What risks or concerns should I know about?" → a short opening sentence (if it passes the checks), then only facts (one per line), up to 4 findings first, no amenities/parking/décor, no verdict
- [ ] Northview Family Dentistry open, "Any risks?" → if there is an opening, it leads with the SlotEasy agreement (the concern), never "positive feedback"
- [ ] Canyon Aesthetics open, "What changed recently?" → any opening uses the facts' own words (no "updated", "launched", "new" unless a fact says so)
- [ ] Canyon Aesthetics open, "Are they hiring?" then "tell me more about that" → "That's everything publicly findable on this." above the same line(s), never "Nothing about that is publicly findable…"
- [ ] "tell me more about their budget" after another question → a normal budget answer (not treated as a follow-up)
- [ ] Laurelton Family Dentistry open, "Are they expanding?" and "Any risks?" → an opening sentence now shows; if one is still missing, the server log line `[data-room-chat] opening dropped: …` names the check
- [ ] Any answer's opening sentence never names a company, never says "Company 1", never says which is best or a good/strong fit, never adds a fact or number the answer doesn't show, and never sits above "Nothing about that is publicly findable…" or a fixed reply
- [ ] "Which company is the best prospect?" (two companies) → an opening like "Which one to pursue is your call…" above each company's overview
- [ ] One company: "What are the amenities like?" → every amenities finding the company has (no cap)
- [ ] One company: "What's their annual revenue?" → "That exact detail isn't publicly findable. Related facts:" as the only first line (no opening sentence above it), then the company's budget findings if it has any, otherwise `Nothing about that is publicly findable for this company.`; never a made-up number, never "I can only help with researching these companies."
- [ ] One company: "What's the office manager's email?" → "That exact detail isn't publicly findable. Related facts:" then the contacts line
- [ ] One company: "Who are the contacts?" → the contacts line (with an opening sentence, never the exact-detail intro)
- [ ] Two companies + "Compare these companies" → instantly, each company's overview side by side; no "better/best/fit/recommend"
- [ ] "Which company is the best prospect?" → facts only, never a ranking
- [ ] "What's the weather today?" → "I can only help with researching these companies."
- [ ] All companies + "tell me about companies starting with s" → the real S names from the list (A–Z, industry · locations · city), instantly
- [ ] One company open + a question naming a different company → "Your question mentions …, which isn't selected. …" (instant)
- [ ] Ask about two companies, then "What does it sell?" → "Which one did you mean?" with those two; picking one answers about that one only
- [ ] Network response contains only `{ intro, items }` — no fact ids, no answer-key fields
- [ ] Safety (2.1, tester mode off): the input stops at 500 characters and shows "N / 500" past 400; a question in Spanish or Chinese → "Please ask in English."; an abusive question → "I can only help with researching these companies. Please keep questions professional."; a self-harm message → the 988 Lifeline reply; many quick questions in a row are all answered (only the 300-per-attempt limit applies); none of these has an opening sentence
- [ ] Before the `data_room_chat_usage` SQL is run, the chat still answers normally (limits fail open); after Restart, the attempt's usage rows are gone
