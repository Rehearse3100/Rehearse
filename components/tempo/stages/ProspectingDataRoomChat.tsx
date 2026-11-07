/**
 * ProspectingDataRoomChat.tsx
 * Data Room AI Research Assistant: one transcript for the whole Data Room.
 * A sliding "Selected | All companies" switch above the input picks the mode, with
 * a hint line under it. Selected: each question is about a scope worked out live
 * (lib/data-room-chat-scope.ts): companies picked from suggestions or named in the
 * text, the previous question's companies (follow-ups, until a different company is
 * opened; right after an All-companies list, "it" means a listed company), or the
 * open company. Type-to-pick: after 3 letters, matching companies appear in a
 * dropdown above the input (Enter picks the highlighted one, then Enter sends); "Which one did you
 * mean?" uses the same dropdown. All companies: no name suggestions or highlighting,
 * and every question goes out as typed with scope all (it never leaves the mode).
 * The server receives company ids only and returns per-company blocks; names shown
 * come from the server reply. Replies render as text blocks, a result table or a
 * compare table (DataRoomChatAnswer.tsx); a filter question about one company offers
 * "Search all companies", which asks it again in All companies mode. The input takes at
 * most 500 characters, with an "N / 500" counter past 400 (lib/data-room-chat-guard.ts).
 */

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import { answerLayoutOf, DataRoomChatAnswer, SearchAllCompaniesButton } from "@/components/tempo/stages/DataRoomChatAnswer";
import { DATA_ROOM_CHAT_COUNTER_FROM, DATA_ROOM_CHAT_MAX_CHARS } from "@/lib/data-room-chat-guard";
import {
  buildScopeIndex,
  insertPickedName,
  previewScope,
  resolveSendScope,
  suggestCompanies,
  textContainsCompanyName,
  wordFragmentBeforeCaret,
  type AnswerCard,
  type AnswerLayout,
  type ChatScope,
  type LastQuestion,
  type ScopeCompany,
  type ScopeDecision,
  type ScopedAnswerItem,
  type ScopeIndex,
  type ScopeInput,
  type ScopePreview,
} from "@/lib/data-room-chat-scope";
import { DATA_ROOM_CHAT_STORAGE_PREFIX, sanitizeAiResearchReply } from "@/lib/tempo-prospecting";

// Dropdown motion, the same as the ☰ menu (TempoStageMenu). Open: fade in and drop
// 4px into place (150ms ease-out); visibility isn't transitioned, so it shows at once.
const PANEL_OPEN =
  "visible opacity-100 translate-y-0 scale-100 transition-[opacity,transform] duration-150 ease-out";
// Close: the reverse (100ms ease-in); visibility is transitioned, so it hides after the fade.
const PANEL_CLOSED =
  "invisible opacity-0 -translate-y-1 scale-[0.98] pointer-events-none transition-[opacity,transform,visibility] duration-100 ease-in";

/** What the dropdown above the input shows: suggestions, or "Which one did you mean?". */
type DropdownPanel = {
  mode: "suggestions" | "ambiguity";
  rows: ScopeCompany[];
  highlighted: number;
};

/** One company's block in a reply; card and signals only come with table and compare replies. */
type AnswerItem = ScopedAnswerItem;

export type UserMessage = {
  id: string;
  role: "user";
  content: string;
  /** The final resolved scope this question was sent with. */
  scope: ChatScope;
  /**
   * Company open on the company page when it was sent (follow-ups compare it with
   * the open company now). Missing on questions saved before 2026-10-15.
   */
  openCompanyId?: string | null;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  scope: ChatScope;
  intro: string;
  items: AnswerItem[];
  /** "table" or "compare" from the server; missing on replies saved before tables (shown as text). */
  layout?: AnswerLayout;
  /** A filter question about one company: "Search all companies" is offered under it. */
  suggestAllCompanies?: boolean;
  /** "Search all companies" was used on this reply, so it isn't offered again. */
  isSearchAllUsed?: boolean;
  /** Request failures are shown but never sent back as history. */
  isError?: boolean;
};

export type TranscriptMessage = UserMessage | AssistantMessage;

type ChatReply = {
  intro?: unknown;
  items?: unknown;
  layout?: unknown;
  suggestAllCompanies?: unknown;
  error?: unknown;
};

type TextRange = { start: number; end: number };

/**
 * Where the selected companies' names sit in the input text, for colouring only:
 * full names (longest first), then an identifying first word that belongs to one
 * company, matched word by word the same way detection reads the text.
 */
function findSelectedNameRanges(
  text: string,
  index: ScopeIndex,
  companyIds: readonly string[]
): TextRange[] {
  if (companyIds.length === 0 || text.length === 0) {
    return [];
  }
  const tokens = Array.from(text.matchAll(/[A-Za-z0-9]+/g), (match) => ({
    word: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const taken = new Set<number>();
  const ranges: TextRange[] = [];
  const byLength = [...companyIds].sort(
    (a, b) => (index.nameWordsById.get(b)?.length ?? 0) - (index.nameWordsById.get(a)?.length ?? 0)
  );
  for (const id of byLength) {
    const nameWords = index.nameWordsById.get(id) ?? [];
    if (nameWords.length === 0) {
      continue;
    }
    for (let i = 0; i + nameWords.length <= tokens.length; i += 1) {
      const fits = nameWords.every((word, k) => tokens[i + k]?.word === word && !taken.has(i + k));
      if (fits) {
        for (let k = i; k < i + nameWords.length; k += 1) {
          taken.add(k);
        }
        ranges.push({ start: tokens[i]?.start ?? 0, end: tokens[i + nameWords.length - 1]?.end ?? 0 });
      }
    }
  }
  const selected = new Set(companyIds);
  tokens.forEach((token, i) => {
    const ids = index.firstWordIds.get(token.word);
    if (!taken.has(i) && ids?.length === 1 && selected.has(ids[0] ?? "")) {
      ranges.push({ start: token.start, end: token.end });
    }
  });
  return ranges.sort((a, b) => a.start - b.start);
}

type TextSegment = { text: string; isSelected: boolean };

/** Splits text into plain and selected-name segments (ranges sorted, non-overlapping). */
function splitIntoSegments(text: string, ranges: readonly TextRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let start = 0;
  for (const range of ranges) {
    if (range.start > start) {
      segments.push({ text: text.slice(start, range.start), isSelected: false });
    }
    segments.push({ text: text.slice(range.start, range.end), isSelected: true });
    start = range.end;
  }
  if (start < text.length) {
    segments.push({ text: text.slice(start), isSelected: false });
  }
  return segments;
}

/** Short unique id for transcript keys. */
function newMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Loose check for a transcript restored from browser storage. */
function isTranscript(value: unknown): value is TranscriptMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as TranscriptMessage).id === "string" &&
        ((item as TranscriptMessage).role === "user" ||
          (item as TranscriptMessage).role === "assistant") &&
        typeof (item as TranscriptMessage).scope === "object"
    )
  );
}

// The transcript lives in localStorage until Restart clears it
// (clearDataRoomChatFromStorage), so leaving the Data Room or reloading keeps it.
function loadTranscript(attemptId: string): TranscriptMessage[] {
  try {
    const key = `${DATA_ROOM_CHAT_STORAGE_PREFIX}${attemptId}`;
    // Earlier versions kept it in sessionStorage; read that copy once if needed.
    const raw = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return isTranscript(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTranscript(attemptId: string, messages: TranscriptMessage[]): void {
  try {
    window.localStorage.setItem(`${DATA_ROOM_CHAT_STORAGE_PREFIX}${attemptId}`, JSON.stringify(messages));
  } catch {
    /* storage unavailable: the transcript still lives in memory */
  }
}

/** A card from the server reply, or undefined when any value has the wrong type. */
function parseAnswerCard(value: unknown): AnswerCard | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const { industry, locations, metro, inTerritory, onlineBooking } = value as Record<string, unknown>;
  const isNullableBoolean = (field: unknown): field is boolean | null => field === null || typeof field === "boolean";
  if (
    typeof industry !== "string" ||
    !(locations === null || (typeof locations === "number" && Number.isFinite(locations))) ||
    !(metro === null || typeof metro === "string") ||
    !isNullableBoolean(inTerritory) ||
    !isNullableBoolean(onlineBooking)
  ) {
    return undefined;
  }
  return { industry, locations: locations as number | null, metro: metro as string | null, inTerritory, onlineBooking };
}

/**
 * Server reply → answer items (names are the server's, never typed by the model),
 * with the card values and signals tables use when they are well formed.
 */
export function parseAnswerItems(value: unknown): AnswerItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): AnswerItem[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const { companyId, companyName, text, card, signals } = item as Record<string, unknown>;
    if (typeof companyId !== "string" || typeof companyName !== "string" || typeof text !== "string") {
      return [];
    }
    const parsedCard = parseAnswerCard(card);
    const parsedSignals =
      Array.isArray(signals) && signals.every((signal) => typeof signal === "string")
        ? signals.map((signal: string) => sanitizeAiResearchReply(signal))
        : undefined;
    return [
      {
        companyId,
        companyName,
        text: sanitizeAiResearchReply(text),
        ...(parsedCard ? { card: parsedCard } : {}),
        ...(parsedSignals ? { signals: parsedSignals } : {}),
      },
    ];
  });
}

/** The server's layout, or undefined (text blocks). */
function parseAnswerLayout(value: unknown): AnswerLayout | undefined {
  return value === "list" || value === "table" || value === "compare" ? value : undefined;
}

/** History entry sent to the server: ids and text only, never company names. */
function toHistoryEntry(message: TranscriptMessage): Record<string, unknown> {
  if (message.role === "user") {
    return { role: "user", content: message.content, scope: message.scope };
  }
  return {
    role: "assistant",
    intro: message.intro,
    items: message.items.map((item) => ({ companyId: item.companyId, text: item.text })),
    scope: message.scope,
  };
}

// ── Mode: the switch, its hint, and what each mode does ───

/** Input placeholders by mode (no sample question: placeholders never suggest an answer). */
export const SELECTED_PLACEHOLDER = "Ask about this company…";
export const ALL_COMPANIES_PLACEHOLDER = "Filter all companies…";

/** The input's placeholder in this mode. */
export function chatPlaceholder(isAll: boolean): string {
  return isAll ? ALL_COMPANIES_PLACEHOLDER : SELECTED_PLACEHOLDER;
}

/**
 * The switch side a key moves to (radiogroup keys): ←/↑/Home → Selected (false),
 * →/↓/End → All companies (true); null for any other key.
 */
export function scopeSwitchTarget(key: string): boolean | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
    case "Home":
      return false;
    case "ArrowRight":
    case "ArrowDown":
    case "End":
      return true;
    default:
      return null;
  }
}

/** Company-name suggestions for the word before the caret; none in All companies mode or while hidden. */
export function composerSuggestions(
  index: ScopeIndex,
  text: string,
  caret: number,
  isAll: boolean,
  isHidden: boolean
): ScopeCompany[] {
  const fragment = wordFragmentBeforeCaret(text, caret);
  return isAll || isHidden || !fragment ? [] : suggestCompanies(index, fragment.fragment);
}

/**
 * Where a question goes. All companies: always scope all, as typed (naming a company
 * or "it" after a list never leaves the mode). Selected: resolveSendScope, unchanged.
 */
export function composerSendDecision(input: ScopeInput): ScopeDecision {
  return input.allCompanies ? { kind: "send", scope: { mode: "all" } } : resolveSendScope(input);
}

/** The live scope the hint shows: "all" in All companies mode, else previewScope (as the "Current:" line was). */
export function composerPreview(input: ScopeInput): ScopePreview {
  return input.allCompanies ? { kind: "all" } : previewScope(input);
}

/**
 * The question to ask again about every company, when the reply with this id is the
 * latest message, offers "Search all companies", hasn't used it and follows a
 * question; null otherwise (so the pill shows only once, on the latest reply).
 */
export function searchAllRequest(
  messages: readonly TranscriptMessage[],
  replyId: string
): { text: string; scope: ChatScope } | null {
  const reply = messages[messages.length - 1];
  const question = messages[messages.length - 2];
  if (
    reply?.role !== "assistant" ||
    reply.id !== replyId ||
    !reply.suggestAllCompanies ||
    reply.isSearchAllUsed ||
    reply.isError ||
    question?.role !== "user"
  ) {
    return null;
  }
  return { text: question.content, scope: { mode: "all" } };
}

const SCOPE_OPTIONS = [
  { isAll: false, label: "Selected", icon: "corporate_fare" },
  { isAll: true, label: "All companies", icon: "domain_verification" },
] as const;

/**
 * "Selected | All companies": a two-part segmented control whose navy pill slides to
 * the chosen side (200ms; none with reduced motion). A radiogroup: click a side, or
 * use the arrow keys, Home or End; the chosen side is the one tab stop.
 */
export function ScopeSwitch({
  isAll,
  onChange,
}: {
  isAll: boolean;
  onChange: (isAll: boolean) => void;
}): React.ReactElement {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const target = scopeSwitchTarget(event.key);
    if (target === null) {
      return;
    }
    event.preventDefault();
    onChange(target);
    optionRefs.current[target ? 1 : 0]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Ask about"
      className="relative grid grid-cols-2 p-0.5 bg-white border border-outline-variant rounded-full text-[12px] font-medium select-none shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {/* The pill: half the track, slid to the chosen side. */}
      <span
        aria-hidden="true"
        data-side={isAll ? "all" : "selected"}
        className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-primary-container shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none ${
          isAll ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {SCOPE_OPTIONS.map((option, i) => {
        const isChecked = option.isAll === isAll;
        return (
          <button
            key={option.label}
            ref={(element) => {
              optionRefs.current[i] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isChecked}
            tabIndex={isChecked ? 0 : -1}
            onClick={() => onChange(option.isAll)}
            onKeyDown={handleKeyDown}
            className={`relative z-10 py-1.5 px-3 rounded-full flex items-center justify-center gap-1.5 transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 ${
              isChecked ? "text-white font-semibold" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <MaterialIcon name={option.icon} className="text-[15px]" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const HINT_CLASS = "px-1 text-[12px] leading-tight text-on-surface-variant";

/**
 * The line under the switch. Selected: "Asking about {names}. Name other companies
 * to compare." (the companies the next question is about; "Open a company or type a
 * company's name" when none). All companies: "Filtering all {N} companies by …".
 */
export function ScopeHint({
  isAll,
  preview,
  total,
}: {
  isAll: boolean;
  preview: ScopePreview;
  total: number;
}): React.ReactElement {
  if (isAll) {
    return (
      <p className={HINT_CLASS}>
        Filtering all {total} {total === 1 ? "company" : "companies"} by industry, city or state, locations, territory or
        online booking.
      </p>
    );
  }
  if (preview.kind === "companies") {
    return (
      <p className={HINT_CLASS}>
        Asking about{" "}
        <span className="font-medium text-on-surface">{preview.companies.map((company) => company.name).join(", ")}</span>.
        Name other companies to compare.
      </p>
    );
  }
  return <p className={HINT_CLASS}>Open a company or type a company&apos;s name</p>;
}

type ProspectingDataRoomChatProps = {
  attemptId: string;
  companies: DataRoomCompany[];
  /** Company open on the company page (default scope). */
  openCompanyId: string | null;
  /** Shown as a close button on narrow screens (slide-over). */
  onClose?: () => void;
};

/**
 * AI Research Assistant pane: transcript, the "Selected | All companies" switch with its
 * hint line, and the input with its suggestions / "Which one did you mean?" dropdown.
 */
export function ProspectingDataRoomChat({
  attemptId,
  companies,
  openCompanyId,
  onClose,
}: ProspectingDataRoomChatProps): React.ReactElement {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [hasRestored, setHasRestored] = useState(false);
  const [input, setInput] = useState("");
  const [caret, setCaret] = useState(0);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [allCompanies, setAllCompanies] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [ambiguity, setAmbiguity] = useState<{ word: string; options: ScopeCompany[] } | null>(
    null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  // Wraps the dropdown and the input (outside-click detection).
  const comboRef = useRef<HTMLDivElement>(null);
  // Mirror of the input text behind it, where selected company names are coloured.
  const mirrorRef = useRef<HTMLDivElement>(null);
  // Last open dropdown, kept on screen while the close animation plays.
  const lastPanelRef = useRef<DropdownPanel | null>(null);
  const listboxId = useId();

  const index = useMemo(
    () =>
      buildScopeIndex(
        companies.map((company) => ({
          id: company.id,
          name: company.name,
          industry: company.industry,
        }))
      ),
    [companies]
  );

  // "Industry · City" under each dropdown row, so look-alike names can be told apart.
  const detailById = useMemo(
    () =>
      new Map(
        companies.map((company) => {
          const city = company.metro?.split(",")[0]?.trim() ?? "";
          return [company.id, [company.industry, city].filter((part) => part.length > 0).join(" · ")];
        })
      ),
    [companies]
  );

  // Restore after mount (browser storage is client-only), then mirror every change.
  useEffect(() => {
    setMessages(loadTranscript(attemptId));
    setHasRestored(true);
  }, [attemptId]);

  useEffect(() => {
    if (hasRestored) {
      saveTranscript(attemptId, messages);
    }
  }, [attemptId, hasRestored, messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  // Put the caret after a picked name once the new text has rendered.
  useEffect(() => {
    const position = pendingCaretRef.current;
    if (position === null) {
      return;
    }
    pendingCaretRef.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(position, position);
  }, [input]);

  // Suggestion picks only count while their full name is still in the text.
  const activePickedIds = pickedIds.filter((id) => textContainsCompanyName(index, input, id));

  // Follow-ups: the latest sent question's resolved scope and the company open when it
  // was sent. Every question saves both on its transcript entry, however its scope was
  // chosen (picked, full name, unique word, ambiguity choice, open company, follow-up),
  // so this survives remounts and reloads. Older entries without it don't count. After
  // an All-companies question, the companies its answer listed come along too.
  const lastQuestion = useMemo((): LastQuestion | null => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.role === "user") {
        const { openCompanyId: openAtSend } = message;
        if (typeof openAtSend !== "string" && openAtSend !== null) {
          return null;
        }
        const reply = messages[i + 1];
        const listedIds =
          message.scope.mode === "all" && reply?.role === "assistant" && !reply.isError
            ? reply.items.map((item) => item.companyId)
            : [];
        return { scope: message.scope, openCompanyId: openAtSend, listedIds };
      }
    }
    return null;
  }, [messages]);

  const fragment = wordFragmentBeforeCaret(input, caret);
  // No name suggestions in All companies mode (names aren't picked there).
  const suggestions = composerSuggestions(index, input, caret, allCompanies, suggestionsHidden);

  // "Which one did you mean?" takes the dropdown over from suggestions while it's open.
  const panelRows = ambiguity ? ambiguity.options : suggestions;
  const highlighted = Math.min(highlight, Math.max(0, panelRows.length - 1));
  const panel: DropdownPanel | null =
    panelRows.length > 0
      ? { mode: ambiguity ? "ambiguity" : "suggestions", rows: panelRows, highlighted }
      : null;
  if (panel) {
    lastPanelRef.current = panel;
  }
  const shownPanel = panel ?? lastPanelRef.current;
  const isPanelOpen = panel !== null;
  const optionId = (companyId: string): string => `${listboxId}-option-${companyId}`;
  const activeOption = panel ? panel.rows[panel.highlighted] : undefined;
  const activeOptionId = activeOption ? optionId(activeOption.id) : null;

  // The list can scroll (up to 10 rows after an All-companies list): keep the highlighted row in view.
  useEffect(() => {
    if (activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOptionId]);

  // Close the dropdown on a click anywhere outside it and the input.
  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      if (comboRef.current && !comboRef.current.contains(event.target as Node)) {
        setSuggestionsHidden(true);
        setAmbiguity(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isPanelOpen]);

  // What the next question is about (the hint line); always "all" in All companies mode.
  const preview = composerPreview({
    index,
    text: input,
    allCompanies,
    pickedIds: activePickedIds,
    openCompanyId,
    lastQuestion,
  });

  // Selected companies (the ones the hint names) are coloured in the input; none in All companies mode.
  const mirrorSegments = splitIntoSegments(
    input,
    findSelectedNameRanges(
      input,
      index,
      preview.kind === "companies" ? preview.companies.map((company) => company.id) : []
    )
  );

  /** A sent question, with the names of the companies it was about coloured. */
  const sentMessageSegments = (message: UserMessage): TextSegment[] =>
    splitIntoSegments(
      message.content,
      findSelectedNameRanges(
        message.content,
        index,
        message.scope.mode === "companies" ? message.scope.companyIds : []
      )
    );

  // Keep the mirror scrolled with the input when the text is wider than the box.
  const syncMirrorScroll = (): void => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  useEffect(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, [input, caret]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setInput(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    setSuggestionsHidden(false);
    setHighlight(0);
    setAmbiguity(null);
    setNotice(null);
  };

  const pickSuggestion = (company: ScopeCompany): void => {
    if (!fragment) {
      return;
    }
    const next = insertPickedName(input, fragment.start, caret, company.name);
    pendingCaretRef.current = next.caret;
    setInput(next.text);
    setCaret(next.caret);
    setPickedIds((prev) => (prev.includes(company.id) ? prev : [...prev, company.id]));
    setHighlight(0);
    setNotice(null);
    setAmbiguity(null);
    // The dropdown closes after a pick; typing opens it again.
    setSuggestionsHidden(true);
  };

  /**
   * Sends one question with its final scope and adds the reply. clearsInput: a typed
   * question empties the input; "Search all companies" leaves a draft alone.
   * usedReplyId: the reply whose "Search all companies" was used (not offered again).
   */
  const submitQuestion = async (
    text: string,
    scope: ChatScope,
    options: { clearsInput: boolean; usedReplyId?: string }
  ): Promise<void> => {
    const current = options.usedReplyId
      ? messages.map((message) =>
          message.role === "assistant" && message.id === options.usedReplyId
            ? { ...message, isSearchAllUsed: true }
            : message
        )
      : messages;
    const history = current
      .filter((message) => !(message.role === "assistant" && message.isError))
      .map(toHistoryEntry);
    // Saved with the question: its final scope and the company open right now.
    const userMessage: UserMessage = {
      id: newMessageId(),
      role: "user",
      content: text,
      scope,
      openCompanyId,
    };
    const withQuestion = [...current, userMessage];

    setMessages(withQuestion);
    if (options.clearsInput) {
      setInput("");
      setCaret(0);
      setPickedIds([]);
    }
    setAmbiguity(null);
    setNotice(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/student/data-room-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, scope, history, newMessage: text }),
      });
      const body = (await res.json().catch(() => null)) as ChatReply | null;
      if (!res.ok || !body || typeof body.intro !== "string") {
        throw new Error(typeof body?.error === "string" ? body.error : "AI request failed");
      }
      const layout = parseAnswerLayout(body.layout);
      setMessages([
        ...withQuestion,
        {
          id: newMessageId(),
          role: "assistant",
          scope,
          intro: sanitizeAiResearchReply(body.intro),
          items: parseAnswerItems(body.items),
          ...(layout ? { layout } : {}),
          ...(body.suggestAllCompanies === true ? { suggestAllCompanies: true } : {}),
        },
      ]);
    } catch (err) {
      setMessages([
        ...withQuestion,
        {
          id: newMessageId(),
          role: "assistant",
          scope,
          intro:
            err instanceof Error && err.message
              ? err.message
              : "Sorry, I couldn't respond right now. Try again in a moment.",
          items: [],
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (extraPickedIds: string[] = []): Promise<void> => {
    const text = input.trim();
    if (!text || isLoading) {
      return;
    }

    // All companies: scope all, as typed. Selected: worked out from the text (unchanged).
    const decision = composerSendDecision({
      index,
      text,
      allCompanies,
      pickedIds: [...activePickedIds, ...extraPickedIds],
      openCompanyId,
      lastQuestion,
    });
    if (decision.kind === "error") {
      setNotice(decision.message);
      return;
    }
    if (decision.kind === "ask") {
      setAmbiguity({ word: decision.word, options: decision.options });
      setHighlight(0);
      // Keep keyboard control (↑/↓, Enter, Escape) even when Send was clicked.
      inputRef.current?.focus();
      return;
    }
    await submitQuestion(text, decision.scope, { clearsInput: true });
  };

  /** The switch: the same state and side effects the old All companies pill had. */
  const handleScopeChange = (isAll: boolean): void => {
    if (isAll === allCompanies) {
      return;
    }
    setAllCompanies(isAll);
    setNotice(null);
    setAmbiguity(null);
  };

  /** "Search all companies": switch to All companies and ask the same question again, as a new message. */
  const searchAllCompanies = (replyId: string): void => {
    const request = searchAllRequest(messages, replyId);
    if (!request || isLoading) {
      return;
    }
    setAllCompanies(true);
    setNotice(null);
    setAmbiguity(null);
    void submitQuestion(request.text, request.scope, { clearsInput: false, usedReplyId: replyId });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      // Enter picks the highlighted row while the dropdown is open; otherwise it sends.
      event.preventDefault();
      const company = panel?.rows[panel.highlighted];
      if (company) {
        chooseRow(company);
      } else {
        void sendMessage();
      }
      return;
    }
    if (!panel) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((panel.highlighted + step + panel.rows.length) % panel.rows.length);
    } else if (event.key === "Escape") {
      // Close the dropdown only (the typed text stays); don't also close the slide-over.
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsHidden(true);
      setAmbiguity(null);
    }
  };

  /** A dropdown row was chosen: insert the name (suggestions) or send (ambiguity). */
  const chooseRow = (company: ScopeCompany): void => {
    if (panel?.mode === "ambiguity") {
      void sendMessage([company.id]);
    } else {
      pickSuggestion(company);
    }
  };

  return (
    <section className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-container-lowest">
      {/* Header */}
      <div className="p-4 border-b border-outline-variant shrink-0 flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-[16px] font-semibold leading-none text-on-surface">
          AI Research Assistant
        </h3>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="min-[1360px]:hidden w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0"
            aria-label="Close AI Assistant"
          >
            <MaterialIcon name="close" className="text-[18px]" />
          </button>
        ) : null}
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {messages.length === 0 ? (
          <p className="text-body-md text-on-surface-variant text-center pt-6">
            Ask about the open company, or type another company&apos;s name.
          </p>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] bg-secondary-fixed text-on-surface rounded-xl rounded-br-none p-3.5 text-[14px] leading-relaxed shadow-sm whitespace-pre-wrap">
                  {/* The bubble is already light blue, so selected names are bold blue here. */}
                  {sentMessageSegments(message).map((segment, i) =>
                    segment.isSelected ? (
                      <span key={i} className="font-semibold text-secondary">
                        {segment.text}
                      </span>
                    ) : (
                      <span key={i}>{segment.text}</span>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                {/* A table reply takes the bubble's full width so the table fits the pane. */}
                <div
                  className={`${answerLayoutOf(message) === "list" ? "max-w-[92%]" : "w-[92%] min-w-0"} bg-white border rounded-xl rounded-bl-none p-3.5 text-[14px] leading-relaxed shadow-sm space-y-3 ${
                    message.isError ? "border-error/40" : "border-outline-variant"
                  }`}
                >
                  <DataRoomChatAnswer answer={message} />
                  {!isLoading && searchAllRequest(messages, message.id) ? (
                    <SearchAllCompaniesButton onClick={() => searchAllCompanies(message.id)} />
                  ) : null}
                </div>
              </div>
            )
          )
        )}
        {isLoading ? (
          <div className="flex items-center gap-sm text-on-surface-variant">
            <div className="w-4 h-4 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
            <span className="text-label-sm">Rehearse AI is thinking...</span>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-outline-variant shrink-0 space-y-2">
        {/* Which companies the next question is about: the switch, then a plain hint line. */}
        <ScopeSwitch isAll={allCompanies} onChange={handleScopeChange} />
        <ScopeHint isAll={allCompanies} preview={preview} total={companies.length} />

        {notice ? <p className="text-[12px] text-error">{notice}</p> : null}

        <div ref={comboRef} className="relative">
          {/* Dropdown above the input, same width; stays mounted so closing can animate. */}
          <div
            // Clicks inside keep focus in the input so typing can continue.
            onMouseDown={(event) => event.preventDefault()}
            className={`absolute bottom-full left-0 right-0 mb-1.5 z-20 py-1 bg-white border border-outline-variant rounded-lg shadow-lg origin-bottom motion-reduce:transition-none ${
              isPanelOpen ? PANEL_OPEN : PANEL_CLOSED
            }`}
          >
            {shownPanel?.mode === "ambiguity" ? (
              <p
                id={`${listboxId}-heading`}
                className="px-3 pt-1 pb-1.5 text-[12px] font-medium text-on-surface"
              >
                Which one did you mean?
              </p>
            ) : null}
            <div
              id={listboxId}
              role="listbox"
              aria-label={shownPanel?.mode === "ambiguity" ? undefined : "Suggested companies"}
              aria-labelledby={shownPanel?.mode === "ambiguity" ? `${listboxId}-heading` : undefined}
              className="max-h-[min(20rem,45vh)] overflow-y-auto custom-scrollbar"
            >
              {(shownPanel?.rows ?? []).map((company, i) => {
                const isHighlighted = i === shownPanel?.highlighted;
                const detail = detailById.get(company.id) ?? company.industry;
                return (
                  <button
                    key={company.id}
                    id={optionId(company.id)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={isHighlighted}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseRow(company)}
                    className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors ${
                      isHighlighted ? "bg-secondary-fixed" : "hover:bg-surface-container-low"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight font-medium text-on-surface">
                        {company.name}
                      </span>
                      {detail ? (
                        <span className="block truncate text-[12px] leading-tight text-on-surface-variant">
                          {detail}
                        </span>
                      ) : null}
                    </span>
                    {isHighlighted ? (
                      <span className="shrink-0 px-1 rounded border border-secondary/30 text-[10px] leading-4 text-secondary">
                        Enter
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="group relative flex items-center">
            {/* Mirror behind the transparent input text: same font, padding and border. */}
            <div
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-lg border border-transparent pl-3.5 pr-10 text-[13px] text-on-surface bg-surface-container-low group-focus-within:bg-white transition-colors"
            >
              <span className="whitespace-pre">
                {mirrorSegments.map((segment, i) =>
                  segment.isSelected ? (
                    <span key={i} className="rounded-sm bg-secondary-fixed text-secondary">
                      {segment.text}
                    </span>
                  ) : (
                    <span key={i}>{segment.text}</span>
                  )
                )}
              </span>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              onSelect={(event) =>
                setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
              }
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // The dropdown closes when the input loses focus.
                setSuggestionsHidden(true);
                setAmbiguity(null);
              }}
              placeholder={chatPlaceholder(allCompanies)}
              maxLength={DATA_ROOM_CHAT_MAX_CHARS}
              aria-label="Ask the AI Research Assistant"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isPanelOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId ?? undefined}
              onScroll={syncMirrorScroll}
              // Text is transparent (the mirror shows it); the caret and placeholder stay visible.
              className="relative w-full h-10 pl-3.5 pr-10 text-[13px] bg-transparent border border-outline-variant rounded-lg text-transparent caret-on-surface selection:bg-secondary/20 placeholder:text-on-surface-variant/70 focus:outline-none focus:border-secondary transition-all"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={isLoading || !input.trim()}
              className="absolute right-1.5 w-7 h-7 rounded-md bg-primary-container text-white flex items-center justify-center hover:bg-primary transition-colors disabled:opacity-40"
              aria-label="Send message"
            >
              <MaterialIcon name="arrow_upward" className="text-[16px]" />
            </button>
          </div>
          {input.length > DATA_ROOM_CHAT_COUNTER_FROM ? (
            <p className="mt-1 text-right text-[11px] text-on-surface-variant" aria-live="polite">
              {input.length} / {DATA_ROOM_CHAT_MAX_CHARS}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
