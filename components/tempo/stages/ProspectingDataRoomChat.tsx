/**
 * ProspectingDataRoomChat.tsx
 * Data Room AI Assistant — attach roster company documents and chat
 * grounded only in those attachments (IDs sent to server, not raw text).
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { DataRoomCompany } from "@/app/api/student/data-room/route";
import { sanitizeAiResearchReply } from "@/lib/tempo-prospecting";
import type { ChatMessage } from "@/types";

type AttachmentNotice = {
  kind: "attachment";
  action: "attached" | "removed";
  companyName: string;
};

type ChatTimelineItem = ChatMessage | AttachmentNotice;

function isChatMessage(item: ChatTimelineItem): item is ChatMessage {
  return "role" in item;
}

function toApiMessages(timeline: ChatTimelineItem[]): ChatMessage[] {
  return timeline.map((item) => {
    if (isChatMessage(item)) {
      return item;
    }
    return {
      role: "user",
      content:
        item.action === "attached"
          ? `Attached ${item.companyName}.`
          : `Removed ${item.companyName}.`,
    };
  });
}

type ProspectingDataRoomChatProps = {
  attemptId: string;
  companies: DataRoomCompany[];
};

/**
 * Attach-documents picker + chat transcript for the Data Room AI Assistant tab.
 */
export function ProspectingDataRoomChat({
  attemptId,
  companies,
}: ProspectingDataRoomChatProps): React.ReactElement {
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<ChatTimelineItem[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const sortedCompanies = useMemo(() => {
    return [...companies].sort((a, b) => a.name.localeCompare(b.name));
  }, [companies]);

  const companyById = useMemo(() => {
    return new Map(companies.map((company) => [company.id, company]));
  }, [companies]);

  const filteredPickerCompanies = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    const base =
      query.length === 0
        ? sortedCompanies
        : sortedCompanies.filter(
            (company) =>
              company.name.toLowerCase().includes(query) ||
              company.industry.toLowerCase().includes(query)
          );

    const attachedSet = new Set(attachedIds);
    return [...base].sort((a, b) => {
      const aAttached = attachedSet.has(a.id);
      const bAttached = attachedSet.has(b.id);
      if (aAttached !== bAttached) {
        return aAttached ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [attachedIds, pickerSearch, sortedCompanies]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [timeline, isAILoading]);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isPickerOpen]);

  const applyAttachedIds = (updater: (previousIds: string[]) => string[]): void => {
    setAttachedIds((previousIds) => {
      const nextIds = updater(previousIds);
      const previousSet = new Set(previousIds);
      const nextSet = new Set(nextIds);
      const added = nextIds.filter((id) => !previousSet.has(id));
      const removed = previousIds.filter((id) => !nextSet.has(id));

      if (added.length > 0 || removed.length > 0) {
        setTimeline((current) => {
          if (!current.some(isChatMessage)) {
            return current;
          }

          const notices: AttachmentNotice[] = [
            ...added.map((id) => ({
              kind: "attachment" as const,
              action: "attached" as const,
              companyName: companyById.get(id)?.name ?? "Company",
            })),
            ...removed.map((id) => ({
              kind: "attachment" as const,
              action: "removed" as const,
              companyName: companyById.get(id)?.name ?? "Company",
            })),
          ];
          return [...current, ...notices];
        });
      }

      return nextIds;
    });
    setSendError(null);
  };

  const selectAllCompanies = (): void => {
    applyAttachedIds(() => companies.map((company) => company.id));
  };

  const clearAllCompanies = (): void => {
    applyAttachedIds(() => []);
  };

  const toggleAttached = (companyId: string): void => {
    const isAttaching = !attachedIds.includes(companyId);
    applyAttachedIds((previousIds) =>
      previousIds.includes(companyId)
        ? previousIds.filter((id) => id !== companyId)
        : [...previousIds, companyId]
    );
    if (isAttaching) {
      setPickerSearch("");
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    const trimmed = chatInput.trim();
    if (!trimmed || isAILoading) {
      return;
    }
    if (attachedIds.length === 0) {
      setSendError("Attach one or more company documents above to start asking questions.");
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    const prior = toApiMessages(timeline);
    const companyIdsForRequest = [...attachedIds];
    const nextTimeline: ChatTimelineItem[] = [...timeline, userMessage];
    setChatInput("");
    setSendError(null);
    setTimeline(nextTimeline);
    setIsAILoading(true);

    try {
      const res = await fetch("/api/student/data-room-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptId,
          companyIds: companyIdsForRequest,
          messages: prior,
          newMessage: trimmed,
        }),
      });

      const body = (await res.json().catch(() => null)) as {
        reply?: string;
        error?: string;
      } | null;

      if (!res.ok || !body?.reply) {
        throw new Error(body?.error ?? "AI request failed");
      }

      setTimeline([
        ...nextTimeline,
        { role: "assistant", content: sanitizeAiResearchReply(body.reply) },
      ]);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Sorry, I couldn't respond right now. Try again in a moment.";
      setTimeline([
        ...nextTimeline,
        {
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      setIsAILoading(false);
    }
  };

  const handleRefreshChat = (): void => {
    setTimeline([]);
    setChatInput("");
    setSendError(null);
  };

  const canRefreshChat = timeline.length > 0 && !isAILoading;

  return (
    <section className="flex-1 flex flex-col bg-white min-h-0 overflow-hidden">
      <div className="p-4 border-b border-outline-variant bg-surface-container-low shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-headline-md text-headline-md text-primary">AI Assistant</h3>
            <p className="text-body-md text-on-surface-variant">
              Attach company documents, then ask questions grounded only in what you attached.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefreshChat}
            disabled={!canRefreshChat}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-outline-variant bg-white text-label-sm font-bold text-on-surface hover:bg-surface-container transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Refresh chat"
          >
            <MaterialIcon name="refresh" className="text-[18px]" />
            Refresh chat
          </button>
        </div>

        <div ref={pickerRef} className="relative">
          <p className="text-label-sm font-bold text-on-surface mb-2">Attach Documents</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsPickerOpen((open) => {
                  if (open) {
                    setPickerSearch("");
                  }
                  return !open;
                });
              }}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-outline-variant bg-white text-label-sm font-bold text-on-surface hover:bg-surface-container transition-colors min-w-[220px] justify-between"
              aria-expanded={isPickerOpen}
              aria-haspopup="listbox"
            >
              <span className="truncate">
                {attachedIds.length === 0
                  ? "Select companies…"
                  : `${attachedIds.length} of ${companies.length} selected`}
              </span>
              <MaterialIcon
                name={isPickerOpen ? "expand_less" : "expand_more"}
                className="text-[18px] shrink-0"
              />
            </button>
          </div>

          {isPickerOpen ? (
            <div
              className="absolute z-20 mt-1 w-full max-w-md rounded-lg border border-outline-variant bg-white shadow-lg overflow-hidden"
              role="listbox"
              aria-multiselectable="true"
            >
              <div className="p-2 border-b border-outline-variant bg-surface-container-lowest flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <MaterialIcon
                    name="search"
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]"
                  />
                  <input
                    type="text"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search companies…"
                    className="w-full h-8 pl-8 pr-3 rounded-md border border-outline-variant bg-white text-sm outline-none focus:ring-2 focus:ring-secondary/50"
                  />
                </div>
                <button
                  type="button"
                  onClick={selectAllCompanies}
                  disabled={companies.length === 0}
                  className="h-8 px-2.5 rounded-md border border-outline-variant bg-white text-label-sm font-bold text-primary hover:bg-surface-container transition-colors shrink-0 disabled:opacity-40"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearAllCompanies}
                  disabled={attachedIds.length === 0}
                  className="h-8 px-2.5 rounded-md border border-outline-variant bg-white text-label-sm font-bold text-on-surface-variant hover:bg-surface-container transition-colors shrink-0 disabled:opacity-40"
                >
                  Clear all
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto custom-scrollbar">
                {filteredPickerCompanies.length === 0 ? (
                  <p className="px-3 py-4 text-label-sm text-on-surface-variant text-center">
                    No matches.
                  </p>
                ) : (
                  filteredPickerCompanies.map((company) => {
                    const isAttached = attachedIds.includes(company.id);
                    return (
                      <label
                        key={company.id}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container cursor-pointer border-b border-outline-variant/40 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={isAttached}
                          onChange={() => toggleAttached(company.id)}
                          className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-secondary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label-sm font-bold text-on-surface truncate">
                            {company.name}
                          </span>
                          <span className="block text-[11px] text-on-surface-variant truncate">
                            {company.industry} · {company.sizeLabel}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 flex flex-col"
        >
          {timeline.length === 0 && attachedIds.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center px-6 p-lg min-h-[200px]">
              <p className="text-body-md text-on-surface-variant max-w-md">
                Attach one or more company documents above to start asking questions.
              </p>
            </div>
          ) : timeline.length === 0 && attachedIds.length > 0 ? (
            <div className="flex-1 flex items-center justify-center text-center px-6 p-lg min-h-[200px]">
              <p className="text-body-md text-on-surface-variant max-w-md">
                Ask a question about the attached documents. The assistant will not rank or pick a
                target for you.
              </p>
            </div>
          ) : (
            <div className="p-lg space-y-lg">
              {timeline.map((item, i) => {
                if (!isChatMessage(item)) {
                  return (
                    <div
                      key={`data-room-attachment-${item.action}-${item.companyName}-${i}`}
                      className="flex items-center gap-3 py-1"
                    >
                      <div className="flex-1 h-px bg-outline-variant" />
                      <p className="text-label-sm text-on-surface-variant shrink-0">
                        {item.action === "attached" ? "Attached" : "Removed"} {item.companyName}
                      </p>
                      <div className="flex-1 h-px bg-outline-variant" />
                    </div>
                  );
                }

                return (
                  <div key={`data-room-chat-${item.role}-${i}`}>
                    {item.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="bg-primary-container text-on-primary p-md rounded-2xl rounded-tr-none max-w-[80%] shadow-sm">
                          <p className="text-body-md whitespace-pre-wrap">{item.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start gap-md">
                        <div className="w-8 h-8 rounded-full bg-secondary-fixed/40 flex items-center justify-center shrink-0">
                          <MaterialIcon name="smart_toy" className="text-secondary text-[20px]" />
                        </div>
                        <div className="bg-surface-container p-md rounded-2xl rounded-tl-none max-w-[85%] border border-outline-variant">
                          <p className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1">
                            Rehearse AI
                          </p>
                          <p className="text-body-md leading-relaxed whitespace-pre-wrap">
                            {item.content}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {isAILoading ? (
                <div className="flex items-center gap-sm text-on-surface-variant">
                  <div className="w-4 h-4 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
                  <span className="text-label-sm">Rehearse AI is thinking...</span>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="p-lg bg-white border-t border-outline-variant shrink-0">
          {sendError ? <p className="text-sm text-error mb-2">{sendError}</p> : null}
          <div className="relative flex items-center">
            <textarea
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-xl py-3 pl-4 pr-14 text-body-md focus:ring-2 focus:ring-secondary focus:border-transparent outline-none resize-none shadow-sm"
              placeholder={
                attachedIds.length === 0
                  ? "Attach documents to enable chat..."
                  : "Type a message"
              }
              rows={1}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
            />
            <div className="absolute right-3 flex items-center">
              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={isAILoading || !chatInput.trim()}
                className="bg-primary-container text-on-primary p-1.5 rounded-lg active:scale-95 transition-transform disabled:opacity-40"
                aria-label="Send message"
              >
                <MaterialIcon name="send" className="text-[20px]" />
              </button>
            </div>
          </div>
          <div className="mt-sm flex justify-center">
            <p className="text-label-sm text-on-surface-variant">
              Rehearse AI can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
