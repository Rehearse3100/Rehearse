/**
 * CallTranscriptPanel.tsx
 * Docked, display-only call transcript for Discovery and Objection Handling.
 * Live: dark call-area chrome (opaque) so light text stays readable on both stages.
 * Ended: light chrome that matches the light post-call page, wider, two-row header.
 * Docked beside the call area at lg and up (collapsible). Below lg the docked panel
 * is hidden and the layouts use the narrow placements instead: "stacked" (ended, a
 * full-width section under the post-call content) and "slide-over" (live, opened
 * from CallTranscriptSlideOver's Transcript button). Never edits or captures
 * transcript data.
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

/**
 * docked: beside the call or post-call content, lg and up only, collapsible.
 * stacked: ended only, below lg, full width with its own max-height scroll.
 * slide-over: live only, fills its slide-over container, with a close button.
 */
type CallTranscriptPlacement = "docked" | "stacked" | "slide-over";

type CallTranscriptPanelProps = {
  entries: CallTranscriptPanelEntry[];
  variant: "live" | "ended";
  durationLabel?: string;
  footer?: React.ReactNode;
  placement?: CallTranscriptPlacement;
  /** Closes the slide-over (placement "slide-over" only). */
  onClose?: () => void;
};

/** Narrower than the original 360px rail so the call stage stays dominant. */
const PANEL_WIDTH_CLASS = "w-[280px]";

/** Post-call width: there is no video to protect, so the transcript gets more room. */
const ENDED_PANEL_WIDTH_CLASS = "w-[360px]";

/** Light version of the thin .call-transcript-scroll scrollbar (4px, rounded thumb). */
const ENDED_SCROLL_CLASS =
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-outline-variant [&::-webkit-scrollbar-thumb]:rounded";

/** Stacked (below lg): full width under the post-call content, scrolling inside its own max height. */
const STACKED_CLASS =
  "flex lg:hidden w-full max-h-[60vh] shrink-0 flex-col bg-surface-container-lowest border-t border-outline-variant";

/** Slide-over: fills the slide-over container. */
const SLIDE_OVER_CLASS = "flex w-full h-full flex-col bg-[#0a0a0a] border-l border-white/10";

/**
 * Transcript panel. Docked (default): collapsible, open by default at >=1280px,
 * hidden below 1024px. Live is the dark panel beside the call; ended is the light
 * post-call panel. Stacked and slide-over are the always-open narrow placements.
 */
export function CallTranscriptPanel({
  entries,
  variant,
  durationLabel,
  footer,
  placement = "docked",
  onClose,
}: CallTranscriptPanelProps): React.ReactElement {
  const isDocked = placement === "docked";
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

  // ── Ended variant (light, post-call page) ───
  if (!isLive) {
    if (!expanded && isDocked) {
      return (
        <aside className="hidden lg:flex w-12 h-full shrink-0 flex-col items-center pt-3 gap-4 border-l border-outline-variant bg-surface-container-lowest">
          <button
            type="button"
            onClick={handleToggle}
            aria-label="Expand transcript"
            className="p-1 rounded transition-colors text-on-surface-variant hover:text-on-surface"
          >
            <MaterialIcon name="right_panel_open" className="text-[18px]" />
          </button>
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] rotate-90 origin-center whitespace-nowrap mt-8 text-on-surface-variant">
            Transcript
          </span>
        </aside>
      );
    }

    return (
      <aside
        className={
          isDocked
            ? `hidden lg:flex ${ENDED_PANEL_WIDTH_CLASS} h-full shrink-0 flex-col bg-surface-container-lowest border-l border-outline-variant`
            : STACKED_CLASS
        }
      >
        <div className="px-4 pb-3 border-b border-outline-variant shrink-0 flex flex-col">
          <div className="h-12 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MaterialIcon name="subtitles" className="text-[18px] text-on-surface-variant" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant">
                Transcript
              </span>
            </div>
            {isDocked ? (
              <button
                type="button"
                onClick={handleToggle}
                aria-label="Collapse transcript"
                className="p-1 transition-colors text-on-surface-variant hover:text-on-surface"
              >
                <MaterialIcon name="right_panel_close" className="text-[18px]" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-on-surface-variant">
              Call ended{durationLabel ? ` · ${durationLabel}` : ""}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-outline-variant text-[11px] font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
            >
              <MaterialIcon name="content_copy" className="text-[14px]" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className={`flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5 ${ENDED_SCROLL_CLASS}`}
        >
          {entries.length === 0 ? (
            <p className="m-auto text-center text-xs text-on-surface-variant">
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
                        <span className="font-code-md text-[10px] text-on-surface-variant">
                          {entry.timestamp}
                        </span>
                        <span className="text-xs font-semibold text-secondary">You</span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs font-semibold text-on-surface">{entry.name}</span>
                        <span className="font-code-md text-[10px] text-on-surface-variant">
                          {entry.timestamp}
                        </span>
                      </>
                    )}
                  </div>
                  {/* Student border matches its fill so both bubbles keep the live 1px box size. */}
                  <div
                    className={`p-3 text-xs leading-relaxed max-w-[92%] text-on-surface ${
                      isStudent
                        ? "bg-secondary-fixed border border-secondary-fixed rounded-2xl rounded-tr-none text-left"
                        : "bg-surface-container-low border border-outline-variant rounded-2xl rounded-tl-none"
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

  // ── Live variant (dark, beside the call) ───
  if (!expanded && isDocked) {
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
      className={
        isDocked
          ? `hidden lg:flex ${PANEL_WIDTH_CLASS} h-full shrink-0 flex-col bg-[#0a0a0a] border-l border-white/10`
          : SLIDE_OVER_CLASS
      }
    >
      <div className="h-12 px-4 border-b border-white/10 shrink-0 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <MaterialIcon name="subtitles" className="text-[18px] text-white/70" />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
            Transcript
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[11px] font-bold text-red-500 tracking-wider">LIVE</span>
          </div>
          {isDocked ? (
            <button
              type="button"
              onClick={handleToggle}
              aria-label="Collapse transcript"
              className="p-1 transition-colors text-white/60 hover:text-white"
            >
              <MaterialIcon name="right_panel_close" className="text-[18px]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close transcript"
              className="p-1 transition-colors text-white/60 hover:text-white"
            >
              <MaterialIcon name="close" className="text-[18px]" />
            </button>
          )}
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

// ── Narrow live transcript (below lg) ───

/**
 * Below lg only: a slim bar with a "Transcript" button (the stage layout places it
 * above the call) that opens the live transcript as a right-side slide-over with a
 * close button; the backdrop and Escape close it too. Renders nothing visible at
 * lg and up, where the docked panel is used.
 */
export function CallTranscriptSlideOver({
  entries,
  footer,
}: {
  entries: CallTranscriptPanelEntry[];
  footer?: React.ReactNode;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  return (
    <>
      <div className="lg:hidden h-10 shrink-0 flex items-center justify-end px-3 bg-[#0a0a0a] border-b border-white/10">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-expanded={isOpen}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-white/15 text-[12px] font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <MaterialIcon name="subtitles" className="text-[16px]" />
          Transcript
        </button>
      </div>
      {isOpen ? (
        <div className="lg:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Transcript">
          <div aria-hidden className="absolute inset-0 bg-black/50" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[min(320px,90vw)] shadow-2xl">
            <CallTranscriptPanel
              entries={entries}
              variant="live"
              footer={footer}
              placement="slide-over"
              onClose={() => setIsOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
