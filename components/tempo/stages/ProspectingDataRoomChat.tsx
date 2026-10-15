/**
 * ProspectingDataRoomChat.tsx
 * Data Room AI Research Assistant: one transcript for the whole Data Room.
 * Each question is about a scope worked out live (lib/data-room-chat-scope.ts):
 * All companies, companies picked from suggestions or named in the text, or the
 * open company. Type-to-pick: after 3 letters, matching companies appear above
 * the input (Tab picks, Enter always sends). The server receives company ids only
 * and returns per-company blocks; names shown come from the server reply.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/data-room-chat-scope";
import { sanitizeAiResearchReply } from "@/lib/tempo-prospecting";

const STORAGE_PREFIX = "tempo-data-room-chat-v2-";

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
 * AI Research Assistant pane: scope chip, transcript, All companies toggle,
 * type-to-pick suggestions, and the input.
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
  const highlighted = Math.min(highlight, Math.max(0, suggestions.length - 1));

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
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const company = suggestions[highlighted];
      if (company) {
        pickSuggestion(company);
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((highlighted + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Escape") {
      // Hide suggestions only; don't also close the slide-over.
      event.preventDefault();
      event.stopPropagation();
      setSuggestionsHidden(true);
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

        {ambiguity ? (
          <div className="space-y-1.5" role="group" aria-label="Which one did you mean?">
            <p className="text-[12px] font-medium text-on-surface">Which one did you mean?</p>
            <div className="flex flex-wrap gap-1.5">
              {ambiguity.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void sendMessage([option.id])}
                  className="h-7 px-2.5 rounded-full border border-outline-variant bg-white text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors"
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Suggested companies">
            {suggestions.map((company, i) => (
              <button
                key={company.id}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                // Keep focus in the input so typing can continue.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickSuggestion(company)}
                className={`h-7 px-2.5 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
                  i === highlighted
                    ? "bg-secondary-fixed text-secondary"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {company.name}
                {i === highlighted ? (
                  <span className="px-1 rounded border border-secondary/30 text-[10px] leading-4">
                    Tab
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {notice ? <p className="text-[12px] text-error">{notice}</p> : null}

        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onSelect={(event) =>
              setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
            }
            onKeyDown={handleKeyDown}
            placeholder="Ask about this company, or type another company's name…"
            aria-label="Ask the AI Research Assistant"
            className="w-full h-10 pl-3.5 pr-10 text-[13px] bg-surface-container-low border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:border-secondary focus:bg-white transition-all"
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
    </section>
  );
}
