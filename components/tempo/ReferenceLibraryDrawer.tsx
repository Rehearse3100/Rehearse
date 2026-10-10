/**
 * ReferenceLibraryDrawer.tsx
 * Shared right-side Reference Library drawer for Tempo stages.
 * Slides in below the top bar; sits above stage content and below modals.
 */

"use client";

import { useEffect, useId, useRef } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type ReferenceLibraryDrawerProps = {
  open: boolean;
  onClose: () => void;
  stageLabel: string;
  children: React.ReactNode;
  /** Extra top offset when the TEST MODE banner is visible. */
  testBypass?: boolean;
};

/**
 * Fixed drawer with scrim. Focus moves to the close button on open.
 */
export function ReferenceLibraryDrawer({
  open,
  onClose,
  stageLabel,
  children,
  testBypass = false,
}: ReferenceLibraryDrawerProps): React.ReactElement | null {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const topOffsetClass = testBypass ? "top-28" : "top-16";
  const heightClass = testBypass ? "h-[calc(100vh-7rem)]" : "h-[calc(100vh-4rem)]";

  return (
    <div className={`fixed inset-x-0 bottom-0 ${topOffsetClass} z-[48]`} role="presentation">
      <button
        type="button"
        aria-label="Close reference library"
        className="absolute inset-0 bg-black/35 border-0 cursor-default"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute right-0 top-0 ${heightClass} w-[400px] max-w-full bg-white border-l border-outline-variant shadow-[-8px_0_24px_rgba(0,0,0,0.08)] flex flex-col`}
      >
        <header className="h-16 shrink-0 px-6 flex items-center justify-between gap-4 border-b border-outline-variant">
          <div className="min-w-0 flex items-start gap-3">
            <MaterialIcon name="menu_book" className="text-[22px] text-on-surface shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 id={titleId} className="font-bold text-on-surface text-label-md leading-tight">
                Reference Library
              </h2>
              <p className="text-label-sm text-on-surface-variant truncate">{stageLabel}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container flex items-center justify-center shrink-0 transition-colors"
            aria-label="Close"
          >
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 custom-scrollbar">{children}</div>
      </aside>
    </div>
  );
}

/**
 * Small-caps section label used inside Reference Library drawer bodies.
 */
export function ReferenceLibrarySectionLabel({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <h3 className="font-label-sm text-label-sm uppercase tracking-tighter text-on-surface-variant mb-sm">
      {children}
    </h3>
  );
}
