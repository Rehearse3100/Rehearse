/**
 * data-room-chat-router.ts
 * Question router for the Data Room assistant (pure). Builds the classifier call's
 * messages: the student's question, their last 3 questions (both already
 * name-redacted) and the scope kind — never any facts or company data — and parses
 * its JSON reply, failing closed to "overview". The system prompt is the same for
 * every question of a simulation (anything per question is in the user message), and
 * long enough for OpenAI's automatic prompt caching. For All-companies filter
 * questions the reply also carries the filters (as many as the question asks for;
 * validated by lib/data-room-chat-filter.ts), whether the question also asks for
 * something no filter can express (unfiltered), and how many conditions it asks for
 * (0 marks the total-count question); in All companies mode valid filters are used
 * even when the router is unsure. The router also labels small talk (small_talk, with
 * its kind) and questions about company names (name_query, with name_match), and
 * rewrites each question to stand on its own (standalone_question, checked here by
 * acceptedStandaloneQuestion) and says whether it is a follow-up (is_follow_up). The
 * reply also says whether the question is in English (parseRouterEnglish; a message
 * with two common English function words counts as English whatever it says,
 * hasEnglishFunctionWords) and, for a list, the order it asks for (sort: locations or
 * name). "Compare …", "side by side" and "vs" are read in code (isCompareRequest).
 * For a follow-up, parseFollowUpContext reads the lines the latest answer about the
 * same companies showed (for "nothing new"). POST /api/student/data-room-chat makes
 * the call (lib/data-room-chat-models.ts builds it from the config's model
 * settings); lib/data-room-chat-policy.ts turns the decision into the allowed facts
 * and lib/data-room-chat-render.ts into the answer path.
 */

import { getDataRoomChatConfig, type DataRoomChatConfig } from "@/lib/data-room-chat-config";
import { parseRosterFilters, parseRosterSort, type RosterFilter, type RosterSort } from "@/lib/data-room-chat-filter";
import { isTooLong } from "@/lib/data-room-chat-guard";
import { QUESTION_TOPICS, type QuestionTopic } from "@/lib/data-room-research-topics";
import {
  detectCompanies,
  parseChatScope,
  type ChatScope,
  type GreetingKind,
  type NameQuery,
  type ScopeIndex,
} from "@/lib/data-room-chat-scope";

// ── Decision shape ───

export const ROUTER_INTENTS = [
  "overview",
  "attribute_lookup",
  "specific_research",
  "compare",
  "filter_list",
  "name_query",
  "meta_or_bulk",
  "small_talk",
  "off_topic",
  "inappropriate",
] as const;

export type RouterIntent = (typeof ROUTER_INTENTS)[number];

export const ROUTER_ATTRIBUTES = [
  "industry",
  "locations",
  "metro",
  "territory",
  "online_booking",
  "size",
  "contacts",
] as const;

export type RouterAttribute = (typeof ROUTER_ATTRIBUTES)[number];

/** What a small_talk message is (the route answers each with its fixed reply). */
export const SMALL_TALK_KINDS = ["greeting", "thanks", "how_are_you", "acknowledgement", "goodbye"] as const;
export type SmallTalkKind = (typeof SMALL_TALK_KINDS)[number];

/** A name_query's condition: names that start with or contain the value, or every name ("list", value ""). */
export const NAME_MATCH_KINDS = ["starts_with", "contains", "list"] as const;
export type NameMatch = { kind: (typeof NAME_MATCH_KINDS)[number]; value: string };

export type RouterDecision = {
  intent: RouterIntent;
  topic: QuestionTopic | null;
  attribute: RouterAttribute | null;
  /** The whitelisted conditions (All-companies filter questions only; no limit); null when missing or any is invalid. */
  filters: RosterFilter[] | null;
  /** How many conditions the question filters by; null when missing or invalid. */
  criteriaCount: number | null;
  /** The question asks for one specific detail (a number, amount, count, email or phone, a named vendor or product). */
  exactValue: boolean;
  /** The order a list question asks for (by locations or name); omitted when it asks for none (A–Z). */
  sort?: RosterSort;
  /** All companies: the question also asks for something no filter can express; omitted otherwise. */
  unfiltered?: true;
  /** small_talk only: its kind, or null when the router gave none it knows. */
  smallTalkKind?: SmallTalkKind | null;
  /** name_query only: the condition on the names. */
  nameMatch?: NameMatch;
  /** The question rewritten to stand on its own (unchecked; the route checks it with acceptedStandaloneQuestion). */
  standaloneQuestion?: string;
  /** The question only makes sense with the recent questions; omitted otherwise. */
  isFollowUp?: true;
};

/** What every unclear or invalid classification becomes: public facts only. */
export const OVERVIEW_DECISION: RouterDecision = {
  intent: "overview",
  topic: null,
  attribute: null,
  filters: null,
  criteriaCount: null,
  exactValue: false,
};

/** How many of the student's earlier questions the classifier sees. */
export const ROUTER_RECENT_QUESTIONS = 3;

export type ScopeKind = "one" | "several" | "all";

/** One company, two or three, or All companies. */
export function scopeKindOf(scope: ChatScope): ScopeKind {
  if (scope.mode === "all") {
    return "all";
  }
  return scope.companyIds.length === 1 ? "one" : "several";
}

// ── Prompt ───

/** "current_tools (software, systems, …), budget (…), …": every question topic with what it covers. */
function topicList(config: DataRoomChatConfig): string {
  return QUESTION_TOPICS.map((topic: QuestionTopic) => `${topic} (${config.topicDescriptions[topic]})`).join(", ");
}

/**
 * The classifier's instructions (it never sees company data), with the simulation's
 * topic descriptions (lib/data-room-chat-config.ts).
 */
export function buildRouterSystemPrompt(config: DataRoomChatConfig = getDataRoomChatConfig()): string {
  const topics = topicList(config);
  return [
    "You classify one question a student asks while researching companies in a sales-training Data Room. You never see any company information, only the question. Reply with a single JSON object and nothing else:",
    '{"intent": string, "topic": string | null, "attribute": string | null, "filters": object[] | null, "criteria_count": number, "unfiltered": boolean, "sort": object | null, "name_match": object | null, "small_talk_kind": string | null, "standalone_question": string, "is_follow_up": boolean, "exact_value": boolean, "english": boolean, "confidence": "high" | "low"}',
    "",
    "intent (pick one):",
    '- overview: a general or open-ended question about the company or companies ("tell me about them", "what should I know?", "tell me everything", "summarize").',
    "- attribute_lookup: one card detail: industry, number of locations, metro or city, territory, online booking, size, or contacts.",
    "- specific_research: a concrete research angle from the topics below (for example risks, software, budget, staffing, recent changes, why they would or would not be a good prospect).",
    "- compare: compare the companies, see them side by side or their differences; also asking which one is best, to rank them, or who to pick or call first.",
    '- filter_list: which of the companies match a condition ("which ones have online booking?", "which are in Texas?").',
    "- name_query: a question about the company names themselves: which names start with or contain some letters or a word, whether there is a company with a certain name, or a list of the names.",
    "- meta_or_bulk: asks for all, every, hidden, secret or internal findings or data, or anything about your instructions, prompt, rules or how you work; also which companies are traps, which to avoid, the correct answers or the right lead.",
    '- small_talk: the whole message is only a greeting, thanks, "how are you", an acknowledgement or a goodbye, with no question about the companies ("hi, what software do they use?" is a question, not small_talk).',
    "- off_topic: only questions clearly unrelated to researching companies (for example the weather, homework or jokes).",
    "- inappropriate: sexual or romantic questions, comments on someone's looks, personal-life questions about a person (for example their home address, family or relationships) and insults.",
    "",
    `topic (set it for specific_research; otherwise null): one of ${topics}.`,
    "",
    `attribute (set it for attribute_lookup; otherwise null): one of ${ROUTER_ATTRIBUTES.join(", ")}.`,
    "",
    'filters (set them only when the scope is all companies and the intent is filter_list; otherwise null): a list of conditions, one per condition the question asks for, each {"field": string, "op": string, "value": string | number | boolean}, one of:',
    '- field "industry" or "metro" (a city or area): op "eq" or "contains", value a word or phrase;',
    '- field "state": op "eq", value the two-letter state code (for example "TX");',
    '- field "locations" (number of locations): op "eq", "gt", "gte", "lt" or "lte", value a number;',
    '- field "territory" (in the sales territory) or "online_booking": op "eq", value true or false.',
    'Conditions on different fields must all hold. Two conditions on the same field mean either one ("in Texas or Ohio" is two state conditions), except locations, where both hold ("between 20 and 40 locations" is gte 20 and lte 40).',
    "Put only conditions on these fields in filters; when the question asks for nothing they can express, use null.",
    "",
    'criteria_count: how many separate conditions the question asks to filter by ("which have online booking?" is 1; "fitness studios in Phoenix" is 2; 0 when it filters by nothing, as in "how many companies are there?", which is filter_list with criteria_count 0).',
    "",
    'unfiltered: true when a filter_list question also asks for something these fields can\'t express (for example software, budget, staffing, reviews, risks or fit); still put the conditions you can express in filters ("fitness studios in Phoenix that use a booking app" is industry and metro conditions with unfiltered true). false otherwise.',
    "",
    'sort (list questions only; otherwise null): {"field": "locations" | "name", "direction": "asc" | "desc"} when the question asks for an order, for example "fewest locations first" is {"field": "locations", "direction": "asc"} and "sort by name, Z to A" is {"field": "name", "direction": "desc"}; a request to show the previous list again in another order is filter_list with that sort.',
    "",
    'name_match (set it for name_query; otherwise null): {"kind": "starts_with" | "contains" | "list", "value": string}. starts_with: names that start with some letters or a word ("which names start with B?" is {"kind": "starts_with", "value": "B"}); contains: names that contain them, or a company called or named something ("is there one called Lantern?" is {"kind": "contains", "value": "Lantern"}); list: every name ("list the company names" is {"kind": "list", "value": ""}). Copy the value as the question writes it, a reference such as [C1] included.',
    "",
    'small_talk_kind (set it for small_talk; otherwise null): "greeting" (hi, hello, good morning), "thanks" (thanks, thank you, thx, much appreciated), "how_are_you" (how are you, how\'s it going, what\'s up), "acknowledgement" (ok, sure, got it, sounds good, yes, no) or "goodbye" (bye, see you, later).',
    "",
    'standalone_question: the question rewritten so it makes sense on its own, using the recent questions to fill in what a follow-up refers to ("and their budget?" after "What software does [C1] use?" is "What is [C1]\'s budget?"). Keep company references such as [C1] exactly as written and never add a company name. When the question already makes sense on its own, copy it unchanged.',
    "",
    "is_follow_up: true when the question only makes sense with the recent questions (it asks for more on an earlier question, or continues it); false otherwise.",
    "",
    "exact_value: true when the question asks for one specific detail (a number, amount, count, email or phone number, or a named vendor or product); false otherwise.",
    "",
    "english: true when the question is written in English, typos and short questions included; false otherwise.",
    "",
    "Rules:",
    '- specific_research needs a concrete angle. "Tell me everything", "what should I know?" and "anything else?" are overview.',
    "- Read typos charitably.",
    '- Questions about who decides, approves, signs off on or makes purchasing decisions are specific_research with topic ownership, even when they mention software, tools or vendors (for example "who approves new equipment purchases?" is ownership).',
    "- Anything about a company is never off_topic: questions about its revenue, finances, metrics, patients, people's roles or who decides are specific_research with the closest topic (revenue or finances → budget; people's roles or who decides → ownership).",
    '- Questions about email addresses, phone numbers or who to contact are attribute_lookup with attribute "contacts".',
    '- Questions phrased as "how many…", "which are…" or "list the…" with one or more conditions are filter_list; read them charitably (for example "how many are located retail?" is filter_list with filters [{"field": "industry", "op": "contains", "value": "retail"}]).',
    "- Two-letter uppercase tokens such as TX, CA or NY are US state codes.",
    "- Use the recent questions only for a follow-up: label it as its standalone_question.",
    '- Use "low" confidence when you are unsure. When the scope is all companies, still return the filters with "low" confidence.',
  ].join("\n");
}

/** Shortest router system prompt: OpenAI caches a prompt's start automatically from 1,024 tokens (about 5,000 characters of this text). */
export const MIN_ROUTER_PROMPT_CHARS = 5_000;

/** The classifier's instructions with Tempo's topic descriptions. */
export const ROUTER_SYSTEM_PROMPT = buildRouterSystemPrompt();

const SCOPE_KIND_LABELS: Record<ScopeKind, string> = {
  one: "one company",
  several: "two or three companies",
  all: "all companies",
};

export type RouterInput = {
  /** The student's question, company names already redacted. */
  question: string;
  /** The student's earlier questions, redacted, oldest first (the last 3 are used). */
  recentQuestions: readonly string[];
  scopeKind: ScopeKind;
};

/** The classifier's messages: only the question, recent questions and scope kind. */
export function buildRouterMessages(
  input: RouterInput,
  config: DataRoomChatConfig = getDataRoomChatConfig()
): Array<{ role: "system" | "user"; content: string }> {
  const recent = input.recentQuestions.slice(-ROUTER_RECENT_QUESTIONS);
  return [
    { role: "system", content: buildRouterSystemPrompt(config) },
    {
      role: "user",
      content: [
        `Scope: ${SCOPE_KIND_LABELS[input.scopeKind]}`,
        "Recent questions (oldest first):",
        ...(recent.length > 0 ? recent.map((question) => `- ${question}`) : ["(none)"]),
        `Question: ${input.question}`,
      ].join("\n"),
    },
  ];
}

// ── Reply ───

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** A name_query's name_match, or null unless its kind is known and (except for a list) its value is non-empty text. */
function parseNameMatch(raw: unknown): NameMatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { kind, value } = raw as Record<string, unknown>;
  if (!isOneOf(NAME_MATCH_KINDS, kind)) {
    return null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (kind === "list") {
    return { kind, value: "" };
  }
  return text ? { kind, value: text } : null;
}

/** Intents that never use topic or attribute, so a stray value there doesn't sink the decision. */
const TOPIC_FREE_INTENTS: readonly RouterIntent[] = ["filter_list", "name_query", "small_talk"];

/**
 * Parses the classifier's reply, failing closed to OVERVIEW_DECISION on invalid
 * JSON, unknown values, low or missing confidence, specific_research without a
 * topic, or name_query without a valid name_match. With scopeKind "all", a
 * filter_list reply with valid filters is kept whatever its confidence (code checks
 * every condition). For filter_list, name_query and small_talk an unknown topic or
 * attribute just becomes null. Filters come from "filters" (or a single "filter",
 * read as a one-item list; no limit on how many); any condition the whitelist can't
 * read makes them null (an All-companies question then gets the fixed reply); a
 * criteria count that isn't a whole number of 0 or more (as a number or numeric
 * string) becomes null. exact_value, unfiltered and is_follow_up are true only when
 * exactly true. A valid "sort" (locations or name, asc or desc; parseRosterSort) is
 * kept as sort; anything else leaves it out (A–Z). small_talk keeps its kind (null
 * when unknown); name_query its name_match (parseNameMatch). standalone_question is
 * kept as trimmed text when it is a non-empty string (the route checks it).
 */
export function parseRouterReply(raw: string | null | undefined, scopeKind?: ScopeKind): RouterDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return OVERVIEW_DECISION;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return OVERVIEW_DECISION;
  }
  const {
    intent,
    topic,
    attribute,
    filters: rawFilters,
    filter: rawFilter,
    criteria_count: criteriaCount,
    unfiltered,
    sort: rawSort,
    name_match: rawNameMatch,
    small_talk_kind: smallTalkKind,
    standalone_question: standaloneQuestion,
    is_follow_up: isFollowUp,
    exact_value: exactValue,
    confidence,
  } = parsed as Record<string, unknown>;
  const filters = parseRosterFilters(rawFilters, rawFilter);
  const sort = parseRosterSort(rawSort);
  // All companies only: valid filters (or a valid sort) are used even when the router is unsure.
  const isTrusted =
    confidence === "high" || (scopeKind === "all" && intent === "filter_list" && (filters !== null || sort !== null));
  // filter_list, name_query and small_talk never use topic or attribute, so a stray value there doesn't sink them.
  const isStrict = !isOneOf(TOPIC_FREE_INTENTS, intent);
  if (
    !isOneOf(ROUTER_INTENTS, intent) ||
    !isTrusted ||
    (isStrict && topic !== null && topic !== undefined && !isOneOf(QUESTION_TOPICS, topic)) ||
    (isStrict && attribute !== null && attribute !== undefined && !isOneOf(ROUTER_ATTRIBUTES, attribute))
  ) {
    return OVERVIEW_DECISION;
  }
  const nameMatch = intent === "name_query" ? parseNameMatch(rawNameMatch) : null;
  if (intent === "name_query" && !nameMatch) {
    return OVERVIEW_DECISION;
  }
  const count = typeof criteriaCount === "string" && criteriaCount.trim() !== "" ? Number(criteriaCount) : criteriaCount;
  const standalone = typeof standaloneQuestion === "string" ? standaloneQuestion.trim() : "";
  const decision: RouterDecision = {
    intent,
    topic: isOneOf(QUESTION_TOPICS, topic) ? topic : null,
    attribute: isOneOf(ROUTER_ATTRIBUTES, attribute) ? attribute : null,
    filters,
    criteriaCount: Number.isInteger(count) && (count as number) >= 0 ? (count as number) : null,
    exactValue: exactValue === true,
    ...(sort ? { sort } : {}),
    ...(unfiltered === true ? { unfiltered: true as const } : {}),
    ...(intent === "small_talk" ? { smallTalkKind: isOneOf(SMALL_TALK_KINDS, smallTalkKind) ? smallTalkKind : null } : {}),
    ...(nameMatch ? { nameMatch } : {}),
    ...(standalone ? { standaloneQuestion: standalone } : {}),
    ...(isFollowUp === true ? { isFollowUp: true as const } : {}),
  };
  return decision.intent === "specific_research" && decision.topic === null
    ? OVERVIEW_DECISION
    : decision;
}

// ── Small talk, name questions and the rewritten question ───

/** Each small-talk kind's fixed reply (lib/data-room-chat-scope.ts greetingReply). */
const SMALL_TALK_GREETING_KINDS: Readonly<Record<SmallTalkKind, GreetingKind>> = {
  greeting: "greeting",
  thanks: "thanks",
  how_are_you: "smallTalk",
  acknowledgement: "acknowledgement",
  goodbye: "goodbye",
};

/** The fixed reply a small_talk message gets: its kind's, or the acknowledgement for a kind the router didn't give. */
export function greetingKindOf(kind: SmallTalkKind | null | undefined): GreetingKind {
  return kind ? SMALL_TALK_GREETING_KINDS[kind] : "acknowledgement";
}

/** A ref the router wrote ("[C1]", or "C1" without brackets): its number. */
const REF_IN_TEXT = /\[C(\d+)\]|\bC(\d+)\b/g;

/**
 * The text with each ref ([C1], C1…) replaced by the name it stands for (names[0] for
 * C1, in scope order); a ref with no name is left as written.
 */
export function replaceRefs(text: string, names: readonly string[]): string {
  return text.replace(REF_IN_TEXT, (match: string, bracketed?: string, bare?: string) => names[Number(bracketed ?? bare) - 1] ?? match);
}

/**
 * A name_query's condition as the company-list answer reads it (lib/data-room-chat-scope.ts
 * answerNameQuery): starts_with → startsWith, contains → contains, list → list; a ref
 * in the value ([C1]) becomes that company's name (names in scope order).
 */
export function toNameQuery(match: NameMatch, names: readonly string[]): NameQuery {
  const kind: NameQuery["kind"] = match.kind === "starts_with" ? "startsWith" : match.kind === "contains" ? "contains" : "list";
  return { kind, value: kind === "list" ? "" : replaceRefs(match.value, names).trim() };
}

/**
 * The router's rewritten question when it passes every check, else null (the route
 * then uses the question as asked): non-empty, at most 500 characters (the message
 * cap), no roster company name in it (a full name or an identifying first word,
 * detectCompanies), and every ref ([C1]…) one of the scope's (1 to refCount).
 */
export function acceptedStandaloneQuestion(
  rewrite: string | null | undefined,
  index: ScopeIndex,
  refCount: number
): string | null {
  const text = typeof rewrite === "string" ? rewrite.trim() : "";
  if (!text || isTooLong(text)) {
    return null;
  }
  const detection = detectCompanies(index, text);
  if (detection.companyIds.length > 0 || detection.ambiguous) {
    return null;
  }
  const refs = Array.from(text.matchAll(REF_IN_TEXT), (match) => Number(match[1] ?? match[2]));
  return refs.every((ref) => Number.isInteger(ref) && ref >= 1 && ref <= refCount) ? text : null;
}

/**
 * Whether the router reply says the question is in English: false only for
 * "english": false with "high" confidence; anything missing or invalid (or a
 * reply that isn't JSON) counts as English.
 */
export function parseRouterEnglish(raw: string | null | undefined): boolean {
  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return true;
    }
    const { english, confidence } = parsed as Record<string, unknown>;
    return !(english === false && confidence === "high");
  } catch {
    return true;
  }
}

// ── English, read from the words ───

/** Common English function words: two different ones in a message make it English, typos and all. */
const ENGLISH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "for", "only", "and", "of", "to", "in", "with", "on", "at", "by", "from", "or", "than",
  "what", "which", "who", "where", "when", "why", "how",
  "do", "does", "is", "are", "was", "were", "be", "have", "has", "can",
  "they", "them", "their", "it", "its", "me", "you", "this", "that", "these", "those", "there",
  "about", "any",
]);

/** How many different English function words make a message English whatever the router says. */
export const MIN_ENGLISH_FUNCTION_WORDS = 2;

/**
 * True when the message holds at least two different common English function words
 * ("comoare the 3 only for locations": the, only, for). A typo-heavy English question
 * then never gets "Please ask in English." because the router misread it. The
 * non-Latin script check runs before this and is unchanged.
 */
export function hasEnglishFunctionWords(text: string): boolean {
  const words = new Set(text.toLowerCase().replace(/['’]/g, "").split(/[^a-z]+/).filter((word) => word.length > 0));
  let found = 0;
  words.forEach((word) => {
    if (ENGLISH_FUNCTION_WORDS.has(word)) {
      found += 1;
    }
  });
  return found >= MIN_ENGLISH_FUNCTION_WORDS;
}

// ── Compare, read from the words ───

/** True when the two words differ by at most one letter added, dropped, changed or swapped with its neighbour. */
function isOneEditAway(word: string, target: string): boolean {
  if (word === target) {
    return true;
  }
  if (Math.abs(word.length - target.length) > 1) {
    return false;
  }
  if (word.length === target.length) {
    const diffs: number[] = [];
    for (let i = 0; i < word.length; i += 1) {
      if (word[i] !== target[i]) {
        diffs.push(i);
      }
    }
    if (diffs.length === 1) {
      return true;
    }
    const [first, second] = diffs;
    return (
      diffs.length === 2 &&
      first !== undefined &&
      second === first + 1 &&
      word[first] === target[second] &&
      word[second] === target[first]
    );
  }
  const [shorter, longer] = word.length < target.length ? [word, target] : [target, word];
  for (let i = 0; i < longer.length; i += 1) {
    if (longer.slice(0, i) + longer.slice(i + 1) === shorter) {
      return true;
    }
  }
  return false;
}

/** Words of at least this length are checked against "compare" for a one-letter typo ("comoare"). */
const MIN_COMPARE_TYPO_LETTERS = 6;

/**
 * True when the question asks to compare: "compare", "compared", "comparison"…
 * (also with a one-letter typo such as "comoare"), "vs" / "versus", or "side by
 * side". The route sends such a question about 2–3 companies down the compare path.
 */
export function isCompareRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\bside[\s-]+by[\s-]+side\b/.test(lower)) {
    return true;
  }
  return lower
    .split(/[^a-z]+/)
    .some(
      (word) =>
        word === "vs" ||
        word === "versus" ||
        word.startsWith("compar") ||
        (word.length >= MIN_COMPARE_TYPO_LETTERS && isOneEditAway(word, "compare"))
    );
}

// ── "Which ones…" about one company ───

/** A question that starts "which ones", "which of them" or "which companies" (any case, leading punctuation ignored). */
const WHICH_ONES_QUESTION = /^[^a-z0-9]*which\s+(?:ones|of\s+them|companies)\b/i;

/**
 * True when the question starts "which ones", "which of them" or "which companies":
 * with one company open it reads as a question about many, so the pane offers
 * "Search all companies" whatever the router labelled it.
 */
export function isWhichOnesQuestion(text: string): boolean {
  return WHICH_ONES_QUESTION.test(text);
}

// ── Follow-ups: what the latest answer showed ───

/** The same cap parseHistoryQuestions uses for client-sent history. */
const FOLLOW_UP_MAX_HISTORY_ENTRIES = 100;

/** What a follow-up's "nothing new" check compares with, read from the client-sent history. */
export type FollowUpContext = {
  /** The lines the latest answer showed, by company id (empty when it showed none). */
  shownLines: Map<string, Set<string>>;
};

type HistoryTurn = { scope: ChatScope | null; lines: Map<string, Set<string>> | null };

function isSameCompanies(a: ChatScope | null, b: ChatScope): boolean {
  if (a?.mode !== "companies" || b.mode !== "companies" || a.companyIds.length !== b.companyIds.length) {
    return false;
  }
  return a.companyIds.every((id) => b.companyIds.includes(id));
}

/** An answer's lines by company id, from its items ({ companyId, text }; malformed items are skipped). */
function parseShownLines(items: unknown[]): Map<string, Set<string>> {
  const lines = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const { companyId, text } = item as Record<string, unknown>;
    if (typeof companyId !== "string" || typeof text !== "string") {
      continue;
    }
    const set = lines.get(companyId) ?? new Set<string>();
    for (const line of text.split("\n")) {
      if (line.trim()) {
        set.add(line.trim());
      }
    }
    lines.set(companyId, set);
  }
  return lines;
}

/**
 * For a follow-up (the router's is_follow_up) about the given 1–3 companies: the
 * lines the latest answer showed, from the client-sent history ({ role: "user",
 * content, scope } and { role: "assistant", items, scope }). Null when the latest
 * question is about other companies (or has no scope), there is none, or the scope
 * is All companies; its lines are empty when it has no answer (a failed request).
 * The history is client-sent: it only gives the lines to compare, never text that is
 * shown.
 */
export function parseFollowUpContext(history: unknown, scope: ChatScope): FollowUpContext | null {
  if (!Array.isArray(history) || scope.mode !== "companies") {
    return null;
  }
  let latest: HistoryTurn | null = null;
  for (const entry of history.slice(-FOLLOW_UP_MAX_HISTORY_ENTRIES)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { role, content, scope: entryScope, items } = entry as Record<string, unknown>;
    if (role === "user" && typeof content === "string") {
      latest = { scope: parseChatScope(entryScope), lines: null };
    } else if (role === "assistant" && Array.isArray(items) && latest) {
      latest.lines = parseShownLines(items);
    }
  }
  return latest && isSameCompanies(latest.scope, scope)
    ? { shownLines: latest.lines ?? new Map<string, Set<string>>() }
    : null;
}
