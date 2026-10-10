/**
 * CallTranscriptPanel.tsx
 * Docked, display-only call transcript for Discovery and Objection Handling.
 * Dark call-area chrome (opaque) so light text stays readable on both stages.
 * Renders beside the call area; never edits or captures transcript data.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type CallTranscriptPanelEntry = {
  speaker: "persona" | "student";
  name: string;
  timestamp: string;
  content: string;
};

type CallTranscriptPanelProps = {
  entries: CallTranscriptPanelEntry[];
  variant: "live" | "ended";
  durationLabel?: string;
  footer?: React.ReactNode;
};

/** Narrower than the original 360px rail so the call stage stays dominant. */
const PANEL_WIDTH_CLASS = "w-[280px]";

/**
 * Collapsible transcript dock. Open by default at >=1280px; hidden below 1024px.
 * Live and ended share the same dark Stitch panel language.
 */
export function CallTranscriptPanel({
  entries,
  variant,
  durationLabel,
  footer,
}: CallTranscriptPanelProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const [hasUserToggled, setHasUserToggled] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (hasUserToggled || typeof window === "undefined") {
      return;
    }
    const syncDefault = (): void => {
      setExpanded(window.matchMedia("(min-width: 1280px)").matches);
    };
    syncDefault();
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = (): void => {
      if (!hasUserToggled) {
        setExpanded(mq.matches);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [hasUserToggled]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  };

  const handleToggle = (): void => {
    setHasUserToggled(true);
    setExpanded((prev) => !prev);
  };

  const handleCopy = async (): Promise<void> => {
    const text = entries
      .map((entry) => `${entry.name} [${entry.timestamp}]: ${entry.content}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — fail silently.
    }
  };

  const isLive = variant === "live";

  if (!expanded) {
    return (
      <aside className="hidden lg:flex w-12 h-full shrink-0 flex-col items-center pt-3 gap-4 border-l border-white/10 bg-[#0a0a0a]">
        <button
          type="button"
          onClick={handleToggle}
          aria-label="Expand transcript"
          className="p-1 rounded transition-colors text-white/60 hover:text-white"
        >
          <MaterialIcon name="right_panel_open" className="text-[18px]" />
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] rotate-90 origin-center whitespace-nowrap mt-8 text-white/50">
          Transcript
        </span>
      </aside>
    );
  }

  return (
    <aside
      className={`hidden lg:flex ${PANEL_WIDTH_CLASS} h-full shrink-0 flex-col bg-[#0a0a0a] border-l border-white/10`}
    >
      <div className="h-12 px-4 border-b border-white/10 shrink-0 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <MaterialIcon name="subtitles" className="text-[18px] text-white/70" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
            Transcript
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isLive ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[11px] font-bold text-red-500 tracking-wider">LIVE</span>
            </div>
          ) : (
            <>
              <span className="text-[11px] text-white/50">
                Call ended{durationLabel ? ` · ${durationLabel}` : ""}
              </span>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-white/15 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
              >
                <MaterialIcon name="content_copy" className="text-[14px]" />
                {copied ? "Copied" : "Copy"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleToggle}
            aria-label="Collapse transcript"
            className="p-1 transition-colors text-white/60 hover:text-white"
          >
            <MaterialIcon name="right_panel_close" className="text-[18px]" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5 call-transcript-scroll"
      >
        {entries.length === 0 ? (
          <p className="m-auto text-center text-xs text-white/40">
            The transcript will appear here once the call starts.
          </p>
        ) : (
          entries.map((entry, index) => {
            const isStudent = entry.speaker === "student";
            return (
              <div
                key={`${entry.speaker}-${entry.timestamp}-${index}`}
                className={`flex flex-col gap-1 ${isStudent ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-2 px-1">
                  {isStudent ? (
                    <>
                      <span className="font-code-md text-[10px] text-white/40">
                        {entry.timestamp}
                      </span>
                      <span className="text-xs font-semibold text-[#5694fe]">You</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-semibold text-white/90">{entry.name}</span>
                      <span className="font-code-md text-[10px] text-white/40">
                        {entry.timestamp}
                      </span>
                    </>
                  )}
                </div>
                <div
                  className={`p-3 text-xs leading-relaxed max-w-[92%] text-white/85 ${
                    isStudent
                      ? "bg-[#5694fe]/15 border border-[#5694fe]/30 rounded-2xl rounded-tr-none text-left"
                      : "bg-white/[0.06] border border-white/10 rounded-2xl rounded-tl-none"
                  }`}
                >
                  {entry.content}
                </div>
              </div>
            );
          })
        )}
      </div>

      {footer ? <div className="shrink-0">{footer}</div> : null}
    </aside>
  );
}
