/**
 * data-room-chat-scope.ts
 * Pure helpers for the Data Room AI Research Assistant (no DB, no network).
 * Works out which companies a question is about: the generic-word list (derived
 * from the roster itself), type-to-pick suggestions, company detection in the
 * question text, and the scope priority used on send. Server side: scope and
 * history parsing, ref labels ([C1]…), name redaction for model input, the
 * out-of-scope mention reply, and questions about company names answered from the
 * roster. Used by ProspectingDataRoomChat (client) and POST
 * /api/student/data-room-chat (server).
 */

// ── Types and limits ───

export type ScopeCompany = {
  id: string;
  name: string;
  /** Industry label shown on the company card (its words count as generic). */
  industry: string;
};

/** What one question is about: up to 3 companies, or all companies. */
export type ChatScope = { mode: "companies"; companyIds: string[] } | { mode: "all" };

/** Most companies one question may be about (unless All companies is on). */
export const MAX_SCOPE_COMPANIES = 3;
/** Letters typed before suggestions appear. */
export const MIN_SUGGEST_LETTERS = 3;
/** Most suggestions shown at once. */
export const MAX_SUGGESTIONS = 5;
/** A first word must be at least this long to identify a company on its own. */
export const MIN_DETECT_WORD_LETTERS = 4;
/** A word used in this many company names (or more) is generic. */
export const GENERIC_NAME_WORD_MIN_COMPANIES = 3;

/** Words that never identify a company. */
export const STOP_WORDS: readonly string[] = [
  "a",
  "an",
  "and",
  "at",
  "by",
  "co",
  "company",
  "corp",
  "for",
  "in",
  "inc",
  "llc",
  "ltd",
  "of",
  "on",
  "the",
  "to",
];

export const SCOPE_NONE_MESSAGE = "Open a company or type a company's name first.";
export const SCOPE_TOO_MANY_MESSAGE = "Ask about up to 3 companies, or turn on All companies.";

// ── Words and the generic list ───

/**
 * Lowercased words of a name or text (letters and digits; everything else splits).
 */
export function toWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * Generic words, computed from the roster itself: words used in 3+ company names,
 * every word of every industry label, and stop words. Generic words never suggest,
 * detect, or identify a company.
 */
export function buildGenericWords(companies: readonly ScopeCompany[]): Set<string> {
  const generic = new Set<string>(STOP_WORDS);
  const companiesPerWord = new Map<string, number>();
  for (const company of companies) {
    for (const word of Array.from(new Set(toWords(company.name)))) {
      companiesPerWord.set(word, (companiesPerWord.get(word) ?? 0) + 1);
    }
    for (const word of toWords(company.industry)) {
      generic.add(word);
    }
  }
  companiesPerWord.forEach((count, word) => {
    if (count >= GENERIC_NAME_WORD_MIN_COMPANIES) {
      generic.add(word);
    }
  });
  return generic;
}

export type ScopeIndex = {
  companies: readonly ScopeCompany[];
  byId: ReadonlyMap<string, ScopeCompany>;
  genericWords: ReadonlySet<string>;
  /** Lowercased words of each company name, by company id. */
  nameWordsById: ReadonlyMap<string, string[]>;
  /**
   * Identifying words: each name's first word when it is non-generic and at least
   * MIN_DETECT_WORD_LETTERS long, mapped to the companies whose name starts with it.
   */
  firstWordIds: ReadonlyMap<string, string[]>;
};

/**
 * Builds the lookup tables used for suggestions, detection, and the name guard.
 */
export function buildScopeIndex(companies: readonly ScopeCompany[]): ScopeIndex {
  const genericWords = buildGenericWords(companies);
  const byId = new Map<string, ScopeCompany>();
  const nameWordsById = new Map<string, string[]>();
  const firstWordIds = new Map<string, string[]>();

  for (const company of companies) {
    byId.set(company.id, company);
    const words = toWords(company.name);
    nameWordsById.set(company.id, words);
    const first = words[0];
    if (first && first.length >= MIN_DETECT_WORD_LETTERS && !genericWords.has(first)) {
      firstWordIds.set(first, [...(firstWordIds.get(first) ?? []), company.id]);
    }
  }

  return { companies, byId, genericWords, nameWordsById, firstWordIds };
}

// ── Type-to-pick ───

export type WordFragment = {
  /** The letters typed so far for the current word. */
  fragment: string;
  /** Index in the text where the current word starts. */
  start: number;
};

/**
 * The word being typed: letters/digits immediately before the caret.
 */
export function wordFragmentBeforeCaret(text: string, caret: number): WordFragment | null {
  const end = Math.max(0, Math.min(caret, text.length));
  let start = end;
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  const fragment = text.slice(start, end);
  return fragment.length > 0 ? { fragment, start } : null;
}

/**
 * Up to MAX_SUGGESTIONS companies with a non-generic name word starting with the
 * fragment (at least MIN_SUGGEST_LETTERS letters). Companies whose first word
 * matches come first, then alphabetical.
 */
export function suggestCompanies(index: ScopeIndex, fragment: string): ScopeCompany[] {
  const prefix = fragment.toLowerCase();
  if (prefix.length < MIN_SUGGEST_LETTERS || !/^[a-z0-9]+$/.test(prefix)) {
    return [];
  }

  const matches: Array<{ company: ScopeCompany; firstWordMatch: boolean }> = [];
  for (const company of index.companies) {
    const words = index.nameWordsById.get(company.id) ?? [];
    const matching = words.filter(
      (word) => !index.genericWords.has(word) && word.startsWith(prefix)
    );
    if (matching.length > 0) {
      matches.push({ company, firstWordMatch: words[0]?.startsWith(prefix) === true });
    }
  }

  return matches
    .sort((a, b) =>
      a.firstWordMatch !== b.firstWordMatch
        ? a.firstWordMatch
          ? -1
          : 1
        : a.company.name.localeCompare(b.company.name)
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => match.company);
}

/**
 * Replaces the typed fragment (and the rest of that word) with the company name.
 * Adds a trailing space when the name ends the text. Returns the new caret position.
 */
export function insertPickedName(
  text: string,
  start: number,
  caret: number,
  name: string
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const restOfWord = text.slice(caret).match(/^[A-Za-z0-9]*/)?.[0] ?? "";
  const after = text.slice(caret + restOfWord.length);
  const inserted = after.length === 0 ? `${name} ` : name;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

// ── Detection ───

type NameMatch = { companyId: string; startWord: number; endWord: number };

/**
 * Every place a full company name appears in the text (whole words, any case).
 * Longer names are matched first so a full name wins over a shorter one inside it.
 */
function findFullNameMatches(index: ScopeIndex, words: string[]): NameMatch[] {
  const matches: NameMatch[] = [];
  const taken = new Set<number>();
  const byLength = [...index.companies].sort(
    (a, b) =>
      (index.nameWordsById.get(b.id)?.length ?? 0) - (index.nameWordsById.get(a.id)?.length ?? 0)
  );

  for (const company of byLength) {
    const nameWords = index.nameWordsById.get(company.id) ?? [];
    if (nameWords.length === 0) {
      continue;
    }
    for (let i = 0; i + nameWords.length <= words.length; i += 1) {
      const fits = nameWords.every(
        (word, offset) => words[i + offset] === word && !taken.has(i + offset)
      );
      if (fits) {
        for (let k = i; k < i + nameWords.length; k += 1) {
          taken.add(k);
        }
        matches.push({ companyId: company.id, startWord: i, endWord: i + nameWords.length });
      }
    }
  }
  return matches;
}

/**
 * True when the company's full name appears in the text.
 */
export function textContainsCompanyName(index: ScopeIndex, text: string, companyId: string): boolean {
  return findFullNameMatches(index, toWords(text)).some((match) => match.companyId === companyId);
}

export type CompanyDetection = {
  /** Detected companies, in the order they appear in the text. */
  companyIds: string[];
  /** A first word shared by 2+ companies that none of the known ids resolves. */
  ambiguous: { word: string; options: ScopeCompany[] } | null;
};

/**
 * Companies named in the text: a full name, or an identifying first word that
 * belongs to exactly one company. A first word shared by 2+ companies is
 * ambiguous unless one of them is already known (picked or named in full).
 */
export function detectCompanies(
  index: ScopeIndex,
  text: string,
  knownIds: readonly string[] = []
): CompanyDetection {
  const words = toWords(text);
  const fullMatches = findFullNameMatches(index, words);
  const covered = new Set<number>();
  const positions = new Map<string, number>();

  for (const match of fullMatches) {
    for (let k = match.startWord; k < match.endWord; k += 1) {
      covered.add(k);
    }
    if (!positions.has(match.companyId)) {
      positions.set(match.companyId, match.startWord);
    }
  }

  const resolved = new Set<string>([...knownIds, ...Array.from(positions.keys())]);
  let ambiguous: CompanyDetection["ambiguous"] = null;

  words.forEach((word, i) => {
    if (covered.has(i)) {
      return;
    }
    const ids = index.firstWordIds.get(word);
    if (!ids) {
      return;
    }
    if (ids.length === 1) {
      const [only] = ids;
      if (only && !positions.has(only)) {
        positions.set(only, i);
      }
      return;
    }
    if (!ids.some((id) => resolved.has(id)) && ambiguous === null) {
      ambiguous = {
        word,
        options: ids
          .map((id) => index.byId.get(id))
          .filter((company): company is ScopeCompany => Boolean(company)),
      };
    }
  });

  const companyIds = Array.from(positions.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  return { companyIds, ambiguous };
}

/** Out-of-scope companies a question mentions (see findOutOfScopeMentions). */
export type OutOfScopeMention = {
  companies: ScopeCompany[];
  /** True for one first word shared by 2+ companies: they are alternatives ("A or B"). */
  isEitherOr: boolean;
};

/**
 * Companies the text mentions that are NOT in scope, using the same detection as
 * the redaction (full names, and identifying first words; generic words never
 * count). A first word shared by an in-scope company counts as in scope. Null
 * when the text mentions no out-of-scope company.
 */
export function findOutOfScopeMentions(
  index: ScopeIndex,
  text: string,
  scopeIds: readonly string[]
): OutOfScopeMention | null {
  const inScope = new Set(scopeIds);
  const detection = detectCompanies(index, text, scopeIds);
  const companies = detection.companyIds
    .filter((id) => !inScope.has(id))
    .map((id) => index.byId.get(id))
    .filter((company): company is ScopeCompany => Boolean(company));
  if (companies.length > 0) {
    return { companies, isEitherOr: false };
  }
  return detection.ambiguous ? { companies: detection.ambiguous.options, isEitherOr: true } : null;
}

function joinNames(names: readonly string[], conjunction: "and" | "or"): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

/**
 * The fixed reply for a question that mentions an unselected company (names come
 * from the roster): "Your question mentions {Name}, which isn't selected. …"
 */
export function buildOutOfScopeMessage(mention: OutOfScopeMention): string {
  const names = mention.companies.map((company) => company.name);
  if (names.length > 1 && !mention.isEitherOr) {
    return `Your question mentions ${joinNames(names, "and")}, which aren't selected. Type their names and press Enter, or open them from the list, and I'll answer about them.`;
  }
  return `Your question mentions ${joinNames(names, "or")}, which isn't selected. Type its name and press Enter, or open it from the list, and I'll answer about it.`;
}

// ── Scope on send ───

/** The previous question: its scope, and the company that was open when it was sent. */
export type LastQuestion = {
  scope: ChatScope;
  openCompanyId: string | null;
  /** The companies its answer listed (an All-companies list answer); empty or omitted otherwise. */
  listedIds?: readonly string[];
};

/** Most listed companies "Which one did you mean?" offers after an All-companies list. */
export const MAX_LIST_FOLLOW_UP_OPTIONS = 10;

export type ScopeInput = {
  index: ScopeIndex;
  text: string;
  allCompanies: boolean;
  /** Companies picked from suggestions (or from "Which one did you mean?"). */
  pickedIds: readonly string[];
  openCompanyId: string | null;
  /** The previous question, for follow-ups that name no company (null or omitted: none). */
  lastQuestion?: LastQuestion | null;
};

export type ScopeDecision =
  | { kind: "send"; scope: ChatScope }
  | { kind: "ask"; word: string; options: ScopeCompany[] }
  | { kind: "error"; message: string };

/**
 * Follow-up scope: the previous question's 1–3 companies, as long as the student
 * hasn't opened a different company since it was sent (the open company then is
 * compared with the open company now). Null when it doesn't apply, including when
 * the previous question was about All companies.
 */
function followUpScopeIds(input: ScopeInput): string[] | null {
  const last = input.lastQuestion;
  if (!last || last.scope.mode !== "companies" || last.openCompanyId !== input.openCompanyId) {
    return null;
  }
  const ids = last.scope.companyIds.filter((id) => input.index.byId.has(id));
  return ids.length > 0 ? ids : null;
}

// "it" and "its" are matched as typed lowercase or capitalized, so all-caps "IT"
// (information technology) is not a back-reference.
const SINGULAR_BACK_REFERENCE =
  /\b(?:[Ii]ts?|(?:this|that|the)\s+company|(?:this|that)\s+one)\b/;
const PLURAL_BACK_REFERENCE =
  /\b(?:they|them|their|theirs|these|those|both|each|all|either|companies|ones)\b/i;

/**
 * The singular back-reference in a follow-up ("it", "its", "this/that company",
 * "this/that one", "the company"), lowercased, or null. A message that also refers
 * to several companies ("they", "both", …) goes to all of them, so it returns null.
 */
function singularBackReference(text: string): string | null {
  if (PLURAL_BACK_REFERENCE.test(text)) {
    return null;
  }
  const match = text.match(SINGULAR_BACK_REFERENCE);
  return match ? match[0].toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Right after an All-companies list, a singular back-reference ("it", "that one")
 * that names no company is about the listed companies, even with All companies on:
 * one listed (or one picked from "Which one did you mean?") → that company; more →
 * ask which one, offering the first 10. Only while the student hasn't opened a
 * different company since; null when it doesn't apply.
 */
function listFollowUp(input: ScopeInput): ScopeDecision | null {
  const last = input.lastQuestion;
  if (!last || last.scope.mode !== "all" || last.openCompanyId !== input.openCompanyId) {
    return null;
  }
  const listed = (last.listedIds ?? []).filter((id) => input.index.byId.has(id));
  const reference = singularBackReference(input.text);
  const detection = detectCompanies(input.index, input.text);
  if (listed.length === 0 || !reference || detection.companyIds.length > 0 || detection.ambiguous) {
    return null;
  }
  const target = input.pickedIds.find((id) => listed.includes(id)) ?? (listed.length === 1 ? listed[0] : undefined);
  if (target) {
    return { kind: "send", scope: { mode: "companies", companyIds: [target] } };
  }
  const options = listed
    .slice(0, MAX_LIST_FOLLOW_UP_OPTIONS)
    .map((id) => input.index.byId.get(id))
    .filter((company): company is ScopeCompany => Boolean(company));
  return { kind: "ask", word: reference, options };
}

/**
 * Scope for sending, in priority order: (0) a singular back-reference right after
 * an All-companies list → the listed companies (see listFollowUp); (1) All
 * companies; (2) picked companies plus companies named in the text (an ambiguous
 * first word asks instead, and more than 3 is an error); (3) the previous
 * question's companies, unless a different company was opened since (with 2–3 of
 * them, a singular back-reference such as "it" asks which one instead); (4) the
 * open company; (5) nothing → error.
 */
export function resolveSendScope(input: ScopeInput): ScopeDecision {
  const fromList = listFollowUp(input);
  if (fromList) {
    return fromList;
  }
  if (input.allCompanies) {
    return { kind: "send", scope: { mode: "all" } };
  }

  const picked = input.pickedIds.filter((id) => input.index.byId.has(id));
  const detection = detectCompanies(input.index, input.text, picked);
  if (detection.ambiguous) {
    return { kind: "ask", word: detection.ambiguous.word, options: detection.ambiguous.options };
  }

  const ids = Array.from(new Set([...picked, ...detection.companyIds]));
  if (ids.length > MAX_SCOPE_COMPANIES) {
    return { kind: "error", message: SCOPE_TOO_MANY_MESSAGE };
  }
  if (ids.length > 0) {
    return { kind: "send", scope: { mode: "companies", companyIds: ids } };
  }
  const followUp = followUpScopeIds(input);
  if (followUp) {
    const reference = followUp.length > 1 ? singularBackReference(input.text) : null;
    if (reference) {
      const options = followUp
        .map((id) => input.index.byId.get(id))
        .filter((company): company is ScopeCompany => Boolean(company));
      return { kind: "ask", word: reference, options };
    }
    return { kind: "send", scope: { mode: "companies", companyIds: followUp } };
  }
  if (input.openCompanyId && input.index.byId.has(input.openCompanyId)) {
    return { kind: "send", scope: { mode: "companies", companyIds: [input.openCompanyId] } };
  }
  return { kind: "error", message: SCOPE_NONE_MESSAGE };
}

export type ScopePreview =
  | { kind: "all" }
  | { kind: "companies"; companies: ScopeCompany[] }
  | { kind: "none" };

/**
 * Live scope for the "Current:" line: the same priority as resolveSendScope
 * (including follow-ups), but an ambiguous word or too many companies never
 * blocks the preview.
 */
export function previewScope(input: ScopeInput): ScopePreview {
  const fromList = listFollowUp(input);
  if (fromList?.kind === "send" && fromList.scope.mode === "companies") {
    const companies = fromList.scope.companyIds
      .map((id) => input.index.byId.get(id))
      .filter((company): company is ScopeCompany => Boolean(company));
    return { kind: "companies", companies };
  }
  if (input.allCompanies) {
    return { kind: "all" };
  }
  const picked = input.pickedIds.filter((id) => input.index.byId.has(id));
  const detected = detectCompanies(input.index, input.text, picked).companyIds;
  const ids = Array.from(new Set([...picked, ...detected]));
  const openCompanyIds =
    input.openCompanyId && input.index.byId.has(input.openCompanyId) ? [input.openCompanyId] : [];
  const fallback = ids.length > 0 ? ids : followUpScopeIds(input) ?? openCompanyIds;
  const companies = fallback
    .map((id) => input.index.byId.get(id))
    .filter((company): company is ScopeCompany => Boolean(company));
  return companies.length > 0 ? { kind: "companies", companies } : { kind: "none" };
}

// ── Server: request parsing ───

const MAX_HISTORY_ENTRIES = 100;
const MAX_TEXT_LENGTH = 8_000;

/**
 * Parses a request scope: { mode: "all" } or { mode: "companies", companyIds }
 * with 1–3 distinct non-empty ids. Anything else is null.
 */
export function parseChatScope(raw: unknown): ChatScope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { mode, companyIds } = raw as { mode?: unknown; companyIds?: unknown };
  if (mode === "all") {
    return { mode: "all" };
  }
  if (mode !== "companies" || !Array.isArray(companyIds)) {
    return null;
  }
  const ids: string[] = [];
  for (const value of companyIds) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const id = value.trim();
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.length >= 1 && ids.length <= MAX_SCOPE_COMPANIES
    ? { mode: "companies", companyIds: ids }
    : null;
}

/**
 * The student's earlier questions from client-sent history, oldest first (the router
 * reads the last few; no selection call sees history). Answers and malformed entries
 * are ignored; the route redacts company names in the questions.
 */
export function parseHistoryQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(-MAX_HISTORY_ENTRIES).flatMap((entry): string[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const { role, content } = entry as Record<string, unknown>;
    return role === "user" && typeof content === "string" ? [content.slice(0, MAX_TEXT_LENGTH)] : [];
  });
}

/**
 * Ref labels for the companies in scope, in order: id → "C1", "C2", ….
 */
export function buildRefLabels(companyIds: readonly string[]): Map<string, string> {
  return new Map(companyIds.map((id, i) => [id, `C${i + 1}`]));
}

// ── Server: name redaction ───

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word pattern for a name's words, any separators between them. */
function wordsPattern(words: readonly string[]): string {
  return `(?<![A-Za-z0-9])${words.map(escapeRegExp).join("[^A-Za-z0-9]+")}(?![A-Za-z0-9])`;
}

/** The first word of a name exactly as written (for case-sensitive redaction). */
export function firstWordAsWritten(name: string): string {
  return name.trim().match(/^[A-Za-z0-9]+/)?.[0] ?? "";
}

export type FirstWordReplacement = {
  word: string;
  replacement: string;
  caseSensitive: boolean;
};

/**
 * Replaces every full company name (any case, whole words; longest first) with
 * fullNameReplacement(companyId), then each listed first word with its replacement.
 */
export function redactCompanyMentions(
  text: string,
  index: ScopeIndex,
  fullNameReplacement: (companyId: string) => string,
  firstWords: readonly FirstWordReplacement[] = []
): string {
  let out = text;
  const byLength = [...index.companies].sort(
    (a, b) =>
      (index.nameWordsById.get(b.id)?.length ?? 0) - (index.nameWordsById.get(a.id)?.length ?? 0)
  );
  for (const company of byLength) {
    const words = index.nameWordsById.get(company.id) ?? [];
    if (words.length > 0) {
      out = out.replace(new RegExp(wordsPattern(words), "gi"), fullNameReplacement(company.id));
    }
  }
  for (const entry of firstWords) {
    if (entry.word.length > 0) {
      out = out.replace(
        new RegExp(wordsPattern([entry.word]), entry.caseSensitive ? "g" : "gi"),
        entry.replacement
      );
    }
  }
  return out;
}

// ── Server: questions about company names ───

/** A question about company NAMES, answered by the server from the database. */
export type NameQuery = {
  kind: "startsWith" | "contains" | "list";
  /** The letters or word asked about ("" for a list). */
  value: string;
};

/** Most company names one name answer lists. */
export const NAME_QUERY_MAX_RESULTS = 15;

// The value asked about: a quoted phrase, or one word that ends the sentence (so
// "start with on Mondays" or "start with a trial" are not name questions).
const NAME_VALUE = `(?:["“]([^"”]{1,40})["”]|'([^']{1,40})'|([a-z0-9][a-z0-9&-]{0,29}))`;
const VALUE_END = `(?=\\s*(?:[?.!,;:]|$))`;
const LETTER_OR_WORD = `(?:the\\s+)?(?:letters?\\s+|word\\s+)?`;

// A starts-with verb, typos included: any word starting "sta" or "beg", 5–9 letters,
// followed by "with" (start, starting, startign, begins, beginning …).
const STARTS_WITH_PATTERN = new RegExp(
  `\\b((?:sta|beg)[a-z]{2,6})\\s+with\\s+${LETTER_OR_WORD}${NAME_VALUE}${VALUE_END}`,
  "i"
);
const CORRECT_STARTS_WITH_VERB = /^(?:start(?:s|ing)?|begin(?:s|ning)?)$/i;
// A typo'd verb counts only in a name context or for a letter or two, so ordinary
// questions like "Are they staffed with nurses?" are never name questions.
const NAME_CONTEXT = /\b(?:names?|compan(?:y|ies)|business(?:es)?)\b/i;
const MAX_TYPO_VALUE_LENGTH_WITHOUT_CONTEXT = 2;
const NAMES_CONTAINING_PATTERN = new RegExp(
  `\\bnames?\\s+(?:with|containing|that\\s+contains?|contains?|including|that\\s+includes?|having)\\s+${LETTER_OR_WORD}${NAME_VALUE}${VALUE_END}`,
  "i"
);
const IN_THE_NAME_PATTERN = new RegExp(
  `\\bwith\\s+${LETTER_OR_WORD}${NAME_VALUE}\\s+in\\s+(?:the|their|its)\\s+names?\\b`,
  "i"
);
// "called X" / "named X" only after a company word, so "the named contact" isn't one.
const CALLED_PATTERN = new RegExp(
  `\\b(?:compan(?:y|ies)|ones?|business(?:es)?|anything|anyone|something|any)\\s+(?:that\\s+(?:is|are)\\s+|which\\s+(?:is|are)\\s+)?(?:called|named)\\s+${NAME_VALUE}${VALUE_END}`,
  "i"
);
const LIST_PATTERNS = [
  /\b(?:list|show|give|tell|what\s+are)\b[^?.!]{0,40}?\b(?:compan(?:y|ies)|business(?:es)?)['’]?\s*names\b/i,
  /\bnames\s+of\s+(?:all\s+)?(?:the\s+)?(?:compan(?:y|ies)|business(?:es)?)\b/i,
  /\b(?:list|show)\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:compan(?:y|ies)|business(?:es)?)\s*(?:[?.!]|$)/i,
];

/** The NAME_VALUE groups (quoted, single-quoted, bare) start at `firstGroup`. */
function matchedValue(match: RegExpMatchArray | null, firstGroup = 1): string | null {
  const value = match
    ? match[firstGroup] ?? match[firstGroup + 1] ?? match[firstGroup + 2]
    : undefined;
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** The starts-with value, if the text asks which names start with something. */
function startsWithValue(text: string): string | null {
  const match = text.match(STARTS_WITH_PATTERN);
  const value = matchedValue(match, 2);
  if (!match || !value) {
    return null;
  }
  const isTypo = !CORRECT_STARTS_WITH_VERB.test(match[1] ?? "");
  return !isTypo || NAME_CONTEXT.test(text) || value.length <= MAX_TYPO_VALUE_LENGTH_WITHOUT_CONTEXT
    ? value
    : null;
}

/**
 * Recognizes a question about company NAMES (deterministic, no AI), checked in
 * this order so starts-with and contains beat a list:
 * "start(s/ing) with X" / "begin(s/ning) with X" (typos too, e.g. "startign with")
 * → startsWith; "names with / containing X", "with X in the name", "a company
 * called / named X" → contains; "list (all) company names", "names of all
 * companies", "list all companies" → list. Returns null for anything else (e.g.
 * "tell me about them").
 */
export function parseNameQuery(text: string): NameQuery | null {
  const startsWith = startsWithValue(text);
  if (startsWith) {
    return { kind: "startsWith", value: startsWith };
  }
  const contains =
    matchedValue(text.match(NAMES_CONTAINING_PATTERN)) ??
    matchedValue(text.match(IN_THE_NAME_PATTERN)) ??
    matchedValue(text.match(CALLED_PATTERN));
  if (contains) {
    return { kind: "contains", value: contains };
  }
  return LIST_PATTERNS.some((pattern) => pattern.test(text)) ? { kind: "list", value: "" } : null;
}

/** Roster fields a name answer shows (all from the database). */
export type NameQueryCompany = {
  id: string;
  name: string;
  industry: string;
  locations: number | null;
  metro: string | null;
};

/**
 * One company's line in a list answer (name questions, All-companies filters):
 * "{Industry} · {N} locations · {Metro}", from the roster.
 */
export function formatRosterListLine(company: Omit<NameQueryCompany, "id" | "name">): string {
  return [
    company.industry.trim(),
    company.locations !== null ? `${company.locations} ${company.locations === 1 ? "location" : "locations"}` : "",
    company.metro?.trim() ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}

/**
 * The server's reply to a name question, built only from the roster (names never
 * come from the model): up to 15 matching companies in the question's scope, A–Z,
 * each with "{Industry} · {N} locations · {Metro}".
 */
export function answerNameQuery(query: NameQuery, companies: readonly NameQueryCompany[]): ScopedAnswer {
  const needle = query.value.toLowerCase();
  const matches = companies
    .filter((company) => {
      const name = company.name.toLowerCase();
      return query.kind === "startsWith"
        ? name.startsWith(needle)
        : query.kind === "contains"
          ? name.includes(needle)
          : true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // A single letter reads best in capitals ("S"); longer values stay as typed.
  const shownValue = query.value.length === 1 ? query.value.toUpperCase() : query.value;
  const condition =
    query.kind === "startsWith"
      ? `start with "${shownValue}"`
      : query.kind === "contains"
        ? `contain "${shownValue}"`
        : null;

  if (matches.length === 0) {
    return { intro: condition ? `No company names ${condition}.` : "No company names to list.", items: [] };
  }

  const heading = condition ? `Companies whose names ${condition}` : "Company names";
  const extra = matches.length - NAME_QUERY_MAX_RESULTS;
  const intro =
    extra > 0
      ? `${heading} (the first ${NAME_QUERY_MAX_RESULTS}, A–Z), and ${extra} more. Use the search box above the list to see them all.`
      : `${heading}:`;

  return {
    intro,
    items: matches.slice(0, NAME_QUERY_MAX_RESULTS).map((company) => ({
      companyId: company.id,
      companyName: company.name,
      text: formatRosterListLine(company),
    })),
  };
}

// ── Server: the answer ───

/** The route's reply: an optional intro and one block per company (names from the database). */
export type ScopedAnswer = {
  intro: string;
  items: Array<{ companyId: string; companyName: string; text: string }>;
};
