/**
 * ProspectingScopedChat.tsx
 * Per-company research chat for Prospecting — known facts + grounded AI chat.
 * No Export/Start Sim, no mic — text research only.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { ProspectDirectoryCompany } from "@/lib/tempo-prospect-directory";
import { sanitizeAiResearchReply } from "@/lib/tempo-prospecting";
import type { ChatMessage } from "@/types";

type ProspectingScopedChatProps = {
  company: ProspectDirectoryCompany;
  messages: ChatMessage[];
  chatInput: string;
  isAILoading: boolean;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void;
};

type FactTab = "industry" | "scale" | "contact" | "signal";

/**
 * Header, Known Facts card, and chat transcript for one directory company.
 */
export function ProspectingScopedChat({
  company,
  messages,
  chatInput,
  isAILoading,
  onChatInputChange,
  onSendMessage,
}: ProspectingScopedChatProps): React.ReactElement {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [activeFactTab, setActiveFactTab] = useState<FactTab>("industry");

  const factTabs: Array<{
    id: FactTab;
    label: string;
    icon?: string;
    value: string;
    description: string;
  }> = [
    {
      id: "industry",
      label: "Industry",
      value: company.industry,
      description: `Primary sector for ${company.name}`,
    },
    {
      id: "scale",
      label: "Scale",
      value: company.sizeLabel,
      description: "Current operating footprint",
    },
    {
      id: "contact",
      label: "Contacts",
      value:
        company.contacts.length > 0
          ? company.contacts
              .map((contact) => `${contact.name}, ${contact.title}`)
              .join("\n")
          : "No contacts listed.",
      description: "Known people at this company. Decide who's worth reaching",
    },
    {
      id: "signal",
      label: "Trigger Signal",
      icon: "rss_feed",
      value: company.signalHint,
      description: "Most relevant recent account signal",
    },
  ];
  const activeFact = factTabs.find((tab) => tab.id === activeFactTab) ?? factTabs[0];

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, isAILoading, company.id]);

  return (
    <section className="flex-1 flex flex-col bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden min-h-0">
      <div className="p-lg border-b border-outline-variant bg-surface-container-low shrink-0">
        <h2 className="font-headline-lg text-headline-lg text-primary">{company.name} Research</h2>
        <p className="text-body-md text-on-surface-variant">
          {company.industry} · {company.sizeLabel}
        </p>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-lg space-y-lg custom-scrollbar">
          <div className="bg-surface-container-low border border-outline-variant rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2 text-secondary">
              <MaterialIcon name="fact_check" className="text-[20px]" />
              <span className="text-label-md font-bold uppercase tracking-wider">Known Facts</span>
            </div>
            <div className="flex flex-col gap-3">
              <div
                className="flex gap-4 border-b border-outline-variant overflow-x-auto"
                role="tablist"
                aria-label="Known company facts"
              >
                {factTabs.map((tab) => {
                  const isActive = activeFactTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveFactTab(tab.id)}
                      className={`flex items-center gap-1 shrink-0 pb-2 text-label-sm transition-colors border-b-2 ${
                        isActive
                          ? "font-bold text-primary border-primary"
                          : "font-medium text-on-surface-variant border-transparent hover:text-primary"
                      }`}
                    >
                      {tab.icon ? (
                        <MaterialIcon name={tab.icon} className="text-[16px]" />
                      ) : null}
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <div className="min-h-[40px] flex items-center" role="tabpanel">
                <div className="flex flex-col min-w-0">
                  <span className="text-body-md font-medium text-on-surface break-words whitespace-pre-line">
                    {activeFact.value}
                  </span>
                  <span className="text-label-sm text-on-surface-variant">
                    {activeFact.description}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-lg">
            {messages.length === 0 ? (
              <p className="text-body-md text-on-surface-variant text-center py-md">
                Ask a research question about {company.name} to dig deeper.
              </p>
            ) : null}
            {messages.map((msg, i) => (
              <div key={`${company.id}-${msg.role}-${i}`}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="bg-primary-container text-on-primary p-md rounded-2xl rounded-tr-none max-w-[80%] shadow-sm">
                      <p className="text-body-md whitespace-pre-wrap">{msg.content}</p>
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
                        {sanitizeAiResearchReply(msg.content)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isAILoading ? (
              <div className="flex items-center gap-sm text-on-surface-variant">
                <div className="w-4 h-4 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
                <span className="text-label-sm">Rehearse AI is thinking...</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-lg bg-white border-t border-outline-variant shrink-0">
          <div className="relative flex items-center">
            <textarea
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-xl py-3 pl-4 pr-14 text-body-md focus:ring-2 focus:ring-secondary focus:border-transparent outline-none resize-none shadow-sm"
              placeholder="Type a message"
              rows={1}
              value={chatInput}
              onChange={(e) => onChatInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMessage();
                }
              }}
            />
            <div className="absolute right-3 flex items-center">
              <button
                type="button"
                onClick={onSendMessage}
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
