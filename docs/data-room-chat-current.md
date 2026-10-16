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
Scope: `POST /api/student/data-room-chat`, its client `components/tempo/stages/ProspectingDataRoomChat.tsx`, and the pure helpers in `lib/data-room-chat-scope.ts`, `lib/data-room-chat-router.ts`, `lib/data-room-chat-filter.ts`, `lib/data-room-chat-policy.ts` and `lib/data-room-chat-render.ts`.

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

1. **Request checks**: auth; the attempt belongs to the student; scope is All companies or 1–3 distinct ids, every one in this simulation's active Data Room roster (400 otherwise).
2. **Unselected company mentioned** (1–3 company scope) → fixed reply, no model call (4.1).
3. **Question about company names** → answered from the roster, no model call (4.2).
4. **Router call** (one gpt-4o call, no facts) labels the question: intent, topic, attribute, `exact_value`, and for All companies a filter and a criteria count (5.1). Unclear or failed → `overview`.
5. **All companies** → no model picks or reads company data (4.3): a `filter_list` question with one valid filter runs over the roster in code and lists the matches A–Z from the database, then gets the opening (step 7); everything else gets the fixed one-thing-at-a-time reply (no opening call). Done.
6. **One to three companies** — the router runs in parallel with the contacts and research-findings queries; then:
   1. **Policy** (pure code) decides which facts are allowed for each company (5.2). `off_topic` → fixed reply, done.
   2. **Facts** are built at read time from the stored values: one per public attribute, one per public signal, one per hidden finding, each with a stable id and a display sentence (6).
   3. **Answer path** (7): `overview`, `compare` and `meta_or_bulk` → each company's overview, rendered by code, **no answering model call**; `attribute_lookup` → that attribute's sentence for each company, **no answering model call**; `specific_research` and `filter_list` → **every finding the policy allowed** (stored order, shown as stored), then the public facts **one selection call** picks.
   4. **Selection** (8): the call sees the **allowed findings and the public facts** and returns fact ids plus `exact_answer` (whether a fact states the exact detail asked); code keeps the public ids that are among the facts it was given (anything else is dropped; it can't add or remove a finding), keeps the model's order, and renders each fact's display sentence under the company name from the database.
   5. **Exact detail** (7): when the router marks the question `exact_value` (one specific number, amount, count, email or phone, named vendor or product) and no fact states it, the answer starts with `That exact detail isn't publicly findable. Related facts:` above the facts.
   6. Nothing from either for a company → exactly `Nothing about that is publicly findable for this company.` (no exact-detail intro).
7. **Opening call** (7.1), last, only when the finished answer shows facts: one gpt-4o call sees the student's question and the exact answer text they will see (companies as "Company 1", "Company 2"…) and writes one sentence; code checks it and puts it above the answer. A failed call or a dropped sentence leaves the answer unchanged.

So: the model writes no facts and no company names; the only model-written text is the one-sentence opening (written from the finished answer, checked by code, 7.1), shown above the facts; a hidden finding appears exactly when the policy allows it (only allowed ones ever reach the selection call, which can't add or remove them); and in All companies mode no model picks or reads company data (the opening call sees only the finished list).

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
- Items: up to **15** matches, A–Z, each `{ companyId, companyName, text: "{Industry} · {N} locations · {Metro}" }`.
- More than 15: the intro becomes `Companies whose names start with "C" (the first 15, A–Z), and {n} more. Use the search box above the list to see them all.`
- No match: `No company names start with "S".`
- Name questions work the same with All companies on (they are answered before the router).

### 4.3 All companies: one validated filter (`lib/data-room-chat-filter.ts`)

With All companies on, no model picks or reads company data; only the opening call (7.1) sees the finished list, names replaced. After the router call (5.1):

- `filter_list` with **one valid filter** and `criteria_count` ≤ `MAX_FILTER_CRITERIA` (= 1, a config constant; a missing count is read as one) → the filter runs over the whole roster in code. Matching companies are listed **A–Z only** (no other order, no ranking), at most **20**, each `{ companyId, companyName, text: "{Industry} · {N} locations · {Metro}" }` from the database (the same line as name answers; `industry` is the column the company list shows).
  - Intro: the count, `{n} companies match.` (`1 company matches.` for one).
  - More than 20: a second intro line, `…and {n} more. Use the search box above the list to narrow it down.`
  - No match: intro `No companies match that.`
- **Anything else** — any other intent (overview, attribute lookup, specific research, compare, meta or bulk, off topic), `criteria_count` > 1, a missing filter, a field outside the whitelist or a missing value, or a failed (or low-confidence) router call — gets exactly:

```
In All companies mode I can filter by one thing at a time, such as industry, city or state, number of locations, territory, or online booking. Open a company to research it in depth.
```

The filter whitelist (`parseRosterFilter`) is forgiving wherever the meaning is clear (2026-10-16). Only a field outside the whitelist or a missing value gives no filter:

| field | op | value | matches |
|-------|----|-------|---------|
| `industry` | any (`eq` and `contains` both mean contains) | text or number | the `industry` column contains it, any case |
| `metro` | any (`eq` and `contains` both mean contains) | text or number | the `metro` column (city or area) contains it, any case |
| `state` | any (`eq`, `contains`, …) | a two-letter code or a full state name (also inside text, "the state of Colorado"), any case → the code | the `, XX` suffix of `metro`; an unknown state matches nothing (`No companies match that.`) |
| `locations` | `eq`, `gt`, `gte`, `lt`, `lte` (also `=`, `>`, `>=`, `<`, `<=`, `greater_than`, `at_least`, …); anything else → `eq` | a number ≥ 0 or a numeric string (`"3"`) | `locations` |
| `territory` | any (read as `eq`) | `true` / `false`, or `"true"` / `"false"` / `"yes"` / `"no"`, any case | `in_territory` |
| `online_booking` | any (read as `eq`) | `true` / `false`, or `"true"` / `"false"` / `"yes"` / `"no"`, any case | `online_booking` |

A value that can't be read (a non-numeric locations value, a yes/no field with "maybe", an empty string) counts as missing. A missing (unknown) value on a company never matches. An attribute question with All companies on gets the fixed reply too (product decision 2026-10-16).

---

## 5. Router and policy

### 5.1 Router call (`lib/data-room-chat-router.ts`)

`gpt-4o`, `temperature: 0`, `max_tokens: 300` (room for the decision and its filter), JSON mode. Its input is **only** the student's question (names redacted), their **last 3 questions** (any scope, redacted) and the scope kind (`one company` / `two or three companies` / `all companies`) — **no facts and no company data**. Reply: `{ "intent", "topic", "attribute", "filter", "criteria_count", "exact_value", "confidence" }`. It writes no opening sentence (that is its own call, written last, 7.1); a stray `intro` in its reply is ignored.

- intent: `overview` | `attribute_lookup` | `specific_research` | `compare` | `filter_list` | `meta_or_bulk` | `off_topic`; topic: a question topic from `lib/data-room-research-topics.ts` or null; attribute: `industry` | `locations` | `metro` | `territory` | `online_booking` | `size` | `contacts` | null.
- filter (All companies `filter_list` only, otherwise null): `{ "field", "op", "value" }` from the whitelist (4.3); criteria_count: how many separate conditions the question filters by ("dental clinics in Denver" = 2).
- exact_value: true when the question asks for one specific detail (a number, amount, count, email or phone number, or a named vendor or product); anything but exactly `true` reads as false (7).
- Prompt rule: questions phrased as "how many…", "which are…" or "list the…" with ONE condition are `filter_list`, read charitably ("how many are located dental?" → `{"field": "industry", "op": "contains", "value": "dental"}`); the count intro answers "how many".
- `off_topic` is only for questions clearly unrelated to researching companies (the weather, homework, jokes). Anything about a company is never off topic: revenue, finances, metrics, patients, people's roles or who decides are `specific_research` with the closest topic (revenue or finances → `budget`; people's roles or who decides → `ownership`). Email addresses, phone numbers or who to contact are `attribute_lookup` with attribute `contacts`, so the answer is the contacts list (2026-10-16).
- **Fails closed in code** (`parseRouterReply`): invalid JSON, unknown values, low or missing confidence, or `specific_research` without a topic → `overview`. For `filter_list` an unknown topic or attribute just becomes null (it never uses them), so it can't sink a valid filter. A filter the whitelist can't read (4.3) becomes null (an All-companies question then gets the fixed reply); a criteria count that isn't a whole number ≥ 0 (a number or a numeric string such as `"1"`) becomes null. A failed router call also counts as `overview`.
- Follow-ups ("tell me more about that") are understood from the recent questions; no answering step sees history.

### 5.2 Policy (`lib/data-room-chat-policy.ts`, pure)

`allowedFacts({ intent, topic, scope, companies })` → `{ public, hidden }` per company (1–3 company questions; All companies never reaches the policy):

| Intent | One company | Two or three |
|--------|-------------|--------------|
| `specific_research` | public + **the findings, in stored order, whose topics intersect the question topic's fact topics: the first 4 (`MAX_SHARED_FINDINGS`) for a broad topic (`risks`, `fit`, `recent_changes`), every one for a single fact topic** (e.g. `amenities`, `staffing`) | public only |
| `overview`, `attribute_lookup`, `compare`, `filter_list` | public only | public only |
| `meta_or_bulk` | public only; answered as the overview (no model call) | same |
| `off_topic` | nothing; fixed reply `I can only help with researching these companies.` | same |

Allowed findings are always shown, as stored; no model chooses among them. The directory generator places each trap's disqualifier within the first 4 matches for `risks` and `fit` (it also still checks its own topics against the cap, which is stricter than the policy now needs).

Question topics → fact topics: `risks` → current_tools, budget, staffing, ownership, operations, growth; `fit` → operations, growth, current_tools, budget, staffing, ownership; `recent_changes` → growth, current_tools, staffing, operations; every other topic → itself.

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

The response is always `{ intro, items: [{ companyId, companyName, text }] }`. Each item's `text` is one fact per line (the client shows line breaks); `companyName` comes from the database and is shown as the header. The intro is the checked opening sentence (7.1, above any intro line the answer already has), a fixed reply, or empty.

| Path | Router intent | Answering model calls (the opening call, 7.1, comes after) | Items |
|------|---------------|------------------------------|-------|
| Overview | `overview`, `compare`, `meta_or_bulk`, `attribute_lookup` without an attribute | none | Every company in scope: headline, territory, online booking, blurb, public signals, in that order (compare = these overviews side by side) |
| Attribute | `attribute_lookup` | none | Every company in scope: that attribute's sentence, or the nothing-findable reply when it has no value |
| Select | `specific_research`, `filter_list` | one (sees the allowed findings and the public facts) | Each company: **every finding the policy allowed** (stored order; one company only), then the public facts the selection call picked. One company with neither → the nothing-findable reply. 2–3: only companies with a line; none at all → intro = the nothing-findable reply |

**Exact detail** (2026-10-16): when the router sets `exact_value` (the question asks for one specific number, amount, count, email or phone, or named vendor or product) and the selection call's `exact_answer` is false, the intro is `That exact detail isn't publicly findable. Related facts:` and the facts follow as usual. An `attribute_lookup` for `contacts` with `exact_value` (an email or phone; contacts never store them) gets the same intro above the contacts line, with no model call. An answer with no facts keeps the nothing-findable reply, without the intro.

`filter_list` about 2–3 companies uses one selection call over their public facts (product decision 2026-10-15). All companies: see 4.3.

### 7.1 Opening sentence (written last; `lib/data-room-chat-render.ts`)

Once the answer is fully built by code, and only when it shows facts (`hasFacts`), the route makes one more call: `gpt-4o`, `temperature: 0.3`, `max_tokens: 100`, JSON mode, reply `{"opening": string}`. A failed call, a bad reply or a dropped sentence → no opening and the answer goes out unchanged (never a fixed fallback).

**Input** (`buildOpeningMessages`): only the student's question and the exact answer text they will see — the intro line if any (`{n} companies match.`, the exact-detail line), then each company's header and lines, blank line between blocks. Company names in both are replaced by `Company 1`, `Company 2`… in the order the answer shows them; any other company becomes "another company", and an identifying first word becomes the company whose lines it is in (or the one shown company with that word; "a company" when two shown companies share it). Nothing else: no finding the answer doesn't show, no contacts it doesn't show, no answer key, no ids, no history.

```
Question: What about Company 1's budget?

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
- Never judge, rank or recommend a company. Never write "better than", "the best", "recommend", "go with", "I'd pick", "strong fit" or "good fit".
- Never name a company, and never refer to one as "Company 1", "Company 2" and so on.
- If the student asks which company is better, which one to pick, or whether one is a good prospect, say that call is theirs and the facts below can help (for example "Which one to pursue is your call; the facts below can help you compare.").
```

**Checks** (`checkOpening`; dropped, with no fallback, when any fails): over 200 characters or more than one sentence; contains a ref (`C1`, `[C1]`), a `Company 1`-style placeholder, a full roster company name, or a distinctive company-name word (a non-generic name word of 3+ letters; words the student used in the question are allowed); contains a number that is in neither the answer as the student sees it nor the question; or judges a company ("better than", "the best", "recommend…", "go with", "I'd pick", "strong fit", "good fit").

**Where it shows** (`withOpening`):

- 1–3 companies: above the facts on every path (overview, compare, attribute, select).
- All companies filter lists: above the `{n} companies match.` line.
- Above the exact-detail line `That exact detail isn't publicly findable. Related facts:`, which stays.
- Never on an answer with no facts, and no call is made: the nothing-findable reply (an answer whose blocks are all nothing-findable, or the nothing-findable intro), off-topic, out-of-scope, the All-companies one-thing-at-a-time reply, "No companies match that." and name questions. An answer with facts for some companies and nothing-findable for others gets the opening.

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
- exact_answer: true only if a listed fact states exactly what was asked (for example the number, amount or count, the email address or phone number, or the named vendor or product); false otherwise.
- If no fact answers the question, reply {"fact_ids": [], "exact_answer": false}.
- If the exact thing asked for (for example an email address, a revenue number or a count) isn't stated in the facts, set exact_answer to false and return no facts rather than loosely related ones.
- Never rank, recommend or judge the companies; only choose facts.
```

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
- The client still sends the transcript (`{ role: "user", content, scope }` and `{ role: "assistant", intro, items, scope }`). The server reads **only the student's questions** (`parseHistoryQuestions`); the router uses the last 3, redacted. No selection or opening call sees history, and assistant answers are never read by the server.
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

Response: `{ "intro": string, "items": [{ "companyId", "companyName", "text" }] }` (unchanged in Phase 3, so the UI needs no change). No directory columns, fact ids or answer-key fields are returned.

---

## 12. Security boundary

| Layer | Columns | Reaches a model? | Reaches the student? |
|-------|---------|------------------|----------------------|
| Visible | `vertical`/`industry`, `locations`, `metro`, `in_territory`, `size_note`, `online_booking`, `blurb`, `public_signals`, contacts | As allowed facts in a selection call about 1–3 companies (names redacted), and in the opening call only as the finished answer shows them (names as `Company 1`…); never to the router; in All companies mode only the shown list reaches the opening call (filters run in code) | Yes, rendered from the stored values |
| Visible (lookup only) | `company_name` | No (replaced by refs or `Company 1`…) | Yes, as the header (from the database) |
| Hidden (allowed) | `research_facts` | Only the findings the policy allows, in the selection call (names redacted; it can't add or remove one), and in the opening call exactly the findings the answer shows | Exactly the findings the policy allows (5.2): a specific research question about exactly one company, matching topics, at most 4 for a broad topic; rendered from the stored text |
| Hidden (forbidden) | `class`, `subtype`, `fit_rank`, `trigger_quality`, `keyed_trigger`, `best_contact`, `why` | Never selected | Never |

---

## 13. Change history

- **2026-10-14:** compact multi/All lines; factual comparisons allowed (ranking refused); "never leave both empty" plus an empty-answer retry (blank answers came from format rules that let the model say nothing); Tempo product context and an "up to 4, most relevant first" findings line; hidden-findings requests answered like general questions.
- **2026-10-15, Phase 2:** the router and the code-side policy replaced the prompt's withholding rules; one exact sentence for "nothing found".
- **2026-10-15, Phase 3:** extractive answers. Removed: the free-text answering prompt (and its single / multi / All prompt modes and compact lines), the scan of model prose for company names, refs and the words "references"/"labels", the stricter retry and the empty-answer retry with their reminders, the fallback reply `I can only answer about the companies in your question.`, the meta-or-bulk question substitution, and history in the answering call (`selectHistoryForScope`). Kept: id verification, scope checks, the out-of-scope reply, name questions, the router's fail-closed parsing, and name redaction for model input.
- **2026-10-16, Phase 4:** All companies mode runs one validated filter in code (4.3); every other All-companies question gets the fixed one-thing-at-a-time reply. Removed: the All-companies answer paths (headline-only overview, one selection call over every company's facts, compare with one call per company for all companies and its 8-at-a-time limit). The compact multi/All prompt lines were already removed in Phase 3. Added: the list follow-up (1.1, step 0).
- **2026-10-16, helpful answers:** specific research shows every finding the policy allows (stored order) and the selection call only adds public lines (it never sees a finding); compare renders each company's overview with no model (removed: the per-company selection path); the 4-finding cap applies only to broad topics (`risks`, `fit`, `recent_changes`); `off_topic` is only for clearly unrelated questions, and company questions about revenue, finances, emails, metrics or patients are `specific_research`; the selection prompt returns no facts when the exact thing asked for isn't stated.
- **2026-10-16, exact detail:** the router adds `exact_value`; the selection call sees the allowed findings and public facts again (it still can't add or remove a finding) and returns `exact_answer` instead of `no_relevant_facts`; an exact detail no fact states gets the intro `That exact detail isn't publicly findable. Related facts:` (also above contacts for email or phone questions).
- **2026-10-16, opening sentence:** the router writes a one-sentence `intro` (no extra model call; `max_tokens` 150 → 300), checked by code and shown above the facts (7).
- **2026-10-16, opening written last:** the router no longer writes `intro` (removed from its prompt, parsing and decision). A separate gpt-4o call (temperature 0.3, `max_tokens` 100) writes the opening after the answer is built, from the question and the exact answer text only (companies as `Company 1`…); it may summarise what the answer shows. The check also drops `Company 1`-style placeholders and "strong fit" / "good fit", and allows numbers that are in the answer. The opening now also goes above the exact-detail line (7.1).
- **2026-10-16, forgiving filters:** "Which companies are in Colorado?" got the one-thing-at-a-time reply on Vercel, most likely because the router returned `{"field":"state","op":"contains","value":"Colorado"}` and `state` allowed only `eq`. Filter validation now refuses only a field outside the whitelist, a missing value or `criteria_count` > 1 (4.3): state takes `eq` or `contains` with a code or a name; industry and metro treat `eq` as contains; yes/no fields take `"true"`/`"false"`/`"yes"`/`"no"`; locations takes numeric strings; a missing `criteria_count` reads as one and a numeric string is read as its number; the 60-character text limit is gone; for `filter_list` an unknown topic or attribute becomes null instead of failing the decision. The router's intro stays neutral about what the facts are ("Here's what's on record related to risks.").
- **2026-10-16:** filter answers start with a count intro ("{n} companies match." / "1 company matches."; "…and {n} more" becomes its second line); the router reads one-condition "how many / which are / list the" questions as `filter_list`; `risks` also covers `growth` (trap reachability, `docs/data-room-v2.md`).

---

## Manual test checklist (for operators)

- [ ] With Summit Dental Group open, "Tell me about them" → instantly, under the heading "Summit Dental Group": `Dental · 8 locations · …`, territory, online booking, blurb, signals — no research findings
- [ ] All companies on + "Tell me about them" → "In All companies mode I can filter by one thing at a time, …"
- [ ] All companies on + "Which companies are in Colorado?" → "{n} companies match." then the Colorado companies A–Z (`Industry · N locations · Metro`), at most 20, with "…and n more" under the count if there are more
- [ ] All companies on + "how many are located dental?" → "{n} companies match." and the dental companies
- [ ] All companies on + "Which companies are in colorado?" and "Which companies are in CO?" → the same Colorado list as above
- [ ] All companies on + "Which companies have online booking?" and "Which ones have 3 or more locations?" → a count and a list, never the one-thing-at-a-time reply
- [ ] All companies on + "Which companies have online booking?" → an opening sentence that may summarise the list (for example "Two companies offer online booking.") above "{n} companies match."; it never names a company
- [ ] All companies on + "Which dental clinics in Denver have online booking?" → the one-thing-at-a-time reply
- [ ] All companies on + "Which companies have a budget freeze?" → the one-thing-at-a-time reply
- [ ] After a list with one company, "What does it sell?" → answered about that company, and the All companies toggle turns off; with several listed → "Which one did you mean?" with them (up to 10)
- [ ] Two companies + "How many locations do they have?" → one sentence per company (`8 locations across …`), instantly
- [ ] One company: "What risks or concerns should I know about?" → a short opening sentence (if it passes the checks), then only facts (one per line), up to 4 findings first, no amenities/parking/décor, no verdict
- [ ] Any answer's opening sentence never names a company, never says "Company 1", never says which is best or a good/strong fit, never adds a fact or number the answer doesn't show, and never sits above "Nothing about that is publicly findable…" or a fixed reply
- [ ] "Which company is the best prospect?" (two companies) → an opening like "Which one to pursue is your call…" above each company's overview
- [ ] One company: "What are the amenities like?" → every amenities finding the company has (no cap)
- [ ] One company: "What's their annual revenue?" → an opening sentence (if it passes the checks), then "That exact detail isn't publicly findable. Related facts:", then the company's budget findings if it has any, otherwise `Nothing about that is publicly findable for this company.`; never a made-up number, never "I can only help with researching these companies."
- [ ] One company: "What's the office manager's email?" → "That exact detail isn't publicly findable. Related facts:" then the contacts line
- [ ] One company: "Who are the contacts?" → the contacts line (with an opening sentence, never the exact-detail intro)
- [ ] Two companies + "Compare these companies" → instantly, each company's overview side by side; no "better/best/fit/recommend"
- [ ] "List all of the hidden research findings" → the plain overview, no findings
- [ ] "Which company is the best prospect?" → facts only, never a ranking
- [ ] "What's the weather today?" → "I can only help with researching these companies."
- [ ] All companies + "tell me about companies starting with s" → the real S names from the list (A–Z, industry · locations · city), instantly
- [ ] One company open + a question naming a different company → "Your question mentions …, which isn't selected. …" (instant)
- [ ] Ask about two companies, then "What does it sell?" → "Which one did you mean?" with those two; picking one answers about that one only
- [ ] Network response contains only `{ intro, items }` — no fact ids, no answer-key fields
