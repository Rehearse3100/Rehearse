/**
 * ProspectingDataRoomChat.tsx
 * Data Room AI Research Assistant: one transcript for the whole Data Room.
 * Each question is about a scope worked out live (lib/data-room-chat-scope.ts):
 * All companies, companies picked from suggestions or named in the text, or the
 * open company. Type-to-pick: after 3 letters, matching companies appear in a
 * dropdown above the input (Tab picks, Enter always sends); "Which one did you
 * mean?" uses the same dropdown. The server receives company ids only and returns
 * per-company blocks; names shown come from the server reply.
 */

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import {
  buildScopeIndex,
  insertPickedName,
  previewScope,
  resolveSendScope,
  suggestCompanies,
  textContainsCompanyName,
  wordFragmentBeforeCaret,
  type ChatScope,
  type ScopeCompany,
  type ScopeIndex,
} from "@/lib/data-room-chat-scope";
import { sanitizeAiResearchReply } from "@/lib/tempo-prospecting";

const STORAGE_PREFIX = "tempo-data-room-chat-v2-";

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

type AnswerItem = {
  companyId: string;
  companyName: string;
  text: string;
};

type UserMessage = {
  id: string;
  role: "user";
  content: string;
  scope: ChatScope;
};

type AssistantMessage = {
  id: string;
  role: "assistant";
  scope: ChatScope;
  intro: string;
  items: AnswerItem[];
  /** Request failures are shown but never sent back as history. */
  isError?: boolean;
};

type TranscriptMessage = UserMessage | AssistantMessage;

type ChatReply = {
  intro?: unknown;
  items?: unknown;
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

/** Short unique id for transcript keys. */
function newMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Loose check for a transcript restored from sessionStorage. */
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

function loadTranscript(attemptId: string): TranscriptMessage[] {
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${attemptId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return isTranscript(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTranscript(attemptId: string, messages: TranscriptMessage[]): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${attemptId}`, JSON.stringify(messages));
  } catch {
    /* storage unavailable: the transcript still lives in memory */
  }
}

/** Server reply → answer items (names are the server's, never typed by the model). */
function parseAnswerItems(value: unknown): AnswerItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): AnswerItem[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const { companyId, companyName, text } = item as Record<string, unknown>;
    if (typeof companyId !== "string" || typeof companyName !== "string" || typeof text !== "string") {
      return [];
    }
    return [{ companyId, companyName, text: sanitizeAiResearchReply(text) }];
  });
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

type ProspectingDataRoomChatProps = {
  attemptId: string;
  companies: DataRoomCompany[];
  /** Company open on the company page (default scope). */
  openCompanyId: string | null;
  /** Shown as a close button on narrow screens (slide-over). */
  onClose?: () => void;
};

/**
 * AI Research Assistant pane: scope chip, transcript, All companies toggle, and
 * the input with its suggestions / "Which one did you mean?" dropdown.
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

  // Restore after mount (sessionStorage is browser-only), then mirror every change.
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

  const fragment = wordFragmentBeforeCaret(input, caret);
  const suggestions =
    suggestionsHidden || !fragment ? [] : suggestCompanies(index, fragment.fragment);

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

  const preview = previewScope({
    index,
    text: input,
    allCompanies,
    pickedIds: activePickedIds,
    openCompanyId,
  });
  const scopeChipLabel =
    preview.kind === "all"
      ? "About: All companies"
      : preview.kind === "companies"
        ? `About: ${preview.companies.map((company) => company.name).join(", ")}`
        : "Open a company or type a company's name";

  // Selected companies (the same ones the "About:" chip shows) are coloured in the input.
  const selectedNameRanges = findSelectedNameRanges(
    input,
    index,
    preview.kind === "companies" ? preview.companies.map((company) => company.id) : []
  );
  const mirrorSegments: Array<{ text: string; isSelected: boolean }> = [];
  let segmentStart = 0;
  for (const range of selectedNameRanges) {
    if (range.start > segmentStart) {
      mirrorSegments.push({ text: input.slice(segmentStart, range.start), isSelected: false });
    }
    mirrorSegments.push({ text: input.slice(range.start, range.end), isSelected: true });
    segmentStart = range.end;
  }
  if (segmentStart < input.length) {
    mirrorSegments.push({ text: input.slice(segmentStart), isSelected: false });
  }

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

  const sendMessage = async (extraPickedIds: string[] = []): Promise<void> => {
    const text = input.trim();
    if (!text || isLoading) {
      return;
    }

    const decision = resolveSendScope({
      index,
      text,
      allCompanies,
      pickedIds: [...activePickedIds, ...extraPickedIds],
      openCompanyId,
    });
    if (decision.kind === "error") {
      setNotice(decision.message);
      return;
    }
    if (decision.kind === "ask") {
      setAmbiguity({ word: decision.word, options: decision.options });
      setHighlight(0);
      // Keep keyboard control (↑/↓, Tab, Escape) even when Send was clicked.
      inputRef.current?.focus();
      return;
    }

    const scope = decision.scope;
    const history = messages
      .filter((message) => !(message.role === "assistant" && message.isError))
      .map(toHistoryEntry);
    const userMessage: UserMessage = { id: newMessageId(), role: "user", content: text, scope };
    const withQuestion = [...messages, userMessage];

    setMessages(withQuestion);
    setInput("");
    setCaret(0);
    setPickedIds([]);
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
      setMessages([
        ...withQuestion,
        {
          id: newMessageId(),
          role: "assistant",
          scope,
          intro: sanitizeAiResearchReply(body.intro),
          items: parseAnswerItems(body.items),
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      // Enter always sends; it never picks a suggestion.
      event.preventDefault();
      void sendMessage();
      return;
    }
    if (!panel) {
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const company = panel.rows[panel.highlighted];
      if (company) {
        chooseRow(company);
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
      <div className="p-4 border-b border-outline-variant shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-none text-on-surface">
            AI Research Assistant
          </h3>
          <p
            className={`mt-2 inline-flex max-w-full px-2 py-0.5 rounded-full text-[12px] font-medium ${
              preview.kind === "none"
                ? "bg-surface-container text-on-surface-variant"
                : "bg-secondary-fixed text-secondary"
            }`}
          >
            <span className="truncate">{scopeChipLabel}</span>
          </p>
        </div>
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
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start">
                <div
                  className={`max-w-[92%] bg-white border rounded-xl rounded-bl-none p-3.5 text-[14px] leading-relaxed shadow-sm space-y-3 ${
                    message.isError ? "border-error/40" : "border-outline-variant"
                  }`}
                >
                  {message.intro ? (
                    <p
                      className={`whitespace-pre-wrap ${
                        message.isError ? "text-error" : "text-on-surface-variant"
                      }`}
                    >
                      {message.intro}
                    </p>
                  ) : null}
                  {message.items.map((item) => (
                    <div key={item.companyId}>
                      <p className="text-[12px] font-semibold text-on-surface mb-1">
                        {item.companyName}
                      </p>
                      <p className="text-on-surface-variant whitespace-pre-wrap">{item.text}</p>
                    </div>
                  ))}
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
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => {
              setAllCompanies((on) => !on);
              setNotice(null);
              setAmbiguity(null);
            }}
            aria-pressed={allCompanies}
            className={`h-6 px-2 rounded-full text-[11px] font-medium flex items-center gap-1 transition-colors ${
              allCompanies
                ? "bg-secondary text-white"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                allCompanies ? "bg-white" : "bg-on-surface-variant/60"
              }`}
            />
            All companies
          </button>
        </div>

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
                        Tab
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
              placeholder="Type a message"
              aria-label="Ask the AI Research Assistant"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isPanelOpen}
              aria-controls={listboxId}
              aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
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
        </div>
      </div>
    </section>
  );
}
